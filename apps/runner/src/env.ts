import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

loadDotEnv();

const RunnerEnvSchema = z.object({
  RUNNER_HOST: z.string().default('127.0.0.1'),
  RUNNER_PORT: z.coerce.number().int().positive().default(3100),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info')
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
