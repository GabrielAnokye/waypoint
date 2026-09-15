#!/usr/bin/env node
/**
 * CLI entry for the bridge host.
 *
 * When invoked with no arguments: runs in bridge mode (stdio framing).
 * --diagnose: runs diagnostics.
 * --install --extension-id <id>: installs native messaging manifest.
 * --uninstall: removes native messaging manifest.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);

if (args.includes('--diagnose')) {
  console.log('=== Waypoint Bridge Host Diagnostics ===');
  console.log();

  // 1. Check host manifest location.
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const manifestPaths: Record<string, string> = {
    darwin: resolve(
      homeDir,
      'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.waypoint.bridge.json'
    ),
    linux: resolve(
      homeDir,
      '.config/google-chrome/NativeMessagingHosts/com.waypoint.bridge.json'
    ),
    win32: resolve(
      process.env.LOCALAPPDATA ?? '',
      'Waypoint/com.waypoint.bridge.json'
    )
  };
  const manifestPath = manifestPaths[process.platform] ?? 'unsupported';
  const manifestExists = existsSync(manifestPath);
  console.log(`[1] Host manifest: ${manifestPath}`);
  console.log(`    Exists: ${manifestExists ? 'YES' : 'NO'}`);

  // 2. Check framing round-trip.
  try {
    const { encodeFrame, FrameDecoder } = await import('./framing.js');
    let decoded: unknown = null;
    const dec = new FrameDecoder((msg) => { decoded = msg; });
    const testMsg = { id: 'diag_1', ok: true, result: { pong: true } };
    const frame = encodeFrame(testMsg);
    dec.feed(frame);
    const pass = JSON.stringify(decoded) === JSON.stringify(testMsg);
    console.log(`[2] Framing round-trip: ${pass ? 'PASS' : 'FAIL'}`);
  } catch (err) {
    console.log(`[2] Framing round-trip: FAIL (${(err as Error).message})`);
  }

  // 3. Dispatcher test.
  try {
    const { Dispatcher } = await import('./dispatcher.js');
    const d = new Dispatcher({
      handlers: {
        async ping() {
          return { pong: true, hostVersion: '0.1.0', protocolVersion: 1 };
        }
      }
    });
    const resp = await d.dispatch({ id: 'diag_2', command: 'ping', payload: {} });
    console.log(`[3] Dispatcher ping: ${resp.ok ? 'PASS' : 'FAIL'}`);
  } catch (err) {
    console.log(`[3] Dispatcher ping: FAIL (${(err as Error).message})`);
  }

  console.log();
  console.log('Diagnostics complete.');
  process.exit(manifestExists ? 0 : 1);
} else if (args.includes('--install')) {
  console.log('Use: node install/install.mjs --extension-id <id>');
  process.exit(0);
} else if (args.includes('--uninstall')) {
  console.log('Use: node install/uninstall.mjs');
  process.exit(0);
} else {
  // Bridge mode.
  await import('./index.js');
}
