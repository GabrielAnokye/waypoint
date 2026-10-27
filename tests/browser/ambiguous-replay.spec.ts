import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page, type APIRequestContext } from '@playwright/test';
import type { RecordingSessionInput, RunGraph, Workflow } from '@waypoint/shared-types';
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

async function message<T>(type: string, extra: Record<string, unknown> = {}): Promise<T> {
  const result = await panel.evaluate(async ({ type, extra }) => {
    return chrome.runtime.sendMessage({ type, ...extra });
  }, { type, extra });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result.payload as T;
}

async function hits(): Promise<Hit[]> {
  return page.evaluate(() => (window as unknown as { replayHits: Hit[] }).replayHits);
}

async function resetPage(): Promise<void> {
  await page.goto(fixtureUrl);
  await page.evaluate(() => {
    const log = document.createElement('aside');
    log.id = 'replay-evidence';
    log.style.cssText = 'position:fixed;right:10px;top:10px;width:210px;padding:16px;background:#123;color:white;z-index:9999;font:14px system-ui;border-radius:8px';
    log.innerHTML = '<strong>Actual trusted click events</strong><ol></ol><p>No clicks yet</p>';
    document.body.append(log);
    const replayHits: Hit[] = [];
    (window as unknown as { replayHits: Hit[] }).replayHits = replayHits;
    document.addEventListener('click', event => {
      const el = event.target as Element;
      if (el.tagName !== 'BUTTON' || el.textContent !== 'Delete') return;
      const item = el.previousElementSibling?.textContent?.trim() ?? '';
      const hit = { item, truthId: el.getAttribute('data-truth-id'), trusted: event.isTrusted };
      replayHits.push(hit);
      const row = document.createElement('li');
      row.textContent = `${item}: ${hit.truthId} (trusted=${event.isTrusted})`;
      log.querySelector('ol')!.append(row);
      log.querySelector('p')!.textContent = `${replayHits.length} actual click(s)`;
    }, true);
  });
}

async function run(request: APIRequestContext, steps = workflow.steps): Promise<RunGraph> {
  const edit = await request.put(`/workflows/${workflow.workflowId}/definition`, { data: { steps } });
  expect(edit.ok()).toBe(true);
  const started = await request.post(`/workflows/${workflow.workflowId}/run`, {
    data: { engine: 'attached', targetUrl: fixtureUrl }
  });
  expect(started.ok()).toBe(true);
  const { runId } = await started.json();
  let graph: RunGraph;
  await expect.poll(async () => {
    const response = await request.get(`/runs/${runId}`);
    if (response.status() === 404) return 'running'; // Graph persists at completion.
    expect(response.ok()).toBe(true);
    graph = await response.json();
    return graph.run.status;
  }, { timeout: 30_000 }).toMatch(/^(succeeded|failed)$/);
  await test.info().attach('persisted-run.json', { body: JSON.stringify(graph!, null, 2), contentType: 'application/json' });
  return graph!;
}

async function evidence(name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await test.info().attach('actual-click-events.json', { body: JSON.stringify(await hits(), null, 2), contentType: 'application/json' });
}

test.beforeAll(async () => {
  const html = await readFile(resolve('tests/fixtures/demo-pages/ambiguous.html'));
  server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  fixtureUrl = `http://127.0.0.1:${address.port}/ambiguous.html`;
});

test.beforeEach(async ({ request }, info) => {
  const extensionPath = resolve('apps/extension/dist');
  const launch = () => chromium.launchPersistentContext(info.outputPath('profile'), {
    channel: 'chromium', headless: info.project.use.headless !== false,
    slowMo: info.project.use.headless === false ? 150 : 0,
    viewport: { width: 1280, height: 900 }, recordVideo: { dir: info.outputPath('video') },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--remote-debugging-port=9223']
  });
  context = await launch();
  await (context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker'));
  // Reload the extension from the rebuilt dist by restarting this dedicated
  // browser profile. runtime.reload() disables command-line-loaded extensions
  // on some Chromium builds, so do not depend on it for this regression.
  await context.close();
  context = await launch();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await message('waypoint.ping');
  page = await context.newPage();
  await resetPage();
  await page.bringToFront();
  await message('waypoint.recording.start', { name: `Ambiguity regression: ${info.title}` });
  await expect.poll(async () => panel.evaluate(async url => {
    const tabs = await chrome.tabs.query({ url });
    const tab = tabs[0];
    if (!tab?.id) return false;
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: () => Boolean((window as unknown as { __waypointRecorder__?: unknown }).__waypointRecorder__)
    });
    return result?.result;
  }, fixtureUrl)).toBe(true);
  for (const item of ['Alpha', 'Beta', 'Gamma']) {
    // Recording uses visible item context, never the oracle attribute.
    await page.locator('.card').filter({ hasText: `Item ${item}` }).getByRole('button', { name: 'Delete', exact: true }).click();
  }
  const recording = await message<RecordingSessionInput>('waypoint.recording.stop');
  const clickEvents = recording.events.filter(e => e.type === 'click');
  expect(clickEvents).toHaveLength(3);
  expect(clickEvents.map(e => e.target.dataTruthId)).toEqual(identities);
  const saved = await request.post('/recordings', { data: recording });
  expect(saved.ok()).toBe(true);
  const { workflowId } = await saved.json();
  workflow = (await (await request.get(`/workflows/${workflowId}/definition`)).json()).workflow;
  expect(workflow.steps.filter(s => s.type === 'click')).toHaveLength(3);
  for (const step of workflow.steps) {
    if (!('primaryLocator' in step)) continue;
    expect(JSON.stringify([step.primaryLocator, step.fallbackLocators])).not.toContain('data-truth-id');
  }
  await info.attach('recording.json', { body: JSON.stringify(recording, null, 2), contentType: 'application/json' });
  await resetPage();
});

test.afterEach(async () => {
  if (context) {
    const video = page?.video();
    await context.close();
    if (video) await test.info().attach('browser-video', { path: await video.path(), contentType: 'video/webm' });
  }
});

test.afterAll(async () => {
  await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
});

test('recorded Alpha, Beta and Gamma reach three distinct actual targets', async ({ request }) => {
  const graph = await run(request);
  expect(graph.run.status).toBe('succeeded');
  expect(await hits()).toEqual(identities.map((truthId, i) => ({ item: `Item ${['Alpha', 'Beta', 'Gamma'][i]}`, truthId, trusted: true })));
  const clicks = graph.steps.filter(s => s.stepType === 'click');
  expect(clicks.map(s => s.expectedTruthId)).toEqual(identities);
  expect(clicks.map(s => s.resolvedTruthId)).toEqual(identities);
  expect(clicks.map(s => s.truthClassification)).toEqual(['true_positive', 'true_positive', 'true_positive']);
  expect(clicks.every(s => s.usedFallback && s.resolvedLocator?.kind === 'css')).toBe(true);
  await expect(page.locator('#status')).toHaveText('Deleted Gamma');
  await evidence('three-correct-clicks');
});

test('removing distinguishing DOM selectors safely abstains even with truth IDs present', async ({ request }) => {
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
  expect(await page.getByRole('button', { name: 'Delete', exact: true }).count()).toBe(3);
  const graph = await run(request);
  expect(graph.run.status).toBe('failed');
  expect(graph.run.errorCode).toBe('ambiguous_locator');
  expect(await hits()).toEqual([]);
  const failed = graph.steps.find(s => s.status === 'failed')!;
  expect(failed.truthClassification).toBe('true_negative');
  expect(failed.expectedTruthId).toBe('delete-alpha');
  expect(failed.resolvedTruthId).toBeUndefined();
  expect(failed.debug.extra.repairRecord).toMatchObject({ failureCode: 'ambiguous_locator', confidence: 0 });
  expect(graph.steps.filter(s => s.stepType === 'click' && s.status === 'succeeded')).toHaveLength(0);
  await evidence('safe-abstention');
});

test('a unique but wrong fallback records the wrong actual identity as false_positive', async ({ request }) => {
  const clicks = workflow.steps.filter(s => s.type === 'click');
  const beta = clicks[1]!;
  const alphaCss = clicks[0]!.fallbackLocators.find(l => l.kind === 'css')!;
  const graph = await run(request, [{ ...beta, fallbackLocators: [alphaCss] }]);
  expect(await hits()).toEqual([{ item: 'Item Alpha', truthId: 'delete-alpha', trusted: true }]);
  expect(graph.steps[0]).toMatchObject({
    expectedTruthId: 'delete-beta', resolvedTruthId: 'delete-alpha', truthClassification: 'false_positive', usedFallback: true
  });
  await evidence('wrong-target-classified');
});

test('benchmark intent cannot borrow structural fallbacks; structural succeeds independently', async () => {
  for (const allowedFamily of ['intent', 'testContract', 'structural', 'coordinate'] as const) {
    await resetPage();
    const launcher = createPlaywrightLauncher({ cdpEndpoint: 'http://127.0.0.1:9223', slowMo: 0, keepOpenMs: 0, allowedFamily });
    await launcher.resetForRun?.({ targetUrl: fixtureUrl });
    // Clicks alone: inferred element waits are not meaningful for coordinates.
    const trial = { ...workflow, steps: workflow.steps.filter(s => s.type === 'click') };
    const graph = await buildRunGraph(trial, executeWorkflow(trial, { launcher }), { workflowVersionId: 'family-trial' });
    await test.info().attach(`${allowedFamily}-run.json`, { body: JSON.stringify(graph, null, 2), contentType: 'application/json' });
    if (allowedFamily === 'intent' || allowedFamily === 'testContract') {
      expect(graph.run.status).toBe('failed');
      expect(await hits()).toEqual([]);
      expect(graph.run.errorCode).toBe(allowedFamily === 'intent' ? 'ambiguous_locator' : 'locator_not_found');
    } else {
      expect(graph.run.status).toBe('succeeded');
      expect((await hits()).map(hit => hit.truthId)).toEqual(identities);
      expect(graph.steps.map(s => s.truthClassification)).toEqual(['true_positive', 'true_positive', 'true_positive']);
      expect(graph.steps.every(s => s.resolvedLocator?.kind === (allowedFamily === 'structural' ? 'css' : 'coordinates'))).toBe(true);
    }
  }
});

test('a locator that becomes ambiguous after resolution never clicks its first match', async ({ request }) => {
  const alpha = workflow.steps.find(s => s.type === 'click')!;
  await page.evaluate(() => {
    const button = document.querySelector('.card button')!;
    button.id = 'race-target';
    button.addEventListener('focus', () => {
      const duplicate = button.cloneNode(true);
      button.parentElement!.append(duplicate);
    }, { once: true });
  });
  const graph = await run(request, [{ ...alpha, primaryLocator: { kind: 'css', selector: '#race-target' }, fallbackLocators: [] }]);
  expect(graph.run.status).toBe('failed');
  expect(graph.run.errorCode).toBe('ambiguous_locator');
  expect(await hits()).toEqual([]);
});
