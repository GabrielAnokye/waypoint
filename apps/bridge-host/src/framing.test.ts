import { describe, expect, it } from 'vitest';

import { MAX_MESSAGE_BYTES } from '@waypoint/bridge-protocol';

import { encodeFrame, FrameDecoder } from './framing.js';

describe('encodeFrame / FrameDecoder', () => {
  it('round-trips an empty object', () => {
    let decoded: unknown = null;
    const dec = new FrameDecoder((msg) => { decoded = msg; });
    dec.feed(encodeFrame({}));
    expect(decoded).toEqual({});
  });

  it('round-trips a small request envelope', () => {
    const msg = { id: 'req_1', command: 'ping', payload: {} };
    let decoded: unknown = null;
    const dec = new FrameDecoder((m) => { decoded = m; });
    dec.feed(encodeFrame(msg));
    expect(decoded).toEqual(msg);
  });

  it('handles multi-byte UTF-8 (emoji, Chinese)', () => {
    const msg = { text: 'Hello world', emoji: '1F4BB' };
    let decoded: unknown = null;
    const dec = new FrameDecoder((m) => { decoded = m; });
    dec.feed(encodeFrame(msg));
    expect(decoded).toEqual(msg);
  });

  it('reassembles split reads (chunked stdin)', () => {
    const msg = { id: 'split_test', data: 'hello from chunks' };
    const frame = encodeFrame(msg);

    const messages: unknown[] = [];
    const dec = new FrameDecoder((m) => messages.push(m));

    // Split the frame into 3-byte chunks.
    for (let i = 0; i < frame.length; i += 3) {
      dec.feed(frame.subarray(i, i + 3));
    }
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(msg);
  });

  it('decodes multiple messages in sequence', () => {
    const m1 = { id: '1' };
    const m2 = { id: '2' };
    const combined = Buffer.concat([encodeFrame(m1), encodeFrame(m2)]);

    const messages: unknown[] = [];
    const dec = new FrameDecoder((m) => messages.push(m));
    dec.feed(combined);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(m1);
    expect(messages[1]).toEqual(m2);
  });

  it('rejects oversized message on encode', () => {
    const huge = { data: 'x'.repeat(MAX_MESSAGE_BYTES + 1) };
    expect(() => encodeFrame(huge)).toThrow(/exceeds maximum/);
  });

  it('rejects oversized message on decode', () => {
    // Craft a frame header claiming a payload larger than MAX_MESSAGE_BYTES.
    const header = Buffer.alloc(4);
    header.writeUInt32LE(MAX_MESSAGE_BYTES + 1, 0);

    const dec = new FrameDecoder(() => {});
    expect(() => dec.feed(header)).toThrow(/exceeds maximum/);
  });
});
