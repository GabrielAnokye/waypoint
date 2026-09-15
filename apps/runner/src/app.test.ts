import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openWaypointDatabase } from '@waypoint/db';
import { HealthResponseSchema, ScheduleSchema } from '@waypoint/shared-types';

import { buildRunnerServer } from './app.js';
import type { BrowserLauncher } from './core/executor.js';

const baseEnv = {
  RUNNER_HOST: '127.0.0.1',
  RUNNER_PORT: 3100,
  LOG_LEVEL: 'silent' as const
};

const runner = buildRunnerServer(baseEnv);

beforeAll(async () => {
  await runner.app.ready();
});

afterAll(async () => {
  await runner.app.close();
});

describe('buildRunnerServer', () => {
  it('serves a validated health response', async () => {
    const response = await runner.app.inject({ method: 'GET', url: '/health' });
    const payload = HealthResponseSchema.parse(response.json());
    expect(response.statusCode).toBe(200);
    expect(payload.service).toBe('runner');
  });

  it('exposes /status with service metadata', async () => {
    const response = await runner.app.inject({ method: 'GET', url: '/status' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.service).toBe('runner');
    expect(Array.isArray(body.active)).toBe(true);
  });
});

const sampleRecording = {
  recordingId: 'rec_e2e',
  name: 'E2E recording',
  startedAt: '2026-04-09T10:00:00.000Z',
  events: [
    {
      eventId: 'e1',
      type: 'navigate',
      atMs: 0,
      tabId: 't1',
      url: 'https://example.com'
    },
    {
      eventId: 'e2',
      type: 'click',
      atMs: 100,
      tabId: 't1',
      target: {
        primaryLocator: { kind: 'role', role: 'button', name: 'Save' },
        fallbackLocators: []
      },
      button: 'left'
    }
  ]
};

async function waitForRunStatus(
  app: ReturnType<typeof buildRunnerServer>['app'],
  runId: string
): Promise<unknown> {
  for (let i = 0; i < 50; i++) {
    const r = await app.inject({ method: 'GET', url: `/runs/${runId}` });
    if (r.statusCode === 200) {
      const body = r.json() as { run: { status: string } };
      if (body.run.status !== 'queued' && body.run.status !== 'running') {
        return body;
      }
    }
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error('run did not complete in time');
}

describe('runner workflows + runs', () => {
  it('compiles a recording, runs it with a stub launcher, and persists the run graph', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const launcher: BrowserLauncher = { async executeStep() {} };
    const r = buildRunnerServer(baseEnv, {
      repository: repo,
      browserLauncher: launcher
    });
    await r.app.ready();
    try {
      const save = await r.app.inject({
        method: 'POST',
        url: '/recordings',
        payload: sampleRecording
      });
      expect(save.statusCode).toBe(200);
      const { workflowId } = save.json() as { workflowId: string };

      const start = await r.app.inject({
        method: 'POST',
        url: `/workflows/${workflowId}/run`,
        payload: {}
      });
      expect(start.statusCode).toBe(200);
      const { runId } = start.json() as { runId: string };

      const graph = (await waitForRunStatus(r.app, runId)) as {
        run: { status: string };
        steps: unknown[];
      };
      expect(graph.run.status).toBe('succeeded');
      expect(graph.steps.length).toBeGreaterThanOrEqual(2);

      const list = await r.app.inject({
        method: 'GET',
        url: `/runs?workflowId=${workflowId}`
      });
      expect(list.statusCode).toBe(200);
      expect((list.json() as { runs: unknown[] }).runs.length).toBe(1);
    } finally {
      await r.app.close();
    }
  });

  it('marks a run as failed when the launcher throws on a step', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    let calls = 0;
    const launcher: BrowserLauncher = {
      async executeStep() {
        calls++;
        if (calls === 2) throw new Error('boom');
      }
    };
    const r = buildRunnerServer(baseEnv, {
      repository: repo,
      browserLauncher: launcher
    });
    await r.app.ready();
    try {
      const save = await r.app.inject({
        method: 'POST',
        url: '/recordings',
        payload: sampleRecording
      });
      const { workflowId } = save.json() as { workflowId: string };
      const start = await r.app.inject({
        method: 'POST',
        url: `/workflows/${workflowId}/run`,
        payload: {}
      });
      const { runId } = start.json() as { runId: string };
      const graph = (await waitForRunStatus(r.app, runId)) as {
        run: { status: string; errorMessage?: string };
      };
      expect(graph.run.status).toBe('failed');
      expect(graph.run.errorMessage).toContain('boom');
    } finally {
      await r.app.close();
    }
  });

  it('cancel endpoint returns 404 for unknown runs', async () => {
    const response = await runner.app.inject({
      method: 'POST',
      url: '/runs/run_does_not_exist/cancel'
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('workflow CRUD', () => {
  it('renames a workflow via PUT', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const r = buildRunnerServer(baseEnv, { repository: repo });
    await r.app.ready();
    try {
      await r.app.inject({ method: 'POST', url: '/recordings', payload: sampleRecording });
      const { workflows } = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: { id: string; name: string }[];
      };
      const wf = workflows[0]!;

      const res = await r.app.inject({
        method: 'PUT',
        url: `/workflows/${wf.id}`,
        payload: { name: 'Renamed workflow' }
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { name: string }).name).toBe('Renamed workflow');
    } finally {
      await r.app.close();
    }
  });

  it('duplicates a workflow', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const r = buildRunnerServer(baseEnv, { repository: repo });
    await r.app.ready();
    try {
      await r.app.inject({ method: 'POST', url: '/recordings', payload: sampleRecording });
      const { workflows } = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: { id: string }[];
      };
      const wf = workflows[0]!;

      const res = await r.app.inject({ method: 'POST', url: `/workflows/${wf.id}/duplicate` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { workflowId: string; name: string };
      expect(body.workflowId).not.toBe(wf.id);
      expect(body.name).toContain('(copy)');

      const list = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: unknown[];
      };
      expect(list.workflows).toHaveLength(2);
    } finally {
      await r.app.close();
    }
  });

  it('deletes a workflow', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const r = buildRunnerServer(baseEnv, { repository: repo });
    await r.app.ready();
    try {
      await r.app.inject({ method: 'POST', url: '/recordings', payload: sampleRecording });
      const { workflows } = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: { id: string }[];
      };

      const res = await r.app.inject({ method: 'DELETE', url: `/workflows/${workflows[0]!.id}` });
      expect(res.statusCode).toBe(200);

      const list = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: unknown[];
      };
      expect(list.workflows).toHaveLength(0);
    } finally {
      await r.app.close();
    }
  });
});

describe('workflow definition + versions', () => {
  it('updates a workflow definition and creates a new version', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const r = buildRunnerServer(baseEnv, { repository: repo });
    await r.app.ready();
    try {
      await r.app.inject({ method: 'POST', url: '/recordings', payload: sampleRecording });
      const { workflows } = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: { id: string }[];
      };
      const wfId = workflows[0]!.id;

      // Get current definition
      const defRes = await r.app.inject({ method: 'GET', url: `/workflows/${wfId}/definition` });
      expect(defRes.statusCode).toBe(200);
      const def = defRes.json() as { workflow: { steps: unknown[]; name: string } };
      expect(def.workflow.steps.length).toBeGreaterThan(0);

      // Update definition
      const updateRes = await r.app.inject({
        method: 'PUT',
        url: `/workflows/${wfId}/definition`,
        payload: {
          name: 'Updated workflow',
          description: 'New desc',
          steps: def.workflow.steps,
          changeSummary: 'Updated name and description'
        }
      });
      expect(updateRes.statusCode).toBe(200);

      // Check versions
      const versionsRes = await r.app.inject({ method: 'GET', url: `/workflows/${wfId}/versions` });
      expect(versionsRes.statusCode).toBe(200);
      const { versions } = versionsRes.json() as { versions: { id: string; version: number }[] };
      expect(versions.length).toBeGreaterThanOrEqual(2);
    } finally {
      await r.app.close();
    }
  });

  it('returns 404 for definition of non-existent workflow', async () => {
    const res = await runner.app.inject({ method: 'GET', url: '/workflows/wf_nope/definition' });
    expect(res.statusCode).toBe(404);
  });
});

describe('test-step endpoint', () => {
  it('returns ok:true when launcher succeeds', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const launcher: BrowserLauncher = { async executeStep() {} };
    const r = buildRunnerServer(baseEnv, { repository: repo, browserLauncher: launcher });
    await r.app.ready();
    try {
      await r.app.inject({ method: 'POST', url: '/recordings', payload: sampleRecording });
      const { workflows } = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: { id: string }[];
      };

      const res = await r.app.inject({
        method: 'POST',
        url: `/workflows/${workflows[0]!.id}/test-step`,
        payload: {
          step: {
            id: 'test_s1',
            type: 'click',
            enabled: true,
            primaryLocator: { kind: 'role', role: 'button', name: 'OK' },
            fallbackLocators: [],
            timeoutMs: 5000,
            retryPolicy: { maxAttempts: 1, backoffMs: 0, strategy: 'fixed' },
            debug: { sourceEventIds: [], notes: [], tags: [], extra: {} },
            button: 'left',
            clickCount: 1
          }
        }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; durationMs: number };
      expect(body.ok).toBe(true);
      expect(body.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await r.app.close();
    }
  });

  it('returns ok:false when launcher throws', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const launcher: BrowserLauncher = {
      async executeStep() { throw new Error('element not found'); }
    };
    const r = buildRunnerServer(baseEnv, { repository: repo, browserLauncher: launcher });
    await r.app.ready();
    try {
      await r.app.inject({ method: 'POST', url: '/recordings', payload: sampleRecording });
      const { workflows } = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: { id: string }[];
      };

      const res = await r.app.inject({
        method: 'POST',
        url: `/workflows/${workflows[0]!.id}/test-step`,
        payload: {
          step: {
            id: 'test_s1',
            type: 'click',
            enabled: true,
            primaryLocator: { kind: 'role', role: 'button', name: 'OK' },
            fallbackLocators: [],
            timeoutMs: 5000,
            retryPolicy: { maxAttempts: 1, backoffMs: 0, strategy: 'fixed' },
            debug: { sourceEventIds: [], notes: [], tags: [], extra: {} },
            button: 'left',
            clickCount: 1
          }
        }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; error: { code: string; message: string } };
      expect(body.ok).toBe(false);
      expect(body.error.message).toContain('element not found');
    } finally {
      await r.app.close();
    }
  });
});

describe('run-from endpoint', () => {
  it('starts a run from a specified step index', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const executedSteps: number[] = [];
    const launcher: BrowserLauncher = {
      async executeStep(_step, ctx) { executedSteps.push(ctx.stepIndex); }
    };
    const r = buildRunnerServer(baseEnv, { repository: repo, browserLauncher: launcher });
    await r.app.ready();
    try {
      await r.app.inject({ method: 'POST', url: '/recordings', payload: sampleRecording });
      const { workflows } = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: { id: string }[];
      };

      const res = await r.app.inject({
        method: 'POST',
        url: `/workflows/${workflows[0]!.id}/run-from`,
        payload: { fromStepIndex: 1 }
      });
      expect(res.statusCode).toBe(200);
      const { runId, fromStepIndex } = res.json() as { runId: string; fromStepIndex: number };
      expect(fromStepIndex).toBe(1);

      await waitForRunStatus(r.app, runId);
    } finally {
      await r.app.close();
    }
  });

  it('returns 400 for out-of-range step index', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const r = buildRunnerServer(baseEnv, { repository: repo });
    await r.app.ready();
    try {
      await r.app.inject({ method: 'POST', url: '/recordings', payload: sampleRecording });
      const { workflows } = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: { id: string }[];
      };

      const res = await r.app.inject({
        method: 'POST',
        url: `/workflows/${workflows[0]!.id}/run-from`,
        payload: { fromStepIndex: 999 }
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await r.app.close();
    }
  });
});

describe('diagnostics export', () => {
  it('returns a redacted diagnostics bundle for a completed run', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const launcher: BrowserLauncher = { async executeStep() {} };
    const r = buildRunnerServer(baseEnv, { repository: repo, browserLauncher: launcher });
    await r.app.ready();
    try {
      await r.app.inject({ method: 'POST', url: '/recordings', payload: sampleRecording });
      const { workflows } = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: { id: string }[];
      };
      const start = await r.app.inject({
        method: 'POST',
        url: `/workflows/${workflows[0]!.id}/run`,
        payload: {}
      });
      const { runId } = start.json() as { runId: string };
      await waitForRunStatus(r.app, runId);

      const res = await r.app.inject({ method: 'GET', url: `/runs/${runId}/diagnostics` });
      expect(res.statusCode).toBe(200);
      const bundle = res.json() as {
        exportedAt: string;
        environment: { nodeVersion: string; platform: string };
        run: { id: string };
        steps: unknown[];
      };
      expect(bundle.exportedAt).toBeTruthy();
      expect(bundle.environment.nodeVersion).toBeTruthy();
      expect(bundle.run.id).toBe(runId);
      expect(Array.isArray(bundle.steps)).toBe(true);
    } finally {
      await r.app.close();
    }
  });

  it('returns 404 for non-existent run', async () => {
    const res = await runner.app.inject({ method: 'GET', url: '/runs/run_nope/diagnostics' });
    expect(res.statusCode).toBe(404);
  });
});

describe('workflow splice (re-record from here)', () => {
  it('splices new recording steps into an existing workflow', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const r = buildRunnerServer(baseEnv, { repository: repo });
    await r.app.ready();
    try {
      // Create initial workflow with 2 steps
      await r.app.inject({ method: 'POST', url: '/recordings', payload: sampleRecording });
      const { workflows } = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: { id: string }[];
      };
      const wfId = workflows[0]!.id;

      // Get the initial step count
      const defRes = await r.app.inject({ method: 'GET', url: `/workflows/${wfId}/definition` });
      const initialSteps = (defRes.json() as { workflow: { steps: { type: string }[] } }).workflow.steps;

      // Splice from step index 1 (keep step 0, replace everything after)
      const spliceRecording = {
        recordingId: 'rec_splice',
        name: 'Splice recording',
        startedAt: '2026-04-15T10:00:00.000Z',
        events: [
          { eventId: 's1', type: 'navigate', atMs: 0, tabId: 't1', url: 'https://new-page.com' },
          {
            eventId: 's2', type: 'click', atMs: 50, tabId: 't1',
            target: { primaryLocator: { kind: 'role', role: 'button', name: 'Submit' }, fallbackLocators: [] },
            button: 'left'
          },
          {
            eventId: 's3', type: 'click', atMs: 100, tabId: 't1',
            target: { primaryLocator: { kind: 'testId', testId: 'confirm' }, fallbackLocators: [] },
            button: 'left'
          }
        ]
      };

      const res = await r.app.inject({
        method: 'POST',
        url: `/workflows/${wfId}/splice`,
        payload: { fromStepIndex: 1, recording: spliceRecording }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { workflowId: string; workflowVersion: number; stepsReplaced: number };
      expect(body.workflowId).toBe(wfId);
      expect(body.stepsReplaced).toBe(initialSteps.length - 1);

      // Verify the spliced workflow
      const updatedDef = await r.app.inject({ method: 'GET', url: `/workflows/${wfId}/definition` });
      const updatedWorkflow = (updatedDef.json() as { workflow: { steps: { type: string }[] } }).workflow;
      // First step should be from the original, rest from the new recording
      expect(updatedWorkflow.steps[0]!.type).toBe(initialSteps[0]!.type);
      expect(updatedWorkflow.steps.length).toBeGreaterThan(1);
    } finally {
      await r.app.close();
    }
  });

  it('returns 400 for out-of-range fromStepIndex', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const r = buildRunnerServer(baseEnv, { repository: repo });
    await r.app.ready();
    try {
      await r.app.inject({ method: 'POST', url: '/recordings', payload: sampleRecording });
      const { workflows } = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: { id: string }[];
      };
      const res = await r.app.inject({
        method: 'POST',
        url: `/workflows/${workflows[0]!.id}/splice`,
        payload: { fromStepIndex: 999, recording: sampleRecording }
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await r.app.close();
    }
  });

  it('returns 404 for non-existent workflow', async () => {
    const res = await runner.app.inject({
      method: 'POST',
      url: '/workflows/wf_nope/splice',
      payload: { fromStepIndex: 0, recording: sampleRecording }
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('auth profile CRUD', () => {
  it('creates, lists, and deletes an auth profile', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const r = buildRunnerServer(baseEnv, { repository: repo });
    await r.app.ready();
    try {
      const create = await r.app.inject({
        method: 'POST',
        url: '/auth-profiles',
        payload: { name: 'Test profile', browserEngine: 'chromium' }
      });
      expect(create.statusCode).toBe(200);
      const { profile } = create.json() as { profile: { id: string; name: string } };
      expect(profile.name).toBe('Test profile');

      const list = await r.app.inject({ method: 'GET', url: '/auth-profiles' });
      expect(list.statusCode).toBe(200);
      const { profiles } = list.json() as { profiles: { id: string; status: string }[] };
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.status).toBe('never_initialized');

      const del = await r.app.inject({ method: 'DELETE', url: `/auth-profiles/${profile.id}` });
      expect(del.statusCode).toBe(200);

      const listAfter = (await r.app.inject({ method: 'GET', url: '/auth-profiles' })).json() as {
        profiles: unknown[];
      };
      expect(listAfter.profiles).toHaveLength(0);
    } finally {
      await r.app.close();
    }
  });

  it('returns 404 when deleting a non-existent profile', async () => {
    const res = await runner.app.inject({ method: 'DELETE', url: '/auth-profiles/nope' });
    expect(res.statusCode).toBe(404);
  });
});

describe('schedule CRUD', () => {
  it('creates, lists, updates, and deletes a schedule', async () => {
    const repo = openWaypointDatabase(':memory:').repository;
    const r = buildRunnerServer(baseEnv, { repository: repo });
    await r.app.ready();
    try {
      // Need a workflow first.
      await r.app.inject({ method: 'POST', url: '/recordings', payload: sampleRecording });
      const { workflows } = (await r.app.inject({ method: 'GET', url: '/workflows' })).json() as {
        workflows: { id: string }[];
      };
      const wfId = workflows[0]!.id;

      // Create schedule.
      const create = await r.app.inject({
        method: 'POST',
        url: '/schedules',
        payload: {
          workflowId: wfId,
          pattern: { kind: 'weekdays' },
          timezone: 'America/Chicago',
          hour: 9,
          minute: 0,
          enabled: true,
          missedRunPolicy: 'skip'
        }
      });
      expect(create.statusCode).toBe(200);
      const { schedule } = create.json() as { schedule: { id: string } };
      const parsed = ScheduleSchema.parse((create.json() as { schedule: unknown }).schedule);
      expect(parsed.pattern.kind).toBe('weekdays');
      expect(parsed.hour).toBe(9);

      // List schedules.
      const list = (await r.app.inject({ method: 'GET', url: '/schedules' })).json() as {
        schedules: unknown[];
      };
      expect(list.schedules).toHaveLength(1);

      // Update schedule.
      const update = await r.app.inject({
        method: 'PUT',
        url: `/schedules/${schedule.id}`,
        payload: { hour: 10, pattern: { kind: 'daily' } }
      });
      expect(update.statusCode).toBe(200);
      const updated = (update.json() as { schedule: { hour: number; pattern: { kind: string } } }).schedule;
      expect(updated.hour).toBe(10);
      expect(updated.pattern.kind).toBe('daily');

      // Delete schedule.
      const del = await r.app.inject({ method: 'DELETE', url: `/schedules/${schedule.id}` });
      expect(del.statusCode).toBe(200);
      const listAfter = (await r.app.inject({ method: 'GET', url: '/schedules' })).json() as {
        schedules: unknown[];
      };
      expect(listAfter.schedules).toHaveLength(0);
    } finally {
      await r.app.close();
    }
  });

  it('returns 404 when creating a schedule for a non-existent workflow', async () => {
    const res = await runner.app.inject({
      method: 'POST',
      url: '/schedules',
      payload: {
        workflowId: 'wf_nonexistent',
        pattern: { kind: 'daily' },
        timezone: 'UTC',
        hour: 8,
        minute: 0,
        enabled: true,
        missedRunPolicy: 'skip'
      }
    });
    expect(res.statusCode).toBe(404);
  });
});
