/**
 * Finds and launches a Chrome the runner can attach to over CDP.
 *
 * Attaching needs a browser started with --remote-debugging-port, and that
 * flag only applies at launch — an already-running Chrome cannot be opted in
 * after the fact. Recent stable Chrome also refuses Playwright's attach
 * handshake ("Browser context management is not supported"), so the Chrome for
 * Testing build Playwright installs is preferred over the system one.
 *
 * The browser is launched detached and deliberately never killed by the
 * runner: its whole purpose is to stay open across runs so page state carries
 * over and you can watch what happens.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SYSTEM_CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Preferred binary: newest Chrome for Testing, else system Chrome. */
export function findDebugBrowserBinary(): string | null {
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (existsSync(cache)) {
    const builds = readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds) {
      const bin = join(
        cache,
        build,
        'chrome-mac-arm64',
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing'
      );
      if (existsSync(bin)) return bin;
    }
  }
  return existsSync(SYSTEM_CHROME) ? SYSTEM_CHROME : null;
}

/** True once the CDP endpoint answers. */
async function endpointReady(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/json/version`, {
      signal: AbortSignal.timeout(1000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface LaunchDebugBrowserOptions {
  endpoint: string;
  profileDir?: string;
  timeoutMs?: number;
}

/**
 * Ensure a debuggable browser is listening at `endpoint`, launching one if
 * not. Returns true if it had to start a browser.
 *
 * Safe to call repeatedly: an endpoint that already answers is left alone, so
 * repeated runs reuse the same window rather than piling up browsers.
 */
export async function ensureDebugBrowser(
  options: LaunchDebugBrowserOptions
): Promise<boolean> {
  const { endpoint, timeoutMs = 15_000 } = options;
  if (await endpointReady(endpoint)) return false;

  const binary = findDebugBrowserBinary();
  if (!binary) {
    throw new Error(
      'No Chrome available to attach to. Install one with: ' +
        'pnpm exec playwright install chromium'
    );
  }

  const port = new URL(endpoint).port || '9222';
  const profileDir =
    options.profileDir ?? join(homedir(), '.waypoint', 'cdp-profile');

  const child = spawn(
    binary,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check'
    ],
    { detached: true, stdio: 'ignore' }
  );
  // Let it outlive the runner. Killing it between runs would defeat the point.
  child.unref();

  const deadline = Date.now() + timeoutMs;
  let listening = false;
  while (Date.now() < deadline) {
    if (!listening) listening = await endpointReady(endpoint);
    // The debug port answers before the first window exists, and attaching in
    // that gap fails. Wait for a page too, but do not fail on it: the attach
    // path opens one itself if none appears.
    if (listening && (await listPageTargets(endpoint)).length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (listening) return true;

  throw new Error(
    `Started a browser but ${endpoint} never became ready within ` +
      `${timeoutMs}ms. Try launching it manually with: pnpm chrome:debug`
  );
}

interface CdpTarget {
  id: string;
  type: string;
  url: string;
}

/**
 * True for a URL that belongs to a real tab the user can see and a run can
 * replay in — not an extension page (the side panel is one), DevTools, or a
 * chrome:// internal page.
 */
export function isReplayableUrl(url: string): boolean {
  return !/^(chrome-extension|devtools|chrome|chrome-untrusted|edge):/i.test(url);
}

/** Real tabs (see `isReplayableUrl`) the CDP HTTP endpoint currently reports. */
async function listPageTargets(endpoint: string): Promise<CdpTarget[]> {
  try {
    const res = await fetch(`${endpoint}/json/list`, {
      signal: AbortSignal.timeout(1000)
    });
    if (!res.ok) return [];
    const targets = (await res.json()) as CdpTarget[];
    return targets.filter((t) => t.type === 'page' && isReplayableUrl(t.url));
  } catch {
    return [];
  }
}

/** Compare URLs the way a user would: ignoring a trailing slash and fragment. */
function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '');
  return norm(a) === norm(b);
}

/**
 * Pick the tab an attached run should replay in, from the pages Playwright
 * sees after attaching. Never creates anything.
 *
 * Preference order: the tab the side panel reported as active, then the tab
 * sitting on the URL the workflow was recorded on, then any real tab. Returns
 * null only when the browser has no real tab at all (the caller may open one
 * then). Extension, DevTools and chrome:// pages are never chosen — picking
 * `pages()[0]` used to land on the side panel itself.
 */
export function selectTargetPage<P extends { url(): string }>(
  pages: P[],
  target: { targetUrl?: string; recordedUrl?: string }
): P | null {
  const real = pages.filter((p) => isReplayableUrl(p.url()));
  if (target.targetUrl) {
    const hit = real.find((p) => sameUrl(p.url(), target.targetUrl!));
    if (hit) return hit;
  }
  if (target.recordedUrl) {
    const hit = real.find((p) => sameUrl(p.url(), target.recordedUrl!));
    if (hit) return hit;
  }
  return real[0] ?? null;
}

/**
 * Ensure the browser at `endpoint` has at least one real tab (see
 * `isReplayableUrl`), opening one only if it has none. Returns true if it had
 * to open one. A browser that already has a tab is never touched.
 *
 * Chrome keeps running (and keeps answering on the debug port) after its last
 * window is closed on macOS, but in that state it has no default browser
 * context and refuses Playwright's attach handshake with "Browser context
 * management is not supported". The same race exists for a split second on
 * cold start, when the debug port answers before the first window exists.
 * Opening a tab through the HTTP endpoint brings a window back; on macOS Chrome
 * restores the tabs the closed window had.
 */
export async function ensureDebugPage(
  endpoint: string,
  options: { timeoutMs?: number } = {}
): Promise<boolean> {
  const { timeoutMs = 5_000 } = options;
  if ((await listPageTargets(endpoint)).length > 0) return false;

  // Chrome's /json/new is a PUT; older builds accepted GET, current ones 405 it.
  const res = await fetch(`${endpoint}/json/new?about:blank`, {
    method: 'PUT',
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    throw new Error(
      `Chrome at ${endpoint} is running but has no open window, and opening ` +
        `one failed (HTTP ${res.status}). Open a window in it, or quit it so ` +
        `the runner can start a fresh one.`
    );
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await listPageTargets(endpoint)).length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Opened a tab in Chrome at ${endpoint} but it never showed up as a ` +
      `debuggable page within ${timeoutMs}ms.`
  );
}

/** The Chrome error for an attach attempt against a browser with no window. */
export function isNoWindowError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return /Browser context management is not supported/i.test(detail);
}

/**
 * Turn a `connectOverCDP` failure into a message that names the actual cause.
 *
 * Playwright appends its call log to every error it throws, and that log
 * always contains the line "retrieving websocket url from ...". Matching on it
 * therefore matches every failure, which is how an attach rejected by a
 * running Chrome used to be reported as "no Chrome is listening". Only the
 * first line of the message describes what went wrong.
 */
export function explainAttachFailure(endpoint: string, error: unknown): string {
  const full = error instanceof Error ? error.message : String(error);
  const firstLine = full.split('\n')[0] ?? full;

  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|socket hang up|Timeout .* exceeded/i.test(firstLine)) {
    return (
      `No debuggable Chrome is listening at ${endpoint}. ` +
      `Start one with "pnpm chrome:debug", leave it open, then run again. ` +
      `A Chrome opened normally cannot be attached to — it needs ` +
      `--remote-debugging-port, which only applies at launch.`
    );
  }

  if (isNoWindowError(firstLine)) {
    return (
      `Chrome at ${endpoint} is running but has no open window, so there is ` +
      `nothing to attach to. Open a window in it (or quit it and run again so ` +
      `the runner starts a fresh one). If a window is open and this persists, ` +
      `that Chrome build rejects Playwright's attach handshake — use ` +
      `"pnpm chrome:debug", which launches a compatible build.`
    );
  }

  return `Could not attach to Chrome at ${endpoint}: ${firstLine}`;
}
