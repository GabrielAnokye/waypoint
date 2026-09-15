import { describe, expect, it } from 'vitest';

import {
  BridgeRequestSchema,
  BridgeResponseSchema,
  BRIDGE_COMMANDS,
  PROTOCOL_VERSION,
  RunWorkflowPayloadSchema
} from './index.js';

describe('BridgeRequestSchema', () => {
  it('parses a valid ping request', () => {
    const req = BridgeRequestSchema.parse({
      id: 'req_1',
      command: 'ping',
      payload: {}
    });
    expect(req.id).toBe('req_1');
    expect(req.command).toBe('ping');
  });

  it('rejects request without id', () => {
    expect(() => BridgeRequestSchema.parse({ command: 'ping' })).toThrow();
  });

  it('accepts all 10 commands as valid request command strings', () => {
    for (const cmd of BRIDGE_COMMANDS) {
      const req = BridgeRequestSchema.parse({
        id: `req_${cmd}`,
        command: cmd,
        payload: {}
      });
      expect(req.command).toBe(cmd);
    }
  });
});

describe('BridgeResponseSchema', () => {
  it('parses an ok response', () => {
    const resp = BridgeResponseSchema.parse({
      id: 'req_1',
      ok: true,
      result: { pong: true }
    });
    expect(resp.ok).toBe(true);
  });

  it('parses an error response', () => {
    const resp = BridgeResponseSchema.parse({
      id: 'req_1',
      ok: false,
      error: { code: 'timeout', message: 'Request timed out' }
    });
    expect(resp.ok).toBe(false);
    if (!resp.ok) {
      expect(resp.error.code).toBe('timeout');
    }
  });

  it('rejects invalid error code', () => {
    expect(() =>
      BridgeResponseSchema.parse({
        id: 'req_1',
        ok: false,
        error: { code: 'made_up', message: 'nope' }
      })
    ).toThrow();
  });
});

describe('RunWorkflowPayloadSchema', () => {
  it('parses with required workflowId', () => {
    const payload = RunWorkflowPayloadSchema.parse({ workflowId: 'wf_123' });
    expect(payload.workflowId).toBe('wf_123');
    expect(payload.debugMode).toBeUndefined();
  });

  it('includes optional fields', () => {
    const payload = RunWorkflowPayloadSchema.parse({
      workflowId: 'wf_123',
      authProfileId: 'prof_1',
      debugMode: true
    });
    expect(payload.authProfileId).toBe('prof_1');
    expect(payload.debugMode).toBe(true);
  });
});

describe('PROTOCOL_VERSION', () => {
  it('is a positive integer', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });
});
