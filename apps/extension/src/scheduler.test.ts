import { describe, expect, it } from 'vitest';

import { computeNextRunMs } from './scheduler.js';

describe('computeNextRunMs', () => {
  it('computes the next daily run time after the given timestamp', () => {
    // Monday 2026-03-09 at 07:00 UTC — next 08:00 UTC same day
    const after = new Date('2026-03-09T07:00:00.000Z');
    const result = computeNextRunMs(
      { pattern: { kind: 'daily' }, hour: 8, minute: 0, timezone: 'UTC' },
      after
    );
    expect(result).toBeGreaterThan(after.getTime());
    const d = new Date(result);
    expect(d.getUTCHours()).toBe(8);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it('rolls to the next day if the scheduled time has already passed', () => {
    // Monday 2026-03-09 at 09:00 UTC — 08:00 is past, should get Tuesday
    const after = new Date('2026-03-09T09:00:00.000Z');
    const result = computeNextRunMs(
      { pattern: { kind: 'daily' }, hour: 8, minute: 0, timezone: 'UTC' },
      after
    );
    const d = new Date(result);
    expect(d.getUTCDate()).toBe(10);
    expect(d.getUTCHours()).toBe(8);
  });

  it('skips weekends for weekdays pattern', () => {
    // Saturday 2026-03-14 at 07:00 UTC
    const after = new Date('2026-03-14T07:00:00.000Z');
    const result = computeNextRunMs(
      { pattern: { kind: 'weekdays' }, hour: 8, minute: 0, timezone: 'UTC' },
      after
    );
    const d = new Date(result);
    // Should be Monday the 16th
    expect(d.getUTCDay()).toBe(1); // Monday
    expect(d.getUTCDate()).toBe(16);
  });

  it('picks only specified days for specific pattern', () => {
    // Monday 2026-03-09 — specific days: [3, 5] = Wed, Fri
    const after = new Date('2026-03-09T07:00:00.000Z');
    const result = computeNextRunMs(
      {
        pattern: { kind: 'specific', days: [3, 5] },
        hour: 8,
        minute: 0,
        timezone: 'UTC'
      },
      after
    );
    const d = new Date(result);
    // Next Wednesday = March 11
    expect(d.getUTCDay()).toBe(3);
    expect(d.getUTCDate()).toBe(11);
  });

  it('returns a future timestamp even for same-time edge case', () => {
    const after = new Date('2026-03-09T08:00:00.000Z');
    const result = computeNextRunMs(
      { pattern: { kind: 'daily' }, hour: 8, minute: 0, timezone: 'UTC' },
      after
    );
    expect(result).toBeGreaterThan(after.getTime());
  });
});
