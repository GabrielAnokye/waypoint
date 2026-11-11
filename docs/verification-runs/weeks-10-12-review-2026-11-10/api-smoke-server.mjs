import process from 'node:process';
import { buildRunnerServer } from "file:///Users/gabrielanokye/Senior%20Seminar/waypoint/apps/runner/dist/app.js";
const { app } = buildRunnerServer({ RUNNER_HOST:'127.0.0.1', RUNNER_PORT:3199, LOG_LEVEL:'silent' });
await app.listen({ host:'127.0.0.1', port:3199 });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();process.exit(0);});
