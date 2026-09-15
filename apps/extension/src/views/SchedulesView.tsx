import { useCallback, useEffect, useState } from 'react';

import type { Schedule, SchedulePattern } from '@waypoint/shared-types';

import { api } from '../api';
import { useExtensionStore } from '../store';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatPattern(p: SchedulePattern): string {
  if (p.kind === 'daily') return 'Daily';
  if (p.kind === 'weekdays') return 'Weekdays';
  return p.days.map((d) => DAY_LABELS[d]).join(', ');
}

function formatTime(h: number, m: number): string {
  const hh = h.toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function SchedulesView() {
  const {
    schedules, scheduleOrder, setSchedules, updateScheduleInStore, removeSchedule,
    workflows, workflowOrder, setWorkflows,
    setStatus
  } = useExtensionStore();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    workflowId: '',
    patternKind: 'daily' as 'daily' | 'weekdays' | 'specific',
    days: [] as number[],
    hour: 8,
    minute: 0,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  });

  const fetchSchedules = useCallback(async () => {
    try {
      const { schedules: list } = await api.listSchedules();
      setSchedules(list);
    } catch {
      /* runner offline */
    }
  }, [setSchedules]);

  const fetchWorkflows = useCallback(async () => {
    try {
      const { workflows: list } = await api.listWorkflows();
      setWorkflows(list);
    } catch {
      /* silent */
    }
  }, [setWorkflows]);

  useEffect(() => {
    void fetchSchedules();
    void fetchWorkflows();
  }, [fetchSchedules, fetchWorkflows]);

  async function handleCreate() {
    if (!form.workflowId) return;
    const pattern: SchedulePattern =
      form.patternKind === 'specific'
        ? { kind: 'specific', days: form.days }
        : { kind: form.patternKind };
    try {
      await api.createSchedule({
        workflowId: form.workflowId,
        pattern,
        timezone: form.timezone,
        hour: form.hour,
        minute: form.minute,
        enabled: true,
        missedRunPolicy: 'skip'
      });
      setCreating(false);
      void fetchSchedules();
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Create failed.');
    }
  }

  async function handleToggle(s: Schedule) {
    try {
      const { schedule } = await api.updateSchedule(s.id, {
        enabled: !s.enabled
      });
      updateScheduleInStore(schedule);
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Toggle failed.');
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteSchedule(id);
      removeSchedule(id);
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  return (
    <>
      <section className="wp-card">
        {creating ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <select
              value={form.workflowId}
              onChange={(e) =>
                setForm((f) => ({ ...f, workflowId: e.target.value }))
              }
              style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(68,96,116,0.3)' }}
            >
              <option value="">Select workflow</option>
              {workflowOrder.map((id) => {
                const wf = workflows[id];
                return wf ? (
                  <option key={id} value={id}>
                    {wf.name}
                  </option>
                ) : null;
              })}
            </select>
            <select
              value={form.patternKind}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  patternKind: e.target.value as typeof f.patternKind
                }))
              }
              style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(68,96,116,0.3)' }}
            >
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays</option>
              <option value="specific">Specific days</option>
            </select>
            {form.patternKind === 'specific' && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {DAY_LABELS.map((label, i) => (
                  <button
                    key={label}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        days: f.days.includes(i)
                          ? f.days.filter((d) => d !== i)
                          : [...f.days, i].sort()
                      }))
                    }
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: form.days.includes(i)
                        ? '2px solid #0d5b86'
                        : '1px solid rgba(68,96,116,0.3)',
                      background: form.days.includes(i) ? '#d6f3ff' : 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                min={0}
                max={23}
                value={form.hour}
                onChange={(e) =>
                  setForm((f) => ({ ...f, hour: Number(e.target.value) }))
                }
                style={{ width: 60, padding: 8, borderRadius: 8, border: '1px solid rgba(68,96,116,0.3)' }}
                placeholder="Hour"
              />
              <span style={{ alignSelf: 'center' }}>:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={form.minute}
                onChange={(e) =>
                  setForm((f) => ({ ...f, minute: Number(e.target.value) }))
                }
                style={{ width: 60, padding: 8, borderRadius: 8, border: '1px solid rgba(68,96,116,0.3)' }}
                placeholder="Min"
              />
              <span className="wp-message" style={{ alignSelf: 'center', fontSize: 12 }}>
                {form.timezone}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="wp-button" onClick={() => void handleCreate()}>
                Create
              </button>
              <button className="wp-button" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="wp-button"
            onClick={() => setCreating(true)}
            style={{ width: '100%' }}
          >
            New schedule
          </button>
        )}
      </section>

      {scheduleOrder.length === 0 ? (
        <section className="wp-card">
          <p className="wp-message">No schedules. Create one to automate a workflow.</p>
        </section>
      ) : (
        scheduleOrder.map((id) => {
          const s = schedules[id];
          if (!s) return null;
          const wf = workflows[s.workflowId];
          return (
            <section key={id} className="wp-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p className="wp-label" style={{ margin: 0 }}>
                  {wf?.name ?? s.workflowId}
                </p>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: s.enabled ? '#087443' : '#687582',
                    textTransform: 'uppercase'
                  }}
                >
                  {s.enabled ? 'Active' : 'Paused'}
                </span>
              </div>
              <p className="wp-message" style={{ marginTop: 4, fontSize: 13 }}>
                {formatPattern(s.pattern)} at {formatTime(s.hour, s.minute)}{' '}
                ({s.timezone})
              </p>
              {s.lastRunAt && (
                <p className="wp-message" style={{ fontSize: 12 }}>
                  Last: {new Date(s.lastRunAt).toLocaleString()}
                  {s.lastRunStatus ? ` (${s.lastRunStatus})` : ''}
                </p>
              )}
              {s.nextRunAt && (
                <p className="wp-message" style={{ fontSize: 12 }}>
                  Next: {new Date(s.nextRunAt).toLocaleString()}
                </p>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  className="wp-button"
                  onClick={() => void handleToggle(s)}
                >
                  {s.enabled ? 'Pause' : 'Resume'}
                </button>
                <button
                  className="wp-button wp-button--danger"
                  onClick={() => {
                    if (confirm('Delete this schedule?')) void handleDelete(id);
                  }}
                >
                  Delete
                </button>
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
