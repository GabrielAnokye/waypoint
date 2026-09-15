/**
 * Chrome native messaging stdio framing:
 * 4-byte little-endian uint32 length prefix + UTF-8 JSON body.
 */

import { MAX_MESSAGE_BYTES } from '@waypoint/bridge-protocol';

/** Encode a JSON-serializable value into a framed message buffer. */
export function encodeFrame(value: unknown): Buffer {
  const json = JSON.stringify(value);
  const body = Buffer.from(json, 'utf-8');
  if (body.length > MAX_MESSAGE_BYTES) {
    throw new RangeError(
      `Message size ${body.length} exceeds maximum ${MAX_MESSAGE_BYTES} bytes`
    );
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Streaming decoder that reassembles framed messages from chunked reads.
 * Calls `onMessage` for each complete decoded JSON value.
 */
export class FrameDecoder {
  private buffer = Buffer.alloc(0);
  private readonly onMessage: (msg: unknown) => void;

  constructor(onMessage: (msg: unknown) => void) {
    this.onMessage = onMessage;
  }

  /** Feed a chunk of data (e.g. from stdin). */
  feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > MAX_MESSAGE_BYTES) {
        throw new RangeError(
          `Incoming message size ${length} exceeds maximum ${MAX_MESSAGE_BYTES} bytes`
        );
      }
      if (this.buffer.length < 4 + length) {
        break; // Wait for more data.
      }
      const json = this.buffer.subarray(4, 4 + length).toString('utf-8');
      this.buffer = this.buffer.subarray(4 + length);
      this.onMessage(JSON.parse(json));
    }
  }
}
