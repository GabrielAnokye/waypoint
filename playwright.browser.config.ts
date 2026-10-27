import { defineConfig } from '@playwright/test';

// Separate from the API smoke tests: real recorder, extension, runner and clicks.
export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  workers: 1,
  outputDir: 'test-results/browser',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/browser', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3101' },
  webServer: {
    command: 'node apps/runner/dist/index.js',
    url: 'http://127.0.0.1:3101/health',
    // Never silently test a runner that still has the old resolver loaded.
    reuseExistingServer: false,
    env: {
      RUNNER_PORT: '3101', BROWSER_ENGINE: 'chromium', BROWSER_HEADLESS: 'true',
      BROWSER_CDP_ENDPOINT: 'http://127.0.0.1:9223', BROWSER_SLOW_MO: '0', BROWSER_KEEP_OPEN_MS: '0'
    }
  }
});
