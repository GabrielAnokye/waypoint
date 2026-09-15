/**
 * Chrome Alarms-based schedule manager for the service worker.
 *
 * Fetches schedules from the runner, creates Chrome alarms, and
 * triggers workflow runs when alarms fire. Handles missed-run
 * policy on service worker startup.
 */

import type { Schedule, SchedulePattern } from '@waypoint/shared-types';

const ALARM_PREFIX = 'wp-schedule:';
const RUNNER_BASE = 'http://127.0.0.1:3100';

// ---- Next-run calculation ----

function matchesPattern(pattern: SchedulePattern, date: Date): boolean {
  const day = date.getDay();
  if (pattern.kind === 'daily') return true;
  if (pattern.kind === 'weekdays') return day >= 1 && day <= 5;
  return pattern.days.includes(day);
}

/**
 * Returns the UTC offset in ms for a given timezone at a given instant.
 */
function getTimezoneOffsetMs(timezone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // Build a UTC date from the local components in the target timezone
  const localMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second')
  );
  return localMs - at.getTime();
}

/**
 * Computes the next fire time for a schedule, starting from `after`.
 * Returns a UTC epoch ms timestamp.
 */
export function computeNextRunMs(
  schedule: Pick<Schedule, 'pattern' | 'hour' | 'minute' | 'timezone'>,
  after = new Date()
): number {
  // Convert `after` to the schedule's local date components.
  const offsetMs = getTimezoneOffsetMs(schedule.timezone, after);
  const localAfterMs = after.getTime() + offsetMs;

  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const candidateLocal = new Date(localAfterMs + dayOffset * 86_400_000);
    // Build a target time in local tz at the schedule's hour:minute.
    const targetLocalMs = Date.UTC(
      candidateLocal.getUTCFullYear(),
      candidateLocal.getUTCMonth(),
      candidateLocal.getUTCDate(),
      schedule.hour,
      schedule.minute,
      0
    );

    // Convert back to UTC.
    // Re-compute offset at the target time for DST accuracy.
    const approxUtcMs = targetLocalMs - offsetMs;
    const refinedOffset = getTimezoneOffsetMs(schedule.timezone, new Date(approxUtcMs));
    const targetUtcMs = targetLocalMs - refinedOffset;

    if (targetUtcMs <= after.getTime()) continue;

    // Check day-of-week in local time.
    const dayInTz = new Date(targetLocalMs);
    if (matchesPattern(schedule.pattern, dayInTz)) {
      return targetUtcMs;
    }
  }

  // Fallback: 24 hours from now.
  return after.getTime() + 86_400_000;
}

// ---- Alarm management ----

function alarmName(scheduleId: string): string {
  return `${ALARM_PREFIX}${scheduleId}`;
}

function scheduleIdFromAlarm(name: string): string | null {
  return name.startsWith(ALARM_PREFIX)
    ? name.slice(ALARM_PREFIX.length)
    : null;
}

async function fetchSchedules(): Promise<Schedule[]> {
  try {
    const res = await fetch(`${RUNNER_BASE}/schedules`);
    if (!res.ok) return [];
    const data = (await res.json()) as { schedules: Schedule[] };
    return data.schedules;
  } catch {
    return [];
  }
}

async function triggerRun(
  workflowId: string,
  opts?: { authProfileId?: string }
): Promise<void> {
  try {
    await fetch(`${RUNNER_BASE}/workflows/${workflowId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts ?? {})
    });
  } catch (err) {
    console.warn('[Waypoint] Failed to trigger scheduled run:', err);
  }
}

/**
 * Rehydrates all Chrome alarms from the current schedules in the runner DB.
 * Called on service worker startup (onInstalled / onStartup).
 */
export async function rehydrateAlarms(): Promise<void> {
  const schedules = await fetchSchedules();
  const existingAlarms = await chrome.alarms.getAll();
  const existingNames = new Set(existingAlarms.map((a) => a.name));

  const now = new Date();

  for (const schedule of schedules) {
    const name = alarmName(schedule.id);

    if (!schedule.enabled) {
      if (existingNames.has(name)) {
        await chrome.alarms.clear(name);
      }
      continue;
    }

    // Check for missed runs (run_on_next_open policy).
    if (schedule.missedRunPolicy === 'run_on_next_open' && schedule.nextRunAt) {
      const nextRunTime = new Date(schedule.nextRunAt).getTime();
      if (nextRunTime < now.getTime()) {
        console.info(
          `[Waypoint] Missed run detected for schedule ${schedule.id}, triggering now.`
        );
        void triggerRun(
          schedule.workflowId,
          schedule.authProfileId ? { authProfileId: schedule.authProfileId } : {}
        );
      }
    }

    const nextMs = computeNextRunMs(schedule, now);
    await chrome.alarms.create(name, { when: nextMs });
  }

  // Clear alarms for schedules that no longer exist.
  for (const alarm of existingAlarms) {
    const sid = scheduleIdFromAlarm(alarm.name);
    if (sid && !schedules.find((s) => s.id === sid)) {
      await chrome.alarms.clear(alarm.name);
    }
  }
}

/**
 * Handles a fired Chrome alarm. If it matches a schedule, triggers the run
 * and re-schedules the next alarm.
 */
export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  const scheduleId = scheduleIdFromAlarm(alarm.name);
  if (!scheduleId) return;

  const schedules = await fetchSchedules();
  const schedule = schedules.find((s) => s.id === scheduleId);
  if (!schedule || !schedule.enabled) return;

  void triggerRun(
    schedule.workflowId,
    schedule.authProfileId ? { authProfileId: schedule.authProfileId } : {}
  );

  // Re-schedule for the next occurrence.
  const nextMs = computeNextRunMs(schedule);
  await chrome.alarms.create(alarm.name, { when: nextMs });
}
