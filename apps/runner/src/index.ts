import { buildRunnerServer } from './app.js';
import { createPlaywrightLauncher } from './core/playwright-launcher.js';
import { noopBrowserLauncher, type BrowserLauncher } from './core/executor.js';
import { resolveRunnerEnv } from './env.js';
import { openWaypointDatabase } from '@waypoint/db';
import {
  createRuntimePaths,
  ensureRuntimeDirectories
} from '@waypoint/db/runtime-paths';

const env = resolveRunnerEnv();

/**
 * The server's own defaults are in-memory database and no-op launcher,
 * which keeps unit and integration tests hermetic. The real process is
 * where the file-backed database and browser get wired in, so nothing
 * in the test suite accidentally persists data or launches Chromium.
 */
const paths = ensureRuntimeDirectories(createRuntimePaths());
const database = openWaypointDatabase(paths.databaseFile);

function createLauncher(): BrowserLauncher {
  switch (env.BROWSER_ENGINE) {
    case 'chromium':
      return createPlaywrightLauncher({
        headless: env.BROWSER_HEADLESS,
        slowMo: env.BROWSER_SLOW_MO,
        keepOpenMs: env.BROWSER_KEEP_OPEN_MS
      });
    case 'cdp':
      // Loud on purpose. Data collected in this mode is not reproducible, and
      // the failure is silent otherwise — runs still report success.
      console.warn(
        '[waypoint] BROWSER_ENGINE=cdp — attaching to an existing Chrome at ' +
          `${env.BROWSER_CDP_ENDPOINT}. Runs inherit that browser's state and ` +
          'are NOT reproducible. Demo only; do not collect experiment data in ' +
          'this mode. See docs/EXPERIMENT-INTEGRITY.md.'
      );
      return createPlaywrightLauncher({
        slowMo: env.BROWSER_SLOW_MO,
        keepOpenMs: env.BROWSER_KEEP_OPEN_MS,
        cdpEndpoint: env.BROWSER_CDP_ENDPOINT
      });
    case 'noop':
      return noopBrowserLauncher;
  }
}

const launcher: BrowserLauncher = createLauncher();

/**
 * The attached launcher is always available alongside the default one, so the
 * UI can offer "run in my browser" without restarting the runner in a
 * different mode. Constructing it is free — it does not connect to anything
 * until a run actually asks for it.
 */
const attachedLauncher = createPlaywrightLauncher({
  slowMo: env.BROWSER_SLOW_MO,
  keepOpenMs: 0,
  cdpEndpoint: env.BROWSER_CDP_ENDPOINT
});

const { app } = buildRunnerServer(env, {
  repository: database.repository,
  browserLauncher: launcher,
  attachedBrowserLauncher: attachedLauncher
});

async function shutdown(signal: string): Promise<void> {
  app.log?.info?.({ signal }, 'Shutting down.');
  try {
    await app.close();
  } finally {
    // Release the browser, otherwise a killed runner leaves Chromium behind.
    await launcher.dispose?.();
    await attachedLauncher.dispose?.();
    database.close();
  }
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}

try {
  await app.listen({
    host: env.RUNNER_HOST,
    port: env.RUNNER_PORT
  });
  console.info(
    `[waypoint] runner listening on http://${env.RUNNER_HOST}:${env.RUNNER_PORT} ` +
      `(engine: ${env.BROWSER_ENGINE}, headless: ${env.BROWSER_HEADLESS}, ` +
      `db: ${paths.databaseFile})`
  );
} catch (error) {
  console.error(error);
  await launcher.dispose?.();
  await attachedLauncher.dispose?.();
  database.close();
  process.exitCode = 1;
}
