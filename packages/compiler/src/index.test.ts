import { describe, expect, it } from 'vitest';

import {
  type RawRecordedEventInput,
  type RecordingSessionInput,
  type Target
} from '@waypoint/shared-types';

import { compileRecording } from './index.js';

const BASE_TIME = '2026-04-09T10:00:00.000Z';

function session(events: RawRecordedEventInput[]): RecordingSessionInput {
  return {
    recordingId: 'rec_test',
    name: 'Test recording',
    startedAt: BASE_TIME,
    events
  };
}

describe('compileRecording — normalization pipeline', () => {
  it('1. typing + submit → single type then press(Enter)', () => {
    const inputTarget = {
      primaryLocator: { kind: 'role', role: 'textbox', name: 'Email' },
      fallbackLocators: []
    } satisfies Target;
    const formTarget = {
      primaryLocator: { kind: 'css', selector: 'form#login' },
      fallbackLocators: []
    } satisfies Target;

    const wf = compileRecording(
      session([
        { eventId: 'e1', type: 'input', atMs: 0, tabId: 't1', target: inputTarget, value: 'a' },
        { eventId: 'e2', type: 'input', atMs: 50, tabId: 't1', target: inputTarget, value: 'al' },
        { eventId: 'e3', type: 'input', atMs: 100, tabId: 't1', target: inputTarget, value: 'alice' },
        { eventId: 'e4', type: 'submit', atMs: 200, tabId: 't1', target: formTarget }
      ])
    );

    const types = wf.steps.map((s) => s.type);
    expect(types).toEqual(['type', 'press']);

    const typeStep = wf.steps[0]!;
    if (typeStep.type !== 'type') throw new Error('expected type step');
    expect(typeStep.value).toBe('alice');
    expect(typeStep.debug.sourceEventIds).toContain('e1');
    expect(typeStep.debug.sourceEventIds).toContain('e3');

    const pressStep = wf.steps[1]!;
    if (pressStep.type !== 'press') throw new Error('expected press step');
    expect(pressStep.key).toBe('Enter');
  });

  it('2. dropdown select → single select step', () => {
    const wf = compileRecording(
      session([
        {
          eventId: 'e1',
          type: 'select',
          atMs: 0,
          tabId: 't1',
          target: {
            primaryLocator: { kind: 'label', label: 'Country' },
            fallbackLocators: []
          },
          option: { by: 'label', value: 'Ghana' }
        }
      ])
    );

    expect(wf.steps).toHaveLength(1);
    const step = wf.steps[0]!;
    if (step.type !== 'select') throw new Error('expected select');
    expect(step.option).toEqual({ by: 'label', value: 'Ghana' });
  });

  it('3a. accidental double-click within window collapses to one click', () => {
    const target = {
      primaryLocator: { kind: 'role', role: 'button', name: 'Save' },
      fallbackLocators: []
    } satisfies Target;
    const wf = compileRecording(
      session([
        { eventId: 'e1', type: 'click', atMs: 0, tabId: 't1', target, button: 'left' },
        { eventId: 'e2', type: 'click', atMs: 150, tabId: 't1', target, button: 'left' }
      ])
    );

    expect(wf.steps).toHaveLength(1);
    const click = wf.steps[0]!;
    if (click.type !== 'click') throw new Error('expected click');
    expect(click.clickCount).toBe(1);
    expect(click.debug.notes).toContain('merged-accidental-double-click');
    expect(click.debug.sourceEventIds).toEqual(expect.arrayContaining(['e1', 'e2']));
  });

  it('3b. intentional double-click outside window stays as two clicks', () => {
    const target = {
      primaryLocator: { kind: 'role', role: 'button', name: 'Save' },
      fallbackLocators: []
    } satisfies Target;
    const wf = compileRecording(
      session([
        { eventId: 'e1', type: 'click', atMs: 0, tabId: 't1', target, button: 'left' },
        { eventId: 'e2', type: 'click', atMs: 800, tabId: 't1', target, button: 'left' }
      ])
    );
    // Two clicks on the same target separated by >400ms remain separate.
    // Note: a postcondition waitFor is inserted between the two clicks.
    const types = wf.steps.map((s) => s.type);
    expect(types).toEqual(['click', 'waitFor', 'click']);
  });

  it('4. delayed link click + navigate collapses to single goto with waitFor postcondition for the next interaction', () => {
    const link = {
      primaryLocator: { kind: 'role', role: 'link', name: 'Dashboard' },
      fallbackLocators: []
    } satisfies Target;
    const button = {
      primaryLocator: { kind: 'role', role: 'button', name: 'Refresh' },
      fallbackLocators: []
    } satisfies Target;

    const wf = compileRecording(
      session([
        {
          eventId: 'e1',
          type: 'click',
          atMs: 0,
          tabId: 't1',
          target: link,
          element: { tagName: 'A', attributes: { href: 'https://app.example.com/dashboard' } },
          button: 'left'
        },
        {
          eventId: 'e2',
          type: 'navigate',
          atMs: 2000,
          tabId: 't1',
          url: 'https://app.example.com/dashboard'
        },
        {
          eventId: 'e3',
          type: 'click',
          atMs: 3000,
          tabId: 't1',
          target: button,
          button: 'left'
        }
      ])
    );

    const types = wf.steps.map((s) => s.type);
    expect(types).toEqual(['goto', 'waitFor', 'click']);
    const goto = wf.steps[0]!;
    if (goto.type !== 'goto') throw new Error('expected goto');
    expect(goto.url).toBe('https://app.example.com/dashboard');
    expect(goto.debug.notes).toContain('promoted-from-link-click');
  });

  it('5. SPA route transition (click + historyChange + click) → click, waitFor, click', () => {
    const link = {
      primaryLocator: { kind: 'role', role: 'link', name: 'Profile' },
      fallbackLocators: []
    } satisfies Target;
    const tab = {
      primaryLocator: { kind: 'role', role: 'tab', name: 'Settings' },
      fallbackLocators: []
    } satisfies Target;

    const wf = compileRecording(
      session([
        { eventId: 'e1', type: 'click', atMs: 0, tabId: 't1', target: link, button: 'left' },
        {
          eventId: 'e2',
          type: 'historyChange',
          atMs: 100,
          tabId: 't1',
          kind: 'pushState',
          url: 'https://app.example.com/profile'
        },
        { eventId: 'e3', type: 'click', atMs: 500, tabId: 't1', target: tab, button: 'left' }
      ])
    );

    const types = wf.steps.map((s) => s.type);
    expect(types).toEqual(['click', 'waitFor', 'click']);
    const wait = wf.steps[1]!;
    if (wait.type !== 'waitFor') throw new Error('expected waitFor');
    expect(wait.debug.notes).toContain('inferred-postcondition');
  });

  it('6. ambiguous button (only css/xpath, no semantic locators) is flagged low-confidence', () => {
    const wf = compileRecording(
      session([
        {
          eventId: 'e1',
          type: 'click',
          atMs: 0,
          tabId: 't1',
          target: {
            primaryLocator: { kind: 'css', selector: 'div.modal > button:nth-of-type(3)' },
            fallbackLocators: [{ kind: 'xpath', selector: '//div[@class="modal"]/button[3]' }]
          },
          button: 'left'
        }
      ])
    );

    const click = wf.steps[0]!;
    if (click.type !== 'click') throw new Error('expected click');
    expect(click.debug.confidence).toBeLessThan(0.6);
    expect(click.debug.tags).toContain('low-confidence');
    expect(click.fallbackLocators.length).toBeGreaterThanOrEqual(1);
  });

  it('7. iframe interaction preserves framePath on the compiled step', () => {
    const wf = compileRecording(
      session([
        {
          eventId: 'e1',
          type: 'click',
          atMs: 0,
          tabId: 't1',
          target: {
            primaryLocator: { kind: 'role', role: 'button', name: 'Submit' },
            fallbackLocators: [],
            framePath: [{ index: 0, name: 'embed', url: 'https://example.com/iframe.html' }]
          },
          button: 'left'
        }
      ])
    );

    const click = wf.steps[0]!;
    if (click.type !== 'click') throw new Error('expected click');
    expect(click.framePath).toBeDefined();
    expect(click.framePath?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('8. modal open + click inside → click, waitFor, click', () => {
    const open = {
      primaryLocator: { kind: 'role', role: 'button', name: 'Open modal' },
      fallbackLocators: []
    } satisfies Target;
    const inside = {
      primaryLocator: { kind: 'role', role: 'button', name: 'Confirm' },
      fallbackLocators: []
    } satisfies Target;

    const wf = compileRecording(
      session([
        { eventId: 'e1', type: 'click', atMs: 0, tabId: 't1', target: open, button: 'left' },
        { eventId: 'e2', type: 'click', atMs: 600, tabId: 't1', target: inside, button: 'left' }
      ])
    );

    const types = wf.steps.map((s) => s.type);
    expect(types).toEqual(['click', 'waitFor', 'click']);
    const wait = wf.steps[1]!;
    if (wait.type !== 'waitFor') throw new Error('expected waitFor');
    if (wait.primaryLocator.kind !== 'role') throw new Error('expected role locator');
    expect(wait.primaryLocator.name).toBe('Confirm');
  });

  it('9. login flow stopped before password compiles successfully with only the username step', () => {
    const wf = compileRecording(
      session([
        {
          eventId: 'e1',
          type: 'input',
          atMs: 0,
          tabId: 't1',
          target: {
            primaryLocator: { kind: 'label', label: 'Username' },
            fallbackLocators: []
          },
          value: 'alice'
        }
      ])
    );

    expect(wf.steps).toHaveLength(1);
    const step = wf.steps[0]!;
    if (step.type !== 'type') throw new Error('expected type');
    expect(step.value).toBe('alice');
  });

  it('10. tab open + navigate compiles to newTab + goto with shared tabAlias', () => {
    const wf = compileRecording(
      session([
        {
          eventId: 'e1',
          type: 'tabOpened',
          atMs: 0,
          tabId: 't2',
          initialUrl: 'https://example.com'
        },
        {
          eventId: 'e2',
          type: 'navigate',
          atMs: 100,
          tabId: 't2',
          url: 'https://example.com/dashboard'
        }
      ])
    );

    const types = wf.steps.map((s) => s.type);
    expect(types).toEqual(['newTab', 'goto']);
    expect(wf.steps[0]!.tabAlias).toBe('t2');
    expect(wf.steps[1]!.tabAlias).toBe('t2');
  });

  it('bonus: locator ranking promotes role over css when both available', () => {
    const wf = compileRecording(
      session([
        {
          eventId: 'e1',
          type: 'click',
          atMs: 0,
          tabId: 't1',
          target: {
            primaryLocator: { kind: 'css', selector: '#submit-btn' },
            fallbackLocators: [{ kind: 'role', role: 'button', name: 'Submit' }]
          },
          button: 'left'
        }
      ])
    );

    const click = wf.steps[0]!;
    if (click.type !== 'click') throw new Error('expected click');
    expect(click.primaryLocator.kind).toBe('role');
  });

  it('bonus: redacted input events are dropped (no type step emitted)', () => {
    const wf = compileRecording(
      session([
        {
          eventId: 'e1',
          type: 'input',
          atMs: 0,
          tabId: 't1',
          target: {
            primaryLocator: { kind: 'label', label: 'Password' },
            fallbackLocators: []
          },
          value: '',
          redacted: true
        },
        {
          eventId: 'e2',
          type: 'click',
          atMs: 100,
          tabId: 't1',
          target: {
            primaryLocator: { kind: 'role', role: 'button', name: 'Sign in' },
            fallbackLocators: []
          },
          button: 'left'
        }
      ])
    );

    const types = wf.steps.map((s) => s.type);
    expect(types).toEqual(['click']);
  });
});
