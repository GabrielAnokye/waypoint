import {
  BridgeRequestSchema,
  BRIDGE_COMMANDS,
  PROTOCOL_VERSION,
  type BridgeCommandName,
  type BridgeResponse
} from '@waypoint/bridge-protocol';

export type CommandHandler = (
  payload: unknown,
  signal: AbortSignal
) => Promise<unknown>;

export interface DispatcherOptions {
  handlers: Partial<Record<BridgeCommandName, CommandHandler>>;
  defaultDeadlineMs?: number;
}

const commandSet = new Set<string>(BRIDGE_COMMANDS);

/**
 * Validates inbound envelopes, routes by command, catches errors, and
 * produces correlated BridgeResponse objects.
 */
export class Dispatcher {
  private readonly handlers: Partial<Record<BridgeCommandName, CommandHandler>>;
  private readonly defaultDeadlineMs: number;
  private readonly inflight = new Map<string, AbortController>();

  constructor(options: DispatcherOptions) {
    this.handlers = options.handlers;
    this.defaultDeadlineMs = options.defaultDeadlineMs ?? 10_000;
  }

  async dispatch(raw: unknown): Promise<BridgeResponse> {
    const parsed = BridgeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        id: (raw as Record<string, unknown>)?.id?.toString?.() ?? 'unknown',
        ok: false,
        error: {
          code: 'bad_request',
          message: parsed.error.message
        }
      };
    }

    const { id, command, payload, deadlineMs } = parsed.data;

    if (!commandSet.has(command)) {
      return {
        id,
        ok: false,
        error: {
          code: 'unknown_command',
          message: `Unknown command: ${command}`
        }
      };
    }

    const handler = this.handlers[command as BridgeCommandName];
    if (!handler) {
      return {
        id,
        ok: false,
        error: {
          code: 'unknown_command',
          message: `No handler registered for: ${command}`
        }
      };
    }

    const abort = new AbortController();
    this.inflight.set(id, abort);
    const timeout = deadlineMs ?? this.defaultDeadlineMs;

    const TIMEOUT_SENTINEL = Symbol('timeout');

    try {
      const result = await Promise.race([
        handler(payload, abort.signal),
        new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
          const timer = setTimeout(() => {
            abort.abort();
            resolve(TIMEOUT_SENTINEL);
          }, timeout);
          // Unref so Node can exit even if this timer is pending.
          if (typeof timer === 'object' && 'unref' in timer) timer.unref();
        })
      ]);
      if (result === TIMEOUT_SENTINEL) {
        return {
          id,
          ok: false as const,
          error: { code: 'timeout' as const, message: 'Request timed out' }
        };
      }
      return { id, ok: true as const, result };
    } catch (err) {
      if (abort.signal.aborted) {
        return {
          id,
          ok: false as const,
          error: { code: 'timeout' as const, message: 'Request timed out' }
        };
      }
      return {
        id,
        ok: false as const,
        error: {
          code: 'internal' as const,
          message: err instanceof Error ? err.message : 'Internal error'
        }
      };
    } finally {
      this.inflight.delete(id);
    }
  }

  /** Abort all in-flight handlers (e.g. on stdin close). */
  abortAll(): void {
    for (const [, ctrl] of this.inflight) ctrl.abort();
    this.inflight.clear();
  }

  /** Current protocol version for ping responses. */
  static get protocolVersion(): number {
    return PROTOCOL_VERSION;
  }
}
