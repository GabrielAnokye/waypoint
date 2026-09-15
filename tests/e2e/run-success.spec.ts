import { expect, test } from '@playwright/test';

const sampleRecording = {
  recordingId: 'rec_e2e_success',
  name: 'E2E success flow',
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
        primaryLocator: { kind: 'role', role: 'button', name: 'Submit' },
        fallbackLocators: []
      },
      button: 'left'
    }
  ]
};

test('POST /recordings compiles and persists, then run succeeds', async ({ request }) => {
  // 1. Save a recording.
  const save = await request.post('/recordings', { data: sampleRecording });
  expect(save.ok()).toBeTruthy();
  const { workflowId, workflowVersion } = (await save.json()) as {
    recordingId: string;
    workflowId: string;
    workflowVersion: number;
  };
  expect(workflowId).toBeTruthy();
  expect(workflowVersion).toBe(1);

  // 2. Verify workflow is listed.
  const list = await request.get('/workflows');
  expect(list.ok()).toBeTruthy();
  const { workflows } = (await list.json()) as {
    workflows: Array<{ id: string }>;
  };
  expect(workflows.some((w) => w.id === workflowId)).toBeTruthy();

  // 3. Start a run.
  const start = await request.post(`/workflows/${workflowId}/run`, { data: {} });
  expect(start.ok()).toBeTruthy();
  const { runId } = (await start.json()) as { runId: string };
  expect(runId).toBeTruthy();

  // 4. Poll until completed.
  let runGraph: { run: { status: string }; steps: unknown[]; artifacts: unknown[] } | null = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const resp = await request.get(`/runs/${runId}`);
    if (resp.ok()) {
      const body = (await resp.json()) as typeof runGraph;
      if (body?.run.status === 'succeeded' || body?.run.status === 'failed') {
        runGraph = body;
        break;
      }
    }
  }

  expect(runGraph).not.toBeNull();
  expect(runGraph!.run.status).toBe('succeeded');
  expect(runGraph!.steps.length).toBeGreaterThanOrEqual(2);
});

test('GET /runs lists runs for a workflow', async ({ request }) => {
  // Save + run first.
  const save = await request.post('/recordings', { data: sampleRecording });
  const { workflowId } = (await save.json()) as { workflowId: string };
  await request.post(`/workflows/${workflowId}/run`, { data: {} });
  await new Promise((r) => setTimeout(r, 300));

  const resp = await request.get(`/runs?workflowId=${workflowId}`);
  expect(resp.ok()).toBeTruthy();
  const { runs } = (await resp.json()) as { runs: Array<{ id: string }> };
  expect(runs.length).toBeGreaterThanOrEqual(1);
});
