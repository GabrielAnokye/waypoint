import { describe, expect, it } from 'vitest';

import type { BridgeResponse } from '@waypoint/bridge-protocol';

import { Dispatcher } from './dispatcher.js';

describe('Dispatcher', () => {
  it('routes a ping command to the handler', async () => {
    const d = new Dispatcher({
      handlers: {
        async ping() {
          return { pong: true, hostVersion: '0.1.0', protocolVersion: 1 };
        }
      }
    });
    const resp: BridgeResponse = await d.dispatch({
      id: 'req_1',
      command: 'ping',
      payload: {}
    });
    expect(resp.ok).toBe(true);
    if (resp.ok) {
      expect((resp.result as Record<string, unknown>).pong).toBe(true);
    }
  });

  it('returns unknown_command for unrecognized commands', async () => {
    const d = new Dispatcher({ handlers: {} });
    const resp = await d.dispatch({
      id: 'req_2',
      command: 'doSomethingWeird',
      payload: {}
    });
    expect(resp.ok).toBe(false);
    if (!resp.ok) {
      expect(resp.error.code).toBe('unknown_command');
    }
  });

  it('returns timeout when deadline is exceeded', async () => {
    const d = new Dispatcher({
      handlers: {
        async ping(_payload, signal) {
          // Simulate slow work.
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          return { pong: true };
        }
      },
      defaultDeadlineMs: 50
    });
    const resp = await d.dispatch({
      id: 'req_3',
      command: 'ping',
      payload: {}
    });
    expect(resp.ok).toBe(false);
    if (!resp.ok) {
      expect(resp.error.code).toBe('timeout');
    }
  });

  it('returns internal error when handler throws', async () => {
    const d = new Dispatcher({
      handlers: {
        async ping() {
          throw new Error('Something broke');
        }
      }
    });
    const resp = await d.dispatch({
      id: 'req_4',
      command: 'ping',
      payload: {}
    });
    expect(resp.ok).toBe(false);
    if (!resp.ok) {
      expect(resp.error.code).toBe('internal');
      expect(resp.error.message).toContain('Something broke');
    }
  });

  it('returns bad_request for malformed envelope', async () => {
    const d = new Dispatcher({ handlers: {} });
    const resp = await d.dispatch({ notAnEnvelope: true });
    expect(resp.ok).toBe(false);
    if (!resp.ok) {
      expect(resp.error.code).toBe('bad_request');
    }
  });
});
