import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

loadDotEnv();

/**
 * Environment values arrive as strings, so `z.coerce.boolean()` is wrong here:
 * it treats any non-empty string as true, making BROWSER_HEADLESS=false true.
 */
const BooleanFromEnv = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1');

const RunnerEnvSchema = z.object({
  RUNNER_HOST: z.string().default('127.0.0.1'),
  RUNNER_PORT: z.coerce.number().int().positive().default(3100),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  /**
   * Which engine executes steps.
   *
   * - `chromium` launches a fresh Playwright browser per run. The only mode
   *   valid for collecting experiment data, because every run starts from
   *   identical state.
   * - `cdp` attaches to a Chrome you already have open (see
   *   BROWSER_CDP_ENDPOINT) and drives its current tab. Demo only: it inherits
   *   whatever state that browser carries, so runs are not reproducible.
   * - `noop` simulates success for every step, for exercising orchestration
   *   without a browser.
   *
   * Experiment runs must use `chromium` — locator strategies cannot be measured
   * against a simulator that always succeeds, nor against a page whose state
   * varies between runs. See docs/EXPERIMENT-INTEGRITY.md.
   */
  BROWSER_ENGINE: z.enum(['chromium', 'cdp', 'noop']).default('chromium'),
  /** CDP endpoint used when BROWSER_ENGINE=cdp. */
  BROWSER_CDP_ENDPOINT: z.string().default('http://localhost:9222'),
  /** Headless by default: experiment batches run unattended. Set false to watch. */
  BROWSER_HEADLESS: BooleanFromEnv(true),
  /** Delay each action by this many ms. Useful for demos, not for measurement. */
  BROWSER_SLOW_MO: z.coerce.number().int().nonnegative().default(0),
  /** Keep the browser open this long after a run finishes, for inspection. */
  BROWSER_KEEP_OPEN_MS: z.coerce.number().int().nonnegative().default(0)
});

export type RunnerEnv = z.infer<typeof RunnerEnvSchema>;

/**
 * Validates the local runner environment before boot.
 */
export function resolveRunnerEnv(
  source: Record<string, string | undefined> = process.env
): RunnerEnv {
  return RunnerEnvSchema.parse(source);
}
