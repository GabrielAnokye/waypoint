import { describe, expect, it } from 'vitest';

import type { Locator, WorkflowStep } from '@waypoint/shared-types';

import {
  classifyError,
  computeRetryDelay,
  isResolveFailure,
  resolveLocator,
  urlMatchesExpected,
  type LocatableHandle,
  type LocatablePage
} from './locate.js';

// ---- Mock page factories ----

function mockHandle(count: number): LocatableHandle {
  return {
    count: async () => count,
    first() { return this; }
  };
}

function mockPage(results: Map<string, number>): LocatablePage {
  const page: LocatablePage = {
    getByRole(role: string, opts?: { name?: string }) {
      return mockHandle(results.get(`role:${role}:${opts?.name ?? ''}`) ?? 0);
    },
    getByLabel(label: string) {
      return mockHandle(results.get(`label:${label}`) ?? 0);
    },
    getByText(text: string) {
      return mockHandle(results.get(`text:${text}`) ?? 0);
    },
    getByTestId(testId: string) {
      return mockHandle(results.get(`testId:${testId}`) ?? 0);
    },
    getByPlaceholder(placeholder: string) {
      return mockHandle(results.get(`placeholder:${placeholder}`) ?? 0);
    },
    locator(selector: string) {
      return mockHandle(results.get(`locator:${selector}`) ?? 0);
    },
    frameLocator() {
      return page; // same mock for nested frames
    }
  };
  return page;
}

function makeClickStep(
  primary: Locator,
  fallbacks: Locator[] = []
): WorkflowStep {
  return {
    id: 'step_1',
    type: 'click',
    enabled: true,
    primaryLocator: primary,
    fallbackLocators: fallbacks,
    timeoutMs: 5000,
    retryPolicy: { maxAttempts: 1, backoffMs: 0, strategy: 'fixed' },
    debug: { sourceEventIds: [], notes: [], tags: [], extra: {} },
    button: 'left',
    clickCount: 1
  };
}

// ---- Tests ----

describe('resolveLocator', () => {
  it('resolves a role locator when exactly one element matches', async () => {
    const page = mockPage(new Map([['role:button:Save', 1]]));
    const step = makeClickStep({ kind: 'role', role: 'button', name: 'Save' });
    const result = await resolveLocator(page, step);
    expect(isResolveFailure(result)).toBe(false);
    if (!isResolveFailure(result)) {
      expect(result.resolvedLocator).toEqual({ kind: 'role', role: 'button', name: 'Save' });
      expect(result.usedFallback).toBe(false);
      expect(result.confidence).toBeGreaterThan(0.9);
    }
  });

  it('changed button text — falls back to testId when role name changed', async () => {
    // Button text changed from "Save" to "Submit" — role locator misses
    const page = mockPage(new Map([
      ['role:button:Save', 0],       // primary misses
      ['testId:save-btn', 1]         // fallback testId hits
    ]));
    const step = makeClickStep(
      { kind: 'role', role: 'button', name: 'Save' },
      [{ kind: 'testId', testId: 'save-btn' }]
    );
    const result = await resolveLocator(page, step);
    expect(isResolveFailure(result)).toBe(false);
    if (!isResolveFailure(result)) {
      expect(result.resolvedLocator.kind).toBe('testId');
      expect(result.usedFallback).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.8);
    }
  });

  it('duplicated buttons — detects ambiguity and flags low confidence', async () => {
    // Two "Delete" buttons on the page
    const page = mockPage(new Map([
      ['role:button:Delete', 2],          // ambiguous — 2 matches
      ['locator:[data-testid="del-1"]', 1] // CSS fallback resolves uniquely
    ]));
    const step = makeClickStep(
      { kind: 'role', role: 'button', name: 'Delete' },
      [{ kind: 'css', selector: '[data-testid="del-1"]' }]
    );
    const result = await resolveLocator(page, step);
    expect(isResolveFailure(result)).toBe(false);
    if (!isResolveFailure(result)) {
      // Should fall through to the CSS locator since role had 2 matches (semantic, <=3)
      // With 2 matches the semantic locator is accepted at low confidence
      expect(result.confidence).toBeLessThan(0.6);
    }
  });

  it('produces a repair record when no locator matches', async () => {
    const page = mockPage(new Map()); // nothing matches
    const step = makeClickStep(
      { kind: 'role', role: 'button', name: 'Gone' },
      [{ kind: 'css', selector: '#removed-button' }]
    );
    const result = await resolveLocator(page, step);
    expect(isResolveFailure(result)).toBe(true);
    if (isResolveFailure(result)) {
      expect(result.failureCode).toBe('locator_not_found');
      expect(result.repairRecord.stepId).toBe('step_1');
      expect(result.repairRecord.attemptedLocators).toHaveLength(2);
      expect(result.repairRecord.suggestion).toContain('rebinding');
    }
  });

  it('frame path triggers frame_mismatch on failure when index-based', async () => {
    const page = mockPage(new Map()); // nothing matches
    const step: WorkflowStep = {
      id: 'step_f',
      type: 'click',
      enabled: true,
      primaryLocator: { kind: 'css', selector: '#inner-btn' },
      fallbackLocators: [],
      framePath: [{ index: 0 }],
      timeoutMs: 5000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0, strategy: 'fixed' },
      debug: { sourceEventIds: [], notes: [], tags: [], extra: {} },
      button: 'left',
      clickCount: 1
    };
    const result = await resolveLocator(page, step);
    expect(isResolveFailure(result)).toBe(true);
    if (isResolveFailure(result)) {
      expect(result.failureCode).toBe('frame_mismatch');
    }
  });
});

describe('classifyError', () => {
  const step = makeClickStep({ kind: 'css', selector: '#x' });

  it('classifies timeout errors', () => {
    expect(classifyError(new Error('Timeout 30000ms exceeded'), step)).toBe('timeout');
  });

  it('classifies navigation errors', () => {
    expect(classifyError(new Error('net::ERR_CONNECTION_REFUSED'), step)).toBe('navigation_mismatch');
  });

  it('classifies auth errors', () => {
    expect(classifyError(new Error('Received 401 Unauthorized'), step)).toBe('auth_expired');
  });

  it('classifies blocked pages', () => {
    expect(classifyError(new Error('Access denied - captcha required'), step)).toBe('blocked_page');
  });

  it('classifies strict mode / ambiguous locator', () => {
    expect(classifyError(new Error('strict mode violation: resolved to 3 elements'), step)).toBe('ambiguous_locator');
  });

  it('defaults to step_failed for unknown errors', () => {
    expect(classifyError(new Error('some random error'), step)).toBe('step_failed');
  });
});

describe('computeRetryDelay', () => {
  it('returns fixed delay regardless of attempt', () => {
    expect(computeRetryDelay(1, 500, 'fixed')).toBe(500);
    expect(computeRetryDelay(5, 500, 'fixed')).toBe(500);
  });

  it('returns exponential delay', () => {
    expect(computeRetryDelay(1, 250, 'exponential')).toBe(250);
    expect(computeRetryDelay(2, 250, 'exponential')).toBe(500);
    expect(computeRetryDelay(3, 250, 'exponential')).toBe(1000);
  });

  it('caps at 30 seconds', () => {
    expect(computeRetryDelay(20, 1000, 'exponential')).toBe(30_000);
    expect(computeRetryDelay(1, 60_000, 'fixed')).toBe(30_000);
  });
});

describe('urlMatchesExpected', () => {
  it('matches identical URLs', () => {
    expect(urlMatchesExpected('https://example.com/page', 'https://example.com/page')).toBe(true);
  });

  it('matches with trailing slash difference', () => {
    expect(urlMatchesExpected('https://example.com/page/', 'https://example.com/page')).toBe(true);
  });

  it('ignores query params for origin+path comparison', () => {
    expect(urlMatchesExpected('https://example.com/page?ref=123', 'https://example.com/page')).toBe(true);
  });

  it('rejects different paths', () => {
    expect(urlMatchesExpected('https://example.com/login', 'https://example.com/dashboard')).toBe(false);
  });

  it('handles redirect after login (different origin)', () => {
    expect(urlMatchesExpected('https://auth.example.com/callback', 'https://app.example.com/dashboard')).toBe(false);
  });
});
