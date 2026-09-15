/**
 * Main entry: reads length-prefixed JSON from stdin, dispatches commands,
 * writes framed responses to stdout.
 *
 * IMPORTANT: never console.log anything — stdout is reserved for the
 * framed protocol. Use stderr for diagnostics.
 */

import { Dispatcher } from './dispatcher.js';
import { encodeFrame, FrameDecoder } from './framing.js';
import { createHttpHandlers } from './runner-client.js';

const handlers = createHttpHandlers();
const dispatcher = new Dispatcher({ handlers });

const decoder = new FrameDecoder(async (msg) => {
  const response = await dispatcher.dispatch(msg);
  const frame = encodeFrame(response);
  process.stdout.write(frame);
});

process.stdin.on('data', (chunk: Buffer) => {
  try {
    decoder.feed(chunk);
  } catch (err) {
    // Write an error response for framing issues.
    const errorResponse = encodeFrame({
      id: 'unknown',
      ok: false,
      error: {
        code: 'bad_request',
        message: err instanceof Error ? err.message : 'Framing error'
      }
    });
    process.stdout.write(errorResponse);
  }
});

process.stdin.on('end', () => {
  dispatcher.abortAll();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`[bridge-host] uncaught: ${err.message}\n`);
  process.exit(1);
});
