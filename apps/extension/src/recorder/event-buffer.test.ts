import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RawRecordedEventInput } from '@waypoint/shared-types';

import { EventBuffer } from './event-buffer.js';

function makeInput(
  id: string,
  value: string,
  locatorName = 'Email'
): RawRecordedEventInput {
  return {
    eventId: id,
    type: 'input',
    atMs: 0,
    tabId: 't1',
    target: {
      primaryLocator: { kind: 'role', role: 'textbox', name: locatorName },
      fallbackLocators: []
    },
    value,
    redacted: false
  };
}

function makeClick(id: string, name = 'Save'): RawRecordedEventInput {
  return {
    eventId: id,
    type: 'click',
    atMs: 0,
    tabId: 't1',
    target: {
      primaryLocator: { kind: 'role', role: 'button', name },
      fallbackLocators: []
    },
    button: 'left'
  };
}

describe('EventBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces consecutive inputs on the same target into first+last', () => {
    const flushed: RawRecordedEventInput[][] = [];
    const buf = new EventBuffer({ onFlush: (b) => flushed.push(b), idleMs: 750 });

    buf.push(makeInput('e1', 'a'));
    buf.push(makeInput('e2', 'al'));
    buf.push(makeInput('e3', 'ali'));
    buf.push(makeInput('e4', 'alic'));
    buf.push(makeInput('e5', 'alice'));

    // Still buffered.
    expect(flushed).toHaveLength(0);

    // Idle timer fires.
    vi.advanceTimersByTime(800);
    expect(flushed).toHaveLength(1);
    // Should have first + last (debounced intermediates).
    expect(flushed[0]!.length).toBe(2);
    expect((flushed[0]![0] as { value: string }).value).toBe('a');
    expect((flushed[0]![1] as { value: string }).value).toBe('alice');
  });

  it('flushes pending inputs when a non-input event arrives', () => {
    const flushed: RawRecordedEventInput[][] = [];
    const buf = new EventBuffer({ onFlush: (b) => flushed.push(b), idleMs: 750 });

    buf.push(makeInput('e1', 'hello'));
    buf.push(makeClick('e2'));

    // Input flushed, then click flushed separately.
    expect(flushed).toHaveLength(2);
    expect(flushed[0]![0]!.type).toBe('input');
    expect(flushed[1]![0]!.type).toBe('click');
  });

  it('flushes when target changes between inputs', () => {
    const flushed: RawRecordedEventInput[][] = [];
    const buf = new EventBuffer({ onFlush: (b) => flushed.push(b), idleMs: 750 });

    buf.push(makeInput('e1', 'alice', 'Email'));
    buf.push(makeInput('e2', 'secret', 'Password'));

    // First target flushed, second still pending.
    expect(flushed).toHaveLength(1);
    expect(flushed[0]![0]!.eventId).toBe('e1');

    vi.advanceTimersByTime(800);
    expect(flushed).toHaveLength(2);
  });

  it('dispose flushes remaining events', () => {
    const flushed: RawRecordedEventInput[][] = [];
    const buf = new EventBuffer({ onFlush: (b) => flushed.push(b) });

    buf.push(makeInput('e1', 'pending'));
    expect(flushed).toHaveLength(0);

    buf.dispose();
    expect(flushed).toHaveLength(1);
  });
});
