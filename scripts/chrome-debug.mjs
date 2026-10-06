#!/usr/bin/env node
/**
 * Launches a Chrome that the runner's "Run in my browser" mode can attach to.
 *
 * Attaching needs a browser started with --remote-debugging-port, which a
 * Chrome opened from the dock does not have. It also needs a build Playwright
 * can actually speak to: recent stable Chrome rejects the connectOverCDP
 * handshake with "Browser context management is not supported", so this
 * prefers the Chrome for Testing build Playwright installed and only falls
 * back to system Chrome with a warning.
 *
 * The profile directory is persistent, so anything you set up by hand — a
 * login, a filter, a page scrolled to the right place — survives between
 * sessions and is there for the next demo.
 *
 * Usage:  pnpm chrome:debug [url]
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.BROWSER_CDP_PORT ?? '9222';
const PROFILE_DIR =
  process.env.WAYPOINT_CDP_PROFILE ?? join(homedir(), '.waypoint', 'cdp-profile');

function findChromeForTesting() {
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!existsSync(cache)) return null;
  const builds = readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    // Highest build number is the newest Playwright installed.
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
  return null;
}

const SYSTEM_CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let binary = findChromeForTesting();
if (binary) {
  console.info('[waypoint] Using Playwright\'s Chrome for Testing build.');
} else if (existsSync(SYSTEM_CHROME)) {
  binary = SYSTEM_CHROME;
  console.warn(
    '[waypoint] Chrome for Testing not found; falling back to system Chrome.\n' +
      '           Recent stable Chrome may refuse the attach handshake with\n' +
      '           "Browser context management is not supported". If that happens,\n' +
      '           run: pnpm exec playwright install chromium'
  );
} else {
  console.error('[waypoint] No Chrome found. Run: pnpm exec playwright install chromium');
  process.exit(1);
}

const url = process.argv[2];
const args = [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE_DIR}`,
  '--no-first-run',
  '--no-default-browser-check'
];
if (url) args.push(url);

console.info(`[waypoint] Debug port : http://localhost:${PORT}`);
console.info(`[waypoint] Profile    : ${PROFILE_DIR}`);
console.info('[waypoint] Leave this browser open, then use "Run in my browser".');
console.info('[waypoint] Demo only — runs here inherit this browser\'s state.');

const child = spawn(binary, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
