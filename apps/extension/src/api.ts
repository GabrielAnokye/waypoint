import type {
  AuthProfile,
  AuthProfileStatus,
  DiagnosticsBundle,
  RunGraph,
  RunSummary,
  Schedule,
  Workflow,
  WorkflowRecord,
  WorkflowStep
} from '@waypoint/shared-types';

// ---- Service Worker message transport ----

interface SWResponse<T = unknown> {
  ok: boolean;
  source?: string;
  message?: string;
  payload?: T;
}

function sendSWMessage<T = unknown>(message: unknown): Promise<SWResponse<T>> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response?: SWResponse<T>) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(
        response ?? { ok: false, message: 'No response from service worker.' }
      );
    });
  });
}

// ---- Runner HTTP client ----

const RUNNER_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as Record<string, Record<string, string>>).env
      ?.VITE_RUNNER_BASE_URL) ||
  'http://127.0.0.1:3100';

async function runnerFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = { ...init?.headers as Record<string, string> };
  // Only set JSON content-type when there's a body to send.
  if (init?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${RUNNER_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Runner ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ---- Public API ----

export const api = {
  // SW messages
  ping: () => sendSWMessage({ type: 'waypoint.ping' }),

  startRecording: (name: string) =>
    sendSWMessage<{ recordingId: string }>({
      type: 'waypoint.recording.start',
      name
    }),

  stopRecording: () =>
    sendSWMessage<{
      recordingId: string;
      name: string;
      startedAt: string;
      events: unknown[];
      eventCount: number;
    }>({ type: 'waypoint.recording.stop' }),

  saveRecording: (session: {
    recordingId: string;
    name: string;
    startedAt: string;
    events: unknown[];
  }) =>
    runnerFetch<{ recordingId: string; workflowId: string; workflowVersion: number }>(
      '/recordings',
      { method: 'POST', body: JSON.stringify(session) }
    ),

  getRecordingStatus: () =>
    sendSWMessage<{ recordingId?: string; active: boolean; eventCount: number }>(
      { type: 'waypoint.recording.status' }
    ),

  // Runner — Workflows
  listWorkflows: () =>
    runnerFetch<{ workflows: WorkflowRecord[] }>('/workflows'),

  updateWorkflow: (id: string, body: Record<string, unknown>) =>
    runnerFetch<WorkflowRecord>(`/workflows/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    }),

  deleteWorkflow: (id: string) =>
    runnerFetch<{ ok: boolean }>(`/workflows/${id}`, { method: 'DELETE' }),

  duplicateWorkflow: (id: string) =>
    runnerFetch<{ workflowId: string; workflowVersion: number; name: string }>(
      `/workflows/${id}/duplicate`,
      { method: 'POST' }
    ),

  // Runner — Runs
  runWorkflow: (workflowId: string, opts?: { authProfileId?: string; debugMode?: boolean }) =>
    runnerFetch<{ runId: string; status: string }>(
      `/workflows/${workflowId}/run`,
      { method: 'POST', body: JSON.stringify(opts ?? {}) }
    ),

  cancelRun: (runId: string) =>
    runnerFetch<{ runId: string; status: string }>(
      `/runs/${runId}/cancel`,
      { method: 'POST' }
    ),

  listRuns: (workflowId?: string) =>
    runnerFetch<{ runs: RunSummary[] }>(
      workflowId ? `/runs?workflowId=${workflowId}` : '/runs'
    ),

  getRunDetails: (runId: string) =>
    runnerFetch<RunGraph>(`/runs/${runId}`),

  // Runner — Auth Profiles
  listAuthProfiles: () =>
    runnerFetch<{
      profiles: (AuthProfile & { status: AuthProfileStatus })[];
    }>('/auth-profiles'),

  createAuthProfile: (body: { name: string; browserEngine?: string; notes?: string }) =>
    runnerFetch<{ profile: AuthProfile }>('/auth-profiles', {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  deleteAuthProfile: (id: string) =>
    runnerFetch<{ ok: boolean }>(`/auth-profiles/${id}`, { method: 'DELETE' }),

  startLoginSession: (id: string) =>
    runnerFetch<{ authProfileId: string; status: string; message?: string }>(
      `/auth-profiles/${id}/login-session`,
      { method: 'POST' }
    ),

  validateAuthProfile: (id: string) =>
    runnerFetch<{ valid: boolean; reason?: string }>(
      `/auth-profiles/${id}/validate`,
      { method: 'POST', body: JSON.stringify({}) }
    ),

  // Runner — Schedules
  listSchedules: (workflowId?: string) =>
    runnerFetch<{ schedules: Schedule[] }>(
      workflowId ? `/schedules?workflowId=${workflowId}` : '/schedules'
    ),

  createSchedule: (body: Record<string, unknown>) =>
    runnerFetch<{ schedule: Schedule }>('/schedules', {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  updateSchedule: (id: string, body: Record<string, unknown>) =>
    runnerFetch<{ schedule: Schedule }>(`/schedules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    }),

  deleteSchedule: (id: string) =>
    runnerFetch<{ ok: boolean }>(`/schedules/${id}`, { method: 'DELETE' }),

  // Runner — Workflow definition editing
  getWorkflowDefinition: (id: string) =>
    runnerFetch<{ workflow: Workflow }>(`/workflows/${id}/definition`),

  updateWorkflowDefinition: (
    id: string,
    body: { name?: string; description?: string; steps?: WorkflowStep[]; tags?: string[]; changeSummary?: string }
  ) =>
    runnerFetch<{ workflowId: string; workflowVersion: number; workflow: Workflow }>(
      `/workflows/${id}/definition`,
      { method: 'PUT', body: JSON.stringify(body) }
    ),

  spliceWorkflow: (
    workflowId: string,
    body: { fromStepIndex: number; recording: { recordingId: string; name: string; startedAt: string; events: unknown[] } }
  ) =>
    runnerFetch<{ workflowId: string; workflowVersion: number; stepsReplaced: number }>(
      `/workflows/${workflowId}/splice`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  getWorkflowVersions: (id: string) =>
    runnerFetch<{
      versions: Array<{ id: string; version: number; createdAt: string; changeSummary?: string; createdBy: string }>;
    }>(`/workflows/${id}/versions`),

  testStep: (workflowId: string, step: WorkflowStep, authProfileId?: string) =>
    runnerFetch<{ ok: boolean; durationMs: number; error?: { code: string; message: string }; screenshotPath?: string }>(
      `/workflows/${workflowId}/test-step`,
      { method: 'POST', body: JSON.stringify({ step, ...(authProfileId ? { authProfileId } : {}) }) }
    ),

  runFromStep: (workflowId: string, fromStepIndex: number, opts?: { authProfileId?: string; debugMode?: boolean }) =>
    runnerFetch<{ runId: string; status: string; fromStepIndex: number }>(
      `/workflows/${workflowId}/run-from`,
      { method: 'POST', body: JSON.stringify({ fromStepIndex, ...opts }) }
    ),

  // Runner — Diagnostics
  getRunDiagnostics: (runId: string) =>
    runnerFetch<DiagnosticsBundle>(`/runs/${runId}/diagnostics`)
} as const;

export type Api = typeof api;
