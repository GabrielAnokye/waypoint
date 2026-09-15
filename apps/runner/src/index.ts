import { buildRunnerServer } from './app.js';
import { resolveRunnerEnv } from './env.js';

const env = resolveRunnerEnv();
const { app } = buildRunnerServer(env);

try {
  await app.listen({
    host: env.RUNNER_HOST,
    port: env.RUNNER_PORT
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
