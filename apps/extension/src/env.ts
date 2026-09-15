import { z } from 'zod';

const ExtensionEnvSchema = z.object({
  VITE_WAYPOINT_NAME: z.string().default('Waypoint'),
  VITE_RUNNER_BASE_URL: z
    .string()
    .url()
    .default('http://127.0.0.1:3100')
});

export type ExtensionEnv = z.infer<typeof ExtensionEnvSchema>;

/**
 * Validates side-panel build-time environment variables.
 */
export function resolveExtensionEnv(
  source: Record<string, string | undefined> = import.meta.env
): ExtensionEnv {
  return ExtensionEnvSchema.parse(source);
}
