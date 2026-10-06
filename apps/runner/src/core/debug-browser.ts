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
  while (Date.now() < deadline) {
    if (await endpointReady(endpoint)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Started a browser but ${endpoint} never became ready within ` +
      `${timeoutMs}ms. Try launching it manually with: pnpm chrome:debug`
  );
}
