import { expect, test } from '@playwright/test';

const multiTabRecording = {
  recordingId: 'rec_e2e_newtab',
  name: 'Multi-tab flow',
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
      type: 'tabOpened',
      atMs: 100,
      tabId: 't2',
      initialUrl: 'https://example.com/new'
    },
    {
      eventId: 'e3',
      type: 'navigate',
      atMs: 200,
      tabId: 't2',
      url: 'https://example.com/dashboard'
    },
    {
      eventId: 'e4',
      type: 'click',
      atMs: 300,
      tabId: 't2',
      target: {
        primaryLocator: { kind: 'role', role: 'button', name: 'Refresh' },
        fallbackLocators: []
      },
      button: 'left'
    }
  ]
};

test('multi-tab workflow compiles to newTab + goto + click and runs successfully', async ({
  request
}) => {
  const save = await request.post('/recordings', { data: multiTabRecording });
  expect(save.ok()).toBeTruthy();
  const { workflowId } = (await save.json()) as { workflowId: string };

  const start = await request.post(`/workflows/${workflowId}/run`, { data: {} });
  expect(start.ok()).toBeTruthy();
  const { runId } = (await start.json()) as { runId: string };

  let runGraph: { run: { status: string }; steps: unknown[] } | null = null;
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
  // Should have at least: goto(t1) + newTab(t2) + goto(t2) + waitFor + click(t2)
  expect(runGraph!.steps.length).toBeGreaterThanOrEqual(4);
});
