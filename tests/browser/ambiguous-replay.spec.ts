import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import type {
  AttachedTarget,
  RecordingSessionInput,
  RunGraph,
  Workflow,
} from '@waypoint/shared-types';
import { WorkflowStepSchema } from '@waypoint/shared-types';
import { createPlaywrightLauncher } from '../../apps/runner/src/core/playwright-launcher.js';
import { executeWorkflow } from '../../apps/runner/src/core/executor.js';
import { buildRunGraph } from '../../apps/runner/src/core/persist.js';

type Hit = { item: string; truthId: string | null; trusted: boolean };
const identities = ['delete-alpha', 'delete-beta', 'delete-gamma'];
let context: BrowserContext;
let page: Page;
let panel: Page;
let server: Server;
let fixtureUrl: string;
let workflow: Workflow;

async function message<T>(
  type: string,
  extra: Record<string, unknown> = {}
): Promise<T> {
  const result = await panel.evaluate(
    async ({ type, extra }) => {
      return chrome.runtime.sendMessage({ type, ...extra });
    },
    { type, extra }
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result.payload as T;
}

async function hits(): Promise<Hit[]> {
  return page.evaluate(() => (window as unknown as { replayHits: Hit[] }).replayHits);
}

function installEvidence(): void {
  document.addEventListener('DOMContentLoaded', () => {
    const log = document.createElement('aside');
    log.id = 'replay-evidence';
    log.style.cssText =
      'position:fixed;right:10px;top:10px;width:210px;padding:16px;background:#123;color:white;z-index:9999;font:14px system-ui;border-radius:8px';
    log.innerHTML =
      '<strong>Actual trusted click events</strong><ol></ol><p>No clicks yet</p>';
    document.body.append(log);
    const replayHits: Hit[] = [];
    (window as unknown as { replayHits: Hit[] }).replayHits = replayHits;
    document.addEventListener(
      'click',
      (event) => {
        const el = event.target as Element;
        if (el.tagName !== 'BUTTON' || el.textContent !== 'Delete') return;
        const item = el.previousElementSibling?.textContent?.trim() ?? '';
        const hit = {
          item,
          truthId: el.getAttribute('data-truth-id'),
          trusted: event.isTrusted,
        };
        replayHits.push(hit);
        const row = document.createElement('li');
        row.textContent = `${item}: ${hit.truthId} (trusted=${event.isTrusted})`;
        log.querySelector('ol')!.append(row);
        log.querySelector('p')!.textContent = `${replayHits.length} actual click(s)`;
      },
      true
    );
  });
}

async function resetPage(): Promise<void> {
  await page.goto(fixtureUrl);
}

async function captureTarget(): Promise<AttachedTarget> {
  await page.bringToFront();
  const windowId = await panel.evaluate(
    async () => (await chrome.windows.getCurrent()).id!
  );
  return message<AttachedTarget>('waypoint.playback.captureTarget', { windowId });
}

async function run(
  request: APIRequestContext,
  steps = workflow.steps,
  reloadBeforeRun = false
): Promise<RunGraph> {
  const edit = await request.put(`/workflows/${workflow.workflowId}/definition`, {
    data: { steps },
  });
  expect(edit.ok()).toBe(true);
  const started = await request.post(`/workflows/${workflow.workflowId}/run`, {
    data: {
      engine: 'attached',
      attachedTarget: await captureTarget(),
      reloadBeforeRun,
    },
  });
  expect(started.ok()).toBe(true);
  const { runId } = await started.json();
  let graph: RunGraph;
  await expect
    .poll(
      async () => {
        const response = await request.get(`/runs/${runId}`);
        if (response.status() === 404) return 'running'; // Graph persists at completion.
        expect(response.ok()).toBe(true);
        graph = await response.json();
        return graph.run.status;
      },
      { timeout: 30_000 }
    )
    .toMatch(/^(succeeded|failed)$/);
  await test.info().attach('persisted-run.json', {
    body: JSON.stringify(graph!, null, 2),
    contentType: 'application/json',
  });
  return graph!;
}

async function evidence(name: string): Promise<void> {
  await test.info().attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await test.info().attach('actual-click-events.json', {
    body: JSON.stringify(await hits(), null, 2),
    contentType: 'application/json',
  });
}

test.beforeAll(async () => {
  const html = await readFile(resolve('tests/fixtures/demo-pages/ambiguous.html'));
  server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  fixtureUrl = `http://127.0.0.1:${address.port}/ambiguous.html`;
});

test.beforeEach(async ({ request }, info) => {
  const extensionPath = resolve('apps/extension/dist');
  const launch = () =>
    chromium.launchPersistentContext(info.outputPath('profile'), {
      channel: 'chromium',
      headless: info.project.use.headless !== false,
      slowMo: info.project.use.headless === false ? 150 : 0,
      viewport: { width: 1280, height: 900 },
      recordVideo: { dir: info.outputPath('video') },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--remote-debugging-port=9223',
      ],
    });
  context = await launch();
  await (context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker'));
  // Reload the extension from the rebuilt dist by restarting this dedicated
  // browser profile. runtime.reload() disables command-line-loaded extensions
  // on some Chromium builds, so do not depend on it for this regression.
  await context.close();
  context = await launch();
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await message('waypoint.ping');
  await context.addInitScript(installEvidence);
  page = await context.newPage();
  await resetPage();
  await page.bringToFront();
  await message('waypoint.recording.start', {
    name: `Ambiguity regression: ${info.title}`,
  });
  await expect
    .poll(async () =>
      panel.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({ url });
        const tab = tabs[0];
        if (!tab?.id) return false;
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () =>
            Boolean(
              (window as unknown as { __waypointRecorder__?: unknown })
                .__waypointRecorder__
            ),
        });
        return result?.result;
      }, fixtureUrl)
    )
    .toBe(true);
  for (const item of ['Alpha', 'Beta', 'Gamma']) {
    // Recording uses visible item context, never the oracle attribute.
    await page
      .locator('.card')
      .filter({ hasText: `Item ${item}` })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
  }
  const recording = await message<RecordingSessionInput>('waypoint.recording.stop');
  const clickEvents = recording.events.filter((e) => e.type === 'click');
  expect(clickEvents).toHaveLength(3);
  expect(clickEvents.map((e) => e.target.dataTruthId)).toEqual(identities);
  const saved = await request.post('/recordings', { data: recording });
  expect(saved.ok()).toBe(true);
  const { workflowId } = await saved.json();
  workflow = (await (await request.get(`/workflows/${workflowId}/definition`)).json())
    .workflow;
  expect(workflow.steps.filter((s) => s.type === 'click')).toHaveLength(3);
  for (const step of workflow.steps) {
    if (!('primaryLocator' in step)) continue;
    expect(JSON.stringify([step.primaryLocator, step.fallbackLocators])).not.toContain(
      'data-truth-id'
    );
  }
  await info.attach('recording.json', {
    body: JSON.stringify(recording, null, 2),
    contentType: 'application/json',
  });
  await resetPage();
});

test.afterEach(async () => {
  if (context) {
    const video = page?.video();
    await context.close();
    if (video)
      await test.info().attach('browser-video', {
        path: await video.path(),
        contentType: 'video/webm',
      });
  }
});

test.afterAll(async () => {
  await new Promise<void>((done, reject) =>
    server.close((err) => (err ? reject(err) : done()))
  );
});

test('recorded Alpha, Beta and Gamma reach three distinct actual targets', async ({
  request,
}) => {
  const graph = await run(request);
  expect(graph.run.status).toBe('succeeded');
  expect(await hits()).toEqual(
    identities.map((truthId, i) => ({
      item: `Item ${['Alpha', 'Beta', 'Gamma'][i]}`,
      truthId,
      trusted: true,
    }))
  );
  const clicks = graph.steps.filter((s) => s.stepType === 'click');
  expect(clicks.map((s) => s.expectedTruthId)).toEqual(identities);
  expect(clicks.map((s) => s.resolvedTruthId)).toEqual(identities);
  expect(clicks.map((s) => s.truthClassification)).toEqual([
    'true_positive',
    'true_positive',
    'true_positive',
  ]);
  expect(clicks.every((s) => s.usedFallback && s.resolvedLocator?.kind === 'css')).toBe(
    true
  );
  await expect(page.locator('#status')).toHaveText('Deleted Gamma');
  await evidence('three-correct-clicks');
});

test('removing distinguishing DOM selectors safely abstains even with truth IDs present', async ({
  request,
}) => {
  await page.evaluate(() => {
    for (const card of document.querySelectorAll('.card')) {
      const wrapper = document.createElement('section');
      const button = card.querySelector('button')!;
      // Remove recorded CSS/XPath ancestor paths; retain the three identical
      // buttons, click handlers and oracle IDs so a truth-id cheat would show.
      button.removeAttribute('class');
      wrapper.append(...card.childNodes);
      card.replaceWith(wrapper);
    }
  });
  expect(await page.getByRole('button', { name: 'Delete', exact: true }).count()).toBe(
    3
  );
  const graph = await run(request);
  expect(graph.run.status).toBe('failed');
  expect(graph.run.errorCode).toBe('ambiguous_locator');
  expect(await hits()).toEqual([]);
  const failed = graph.steps.find((s) => s.status === 'failed')!;
  expect(failed.truthClassification).toBe('true_negative');
  expect(failed.expectedTruthId).toBe('delete-alpha');
  expect(failed.resolvedTruthId).toBeUndefined();
  expect(failed.debug.extra.repairRecord).toMatchObject({
    failureCode: 'ambiguous_locator',
    confidence: 0,
  });
  expect(
    graph.steps.filter((s) => s.stepType === 'click' && s.status === 'succeeded')
  ).toHaveLength(0);
  await evidence('safe-abstention');
});

test('a unique but wrong fallback records the wrong actual identity as false_positive', async ({
  request,
}) => {
  const clicks = workflow.steps.filter((s) => s.type === 'click');
  const beta = clicks[1]!;
  const alphaCss = clicks[0]!.fallbackLocators.find((l) => l.kind === 'css')!;
  const graph = await run(request, [{ ...beta, fallbackLocators: [alphaCss] }]);
  expect(await hits()).toEqual([
    { item: 'Item Alpha', truthId: 'delete-alpha', trusted: true },
  ]);
  expect(graph.steps[0]).toMatchObject({
    expectedTruthId: 'delete-beta',
    resolvedTruthId: 'delete-alpha',
    truthClassification: 'false_positive',
    usedFallback: true,
  });
  await evidence('wrong-target-classified');
});

test('benchmark intent cannot borrow structural fallbacks; structural succeeds independently', async () => {
  for (const allowedFamily of [
    'intent',
    'testContract',
    'structural',
    'coordinate',
  ] as const) {
    await resetPage();
    const launcher = createPlaywrightLauncher({
      mode: 'attached',
      cdpEndpoint: 'http://127.0.0.1:9223',
      slowMo: 0,
      keepOpenMs: 0,
      allowedFamily,
    });
    await launcher.resetForRun?.({ attachedTarget: await captureTarget() });
    // Clicks alone: inferred element waits are not meaningful for coordinates.
    const trial = {
      ...workflow,
      steps: workflow.steps.filter((s) => s.type === 'click'),
    };
    const graph = await buildRunGraph(trial, executeWorkflow(trial, { launcher }), {
      workflowVersionId: 'family-trial',
    });
    await test.info().attach(`${allowedFamily}-run.json`, {
      body: JSON.stringify(graph, null, 2),
      contentType: 'application/json',
    });
    if (allowedFamily === 'intent' || allowedFamily === 'testContract') {
      expect(graph.run.status).toBe('failed');
      expect(await hits()).toEqual([]);
      expect(graph.run.errorCode).toBe(
        allowedFamily === 'intent' ? 'ambiguous_locator' : 'locator_not_found'
      );
    } else {
      expect(graph.run.status).toBe('succeeded');
      expect((await hits()).map((hit) => hit.truthId)).toEqual(identities);
      expect(graph.steps.map((s) => s.truthClassification)).toEqual([
        'true_positive',
        'true_positive',
        'true_positive',
      ]);
      expect(
        graph.steps.every(
          (s) =>
            s.resolvedLocator?.kind ===
            (allowedFamily === 'structural' ? 'css' : 'coordinates')
        )
      ).toBe(true);
    }
  }
});

test('a locator that becomes ambiguous after resolution never clicks its first match', async ({
  request,
}) => {
  const alpha = workflow.steps.find((s) => s.type === 'click')!;
  await page.evaluate(() => {
    const button = document.querySelector('.card button')!;
    button.id = 'race-target';
    button.addEventListener(
      'focus',
      () => {
        const duplicate = button.cloneNode(true);
        button.parentElement!.append(duplicate);
      },
      { once: true }
    );
  });
  const graph = await run(request, [
    {
      ...alpha,
      primaryLocator: { kind: 'css', selector: '#race-target' },
      fallbackLocators: [],
    },
  ]);
  expect(graph.run.status).toBe('failed');
  expect(graph.run.errorCode).toBe('ambiguous_locator');
  expect(await hits()).toEqual([]);
});

test('identical URLs select the exact second tab and preserve every existing page', async ({
  request,
}) => {
  const unrelated = page;
  page = await context.newPage();
  await resetPage();
  const before = [...context.pages()];
  await page.evaluate(() => {
    sessionStorage.setItem('attached-state', 'keep-me');
  });
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  const graph = await run(request);
  expect(graph.run.status).toBe('succeeded');
  expect(graph.run.metadata).toMatchObject({
    contextIsolation: 'attached',
    researchEligible: false,
  });
  expect(graph.run.metadata.selectedTargetId).toBeTruthy();
  expect((await hits()).map((hit) => hit.truthId)).toEqual(identities);
  expect(
    await unrelated.evaluate(
      () => (window as unknown as { replayHits: Hit[] }).replayHits
    )
  ).toEqual([]);
  expect(navigations).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('attached-state'))).toBe(
    'keep-me'
  );
  expect(context.pages()).toEqual(before);
  expect(before.every((existing) => !existing.isClosed())).toBe(true);
  await evidence('exact-second-tab');
});

test('a different starting URL navigates the selected existing tab once', async ({
  request,
}) => {
  await page.goto(fixtureUrl.replace('ambiguous.html', 'another-page.html'));
  const before = [...context.pages()];
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  const graph = await run(request);
  expect(graph.run.status).toBe('succeeded');
  expect(page.url()).toBe(fixtureUrl);
  expect(navigations).toBe(1);
  expect((await hits()).map((hit) => hit.truthId)).toEqual(identities);
  expect(context.pages()).toEqual(before);
  await evidence('same-tab-navigation');
});

test('explicit refresh reloads the selected page once and preserves stored authentication state', async ({
  request,
}) => {
  await page.evaluate(() => {
    localStorage.setItem('test-session', 'authenticated');
  });
  await context.addCookies([{ name: 'test-auth', value: 'keep', url: fixtureUrl }]);
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  const graph = await run(request, workflow.steps, true);
  expect(graph.run.status).toBe('succeeded');
  expect(navigations).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('test-session'))).toBe(
    'authenticated'
  );
  expect(
    (await context.cookies()).find((cookie) => cookie.name === 'test-auth')?.value
  ).toBe('keep');
  expect((await hits()).map((hit) => hit.truthId)).toEqual(identities);
});

test('missing or stale tab identity returns an actionable error with no replacement page', async ({
  request,
}) => {
  const before = [...context.pages()];
  const missing = await request.post(`/workflows/${workflow.workflowId}/run`, {
    data: { engine: 'attached', targetUrl: fixtureUrl },
  });
  expect(missing.status()).toBe(400);
  const target = await captureTarget();
  await page.reload(); // The document proof no longer exists, even though URL is unchanged.
  const stale = await request.post(`/workflows/${workflow.workflowId}/run`, {
    data: { engine: 'attached', attachedTarget: target },
  });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ error: 'attached_target_not_found' });
  expect(await hits()).toEqual([]);
  expect(context.pages()).toEqual(before);
});

test('Run clean executes in isolation and leaves the selected browser untouched', async ({
  request,
}) => {
  const before = [...context.pages()];
  const start = await request.post(`/workflows/${workflow.workflowId}/run`, {
    data: { engine: 'isolated' },
  });
  expect(start.ok()).toBe(true);
  const { runId } = await start.json();
  let graph: RunGraph;
  await expect
    .poll(
      async () => {
        const response = await request.get(`/runs/${runId}`);
        if (response.status() === 404) return 'running';
        graph = await response.json();
        return graph.run.status;
      },
      { timeout: 30_000 }
    )
    .toBe('succeeded');
  expect(graph!.run.metadata).toMatchObject({
    contextIsolation: 'isolated',
    browserEngine: 'chromium',
    researchEligible: true,
  });
  expect(
    graph!.steps
      .filter((step) => step.stepType === 'click')
      .map((step) => step.resolvedTruthId)
  ).toEqual(identities);
  expect(await hits()).toEqual([]);
  expect(context.pages()).toEqual(before);
});

test('unavailable CDP refuses attachment and leaves the existing browser untouched', async () => {
  const before = [...context.pages()];
  const launcher = createPlaywrightLauncher({
    mode: 'attached',
    cdpEndpoint: 'http://127.0.0.1:9',
    keepOpenMs: 0,
  });
  await expect(
    launcher.resetForRun!({ attachedTarget: await captureTarget() })
  ).rejects.toMatchObject({ code: 'attached_browser_unavailable' });
  expect(context.pages()).toEqual(before);
  expect(await hits()).toEqual([]);
});

test('only an explicit recorded newTab step creates a page and leaves existing tabs open', async ({
  request,
}) => {
  const selected = page;
  const before = [...context.pages()];
  const graph = await run(request, [
    WorkflowStepSchema.parse({
      id: 'recorded-new-tab',
      type: 'newTab',
      initialUrl: fixtureUrl,
    }),
    ...workflow.steps.filter((step) => step.type === 'click'),
  ]);
  expect(graph.run.status).toBe('succeeded');
  expect(await hits()).toEqual([]);
  expect(context.pages()).toHaveLength(before.length + 1);
  expect(before.every((existing) => !existing.isClosed())).toBe(true);
  page = context.pages().find((existing) => !before.includes(existing))!;
  expect(page).not.toBe(selected);
  expect((await hits()).map((hit) => hit.truthId)).toEqual(identities);
  await evidence('explicit-recorded-new-tab');
});

test('the real side panel Run in open browser button replays in its active webpage', async ({
  request,
}, info) => {
  test.skip(
    info.project.use.headless !== false,
    'Native side panel demonstration requires a visible browser.'
  );
  await page.bringToFront();
  const browserSession = await context.browser()!.newBrowserCDPSession();
  const tabSession = await context.newCDPSession(panel);
  const { targetInfo: panelTabInfo } = await tabSession.send('Target.getTargetInfo');
  await tabSession.detach();
  await panel.evaluate(async () => {
    const window = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: window.id! });
  });
  // Native side panels are omitted from the default CDP target filter and
  // are not ordinary Playwright Pages. This test-only transport drives the UI;
  // replay still uses the
  // unchanged production Playwright launcher and resolver.
  let panelTargetId = '';
  await expect
    .poll(async () => {
      const { targetInfos } = await browserSession.send('Target.getTargets', {
        filter: [{ exclude: false }],
      });
      panelTargetId =
        targetInfos.find(
          (t) =>
            t.targetId !== panelTabInfo.targetId && t.url.endsWith('/sidepanel.html')
        )?.targetId ?? '';
      return panelTargetId;
    })
    .not.toBe('');
  const { sessionId } = await browserSession.send('Target.attachToTarget', {
    targetId: panelTargetId,
    flatten: false,
  });
  let commandId = 0;
  const pending = new Map<
    number,
    { resolve(value: Record<string, unknown>): void; reject(error: Error): void }
  >();
  browserSession.on('Target.receivedMessageFromTarget', (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  async function panelCommand(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const id = ++commandId;
    const answer = new Promise<Record<string, unknown>>((resolve, reject) =>
      pending.set(id, { resolve, reject })
    );
    await browserSession.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id, method, params }),
    });
    return answer;
  }
  async function panelEvaluate(expression: string): Promise<unknown> {
    const response = await panelCommand('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails)
      throw new Error(JSON.stringify(response.exceptionDetails));
    return (response.result as { value?: unknown })?.value;
  }
  // Redirect only this native panel's HTTP client to the fresh test runner.
  await panelEvaluate(`(() => {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => original(typeof input === 'string' ? input.replace('http://127.0.0.1:3100', 'http://127.0.0.1:3101') : input, init);
  })()`);
  const before = [...context.pages()];
  const buttonExpression = `Array.from(document.querySelectorAll('section.wp-card')).find(card => Array.from(card.querySelectorAll('p.wp-label')).some(label => label.textContent === ${JSON.stringify(workflow.name)}))?.querySelectorAll('button')[1]`;
  await expect.poll(() => panelEvaluate(`Boolean(${buttonExpression})`)).toBe(true);
  await panelEvaluate(`(${buttonExpression}).scrollIntoView({ block: 'center' })`);
  const rect = (await panelEvaluate(
    `(() => { const r = (${buttonExpression}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`
  )) as { x: number; y: number };
  await panelCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...rect,
    button: 'left',
    clickCount: 1,
  });
  await panelCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...rect,
    button: 'left',
    clickCount: 1,
  });
  let graph: RunGraph;
  await expect
    .poll(
      async () => {
        const listed = await (
          await request.get(`/runs?workflowId=${workflow.workflowId}`)
        ).json();
        const runId = listed.runs[0]?.id;
        if (!runId) return 'running';
        graph = await (await request.get(`/runs/${runId}`)).json();
        return graph.run.status;
      },
      { timeout: 15_000 }
    )
    .toBe('succeeded');
  expect((await hits()).map((hit) => hit.truthId)).toEqual(identities);
  expect(context.pages()).toEqual(before);
  await info.attach('side-panel-run.json', {
    body: JSON.stringify(graph!, null, 2),
    contentType: 'application/json',
  });
  const screenshot = await panelCommand('Page.captureScreenshot');
  await info.attach('native-side-panel', {
    body: Buffer.from(screenshot.data as string, 'base64'),
    contentType: 'image/png',
  });
  await browserSession.detach();
  await evidence('side-panel-correct-targets');
});

test('selected-page replay keeps the mutation URL for an existing file recording', async ({
  request,
}, info) => {
  const { startMutationServer } =
    await import('../../apps/runner/src/core/mutation/server.js');
  const mutations = await startMutationServer();
  const recordedFile = 'file:///fixture/ambiguous.html';
  try {
    const steps = workflow.steps.map((step) =>
      step.type === 'goto' ? { ...step, url: recordedFile } : step
    );
    expect(
      (
        await request.put(`/workflows/${workflow.workflowId}/definition`, {
          data: { steps },
        })
      ).ok()
    ).toBe(true);
    const selectedUrl = `${mutations.url}/ambiguous.html?mutation=layout&seed=live-regression`;
    await page.goto(selectedUrl);
    const payload = {
      engine: 'attached',
      attachedTarget: await captureTarget(),
      healingEnabled: true,
    };
    const blocked = await request.post(`/workflows/${workflow.workflowId}/run`, {
      data: payload,
    });
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error).toBe('unsafe_navigation');
    const started = await request.post(`/workflows/${workflow.workflowId}/run`, {
      data: { ...payload, useSelectedPage: true },
    });
    expect(started.ok()).toBe(true);
    const { runId } = await started.json();
    let graph: RunGraph;
    await expect
      .poll(async () => {
        const response = await request.get(`/runs/${runId}`);
        if (!response.ok()) return 'running';
        graph = await response.json();
        return graph.run.status;
      })
      .toBe('succeeded');
    expect(page.url()).toBe(selectedUrl);
    expect((await hits()).map((h) => h.truthId)).toEqual(identities);
    expect((await hits()).every((h) => h.trusted)).toBe(true);
    expect(graph!.run.metadata).toMatchObject({
      useSelectedPage: true,
      recordedStartUrl: recordedFile,
      replayStartUrl: selectedUrl,
      healingEnabled: true,
      researchEligible: false,
    });
    const saved = (
      await (await request.get(`/workflows/${workflow.workflowId}/definition`)).json()
    ).workflow;
    expect(
      saved.steps.find((s: Workflow['steps'][number]) => s.type === 'goto').url
    ).toBe(recordedFile);
    await info.attach('selected-page-run.json', {
      body: JSON.stringify(graph!, null, 2),
      contentType: 'application/json',
    });
    await evidence('mutated-page-correct-targets');
  } finally {
    await context.close();
    await mutations.stop();
  }
});

test('self-healing on the selected structural mutation safely halts with ranked Delete candidates', async ({
  request,
}, info) => {
  const { startMutationServer } =
    await import('../../apps/runner/src/core/mutation/server.js');
  const mutations = await startMutationServer();
  try {
    await page.goto(
      `${mutations.url}/ambiguous.html?mutation=cosmetic,structural&seed=live-regression`
    );
    const started = await request.post(`/workflows/${workflow.workflowId}/run`, {
      data: {
        engine: 'attached',
        attachedTarget: await captureTarget(),
        useSelectedPage: true,
        healingEnabled: true,
      },
    });
    expect(started.ok()).toBe(true);
    const { runId } = await started.json();
    let graph: RunGraph;
    await expect
      .poll(async () => {
        const response = await request.get(`/runs/${runId}`);
        if (!response.ok()) return 'running';
        graph = await response.json();
        return graph.run.status;
      })
      .toBe('failed');
    const halted = graph!.steps.find(
      (s) => s.healingOutcome === 'needs_manual_intervention'
    );
    expect(halted?.status).toBe('needs_manual_intervention');
    expect(halted?.topCandidates).toHaveLength(3);
    expect(halted?.ambiguityMargin).toBeLessThan(0.15);
    expect(await hits()).toEqual([]);
    await info.attach('manual-healing-run.json', {
      body: JSON.stringify(graph!, null, 2),
      contentType: 'application/json',
    });
    await evidence('mutated-page-safe-manual-halt');
  } finally {
    await context.close();
    await mutations.stop();
  }
});
