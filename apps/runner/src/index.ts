import { buildRunnerServer } from './app.js';
import { createPlaywrightLauncher } from './core/playwright-launcher.js';
import { noopBrowserLauncher, type BrowserLauncher } from './core/executor.js';
import { resolveRunnerEnv } from './env.js';

const env = resolveRunnerEnv();

/**
 * The server's own default is the no-op launcher, which keeps unit and
 * integration tests hermetic. The real process is where a browser gets wired
 * in, so nothing in the test suite ever launches Chromium by accident.
 */
const launcher: BrowserLauncher =
  env.BROWSER_ENGINE === 'chromium'
    ? createPlaywrightLauncher({
        headless: env.BROWSER_HEADLESS,
        slowMo: env.BROWSER_SLOW_MO,
        keepOpenMs: env.BROWSER_KEEP_OPEN_MS
      })
    : noopBrowserLauncher;

const { app } = buildRunnerServer(env, { browserLauncher: launcher });

async function shutdown(signal: string): Promise<void> {
  app.log?.info?.({ signal }, 'Shutting down.');
  try {
    await app.close();
  } finally {
    // Release the browser, otherwise a killed runner leaves Chromium behind.
    await launcher.dispose?.();
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
      `(engine: ${env.BROWSER_ENGINE}, headless: ${env.BROWSER_HEADLESS})`
  );
} catch (error) {
  console.error(error);
  await launcher.dispose?.();
  process.exitCode = 1;
}
