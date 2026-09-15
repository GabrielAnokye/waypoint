/**
 * Typed bridge client for the extension side panel.
 * Uses chrome.runtime.connectNative to talk to the native host.
 * Falls back to chrome.runtime.sendNativeMessage for one-shot calls.
 */

export interface BridgeCallOptions {
  deadlineMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let port: chrome.runtime.Port | null = null;
let portConnected = false;
const pending = new Map<string, PendingRequest>();
let idCounter = 0;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

function nextId(): string {
  return `br_${++idCounter}_${Date.now().toString(36)}`;
}

function ensurePort(): chrome.runtime.Port {
  if (port && portConnected) return port;

  port = chrome.runtime.connectNative('com.waypoint.bridge');
  portConnected = true;
  reconnectAttempts = 0;

  port.onMessage.addListener((msg: { id?: string; ok?: boolean; result?: unknown; error?: { code: string; message: string } }) => {
    if (!msg.id) return;
    const req = pending.get(msg.id);
    if (!req) return;
    pending.delete(msg.id);
    clearTimeout(req.timer);
    if (msg.ok) {
      req.resolve(msg.result);
    } else {
      req.reject(new Error(msg.error?.message ?? 'Bridge call failed'));
    }
  });

  port.onDisconnect.addListener(() => {
    portConnected = false;
    const err = new Error(
      chrome.runtime.lastError?.message ?? 'Native host disconnected'
    );
    // Reject all pending requests.
    for (const [id, req] of pending) {
      clearTimeout(req.timer);
      req.reject(err);
      pending.delete(id);
    }
    port = null;
    // Attempt reconnect.
    scheduleReconnect();
  });

  return port;
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
  reconnectAttempts++;
  const delayMs = Math.min(250 * 2 ** (reconnectAttempts - 1), 4000);
  setTimeout(() => {
    try {
      ensurePort();
    } catch {
      // Will retry on next call.
    }
  }, delayMs);
}

/**
 * Send a typed command to the native host and wait for a response.
 */
export async function bridgeCall(
  command: string,
  payload: unknown = {},
  options: BridgeCallOptions = {}
): Promise<unknown> {
  const id = nextId();
  const deadlineMs = options.deadlineMs ?? 10_000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Bridge call "${command}" timed out after ${deadlineMs}ms`));
    }, deadlineMs);

    pending.set(id, { resolve, reject, timer });

    try {
      const p = ensurePort();
      p.postMessage({ id, command, payload, deadlineMs });
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      reject(
        new Error(
          err instanceof Error
            ? err.message
            : 'Failed to connect to native host'
        )
      );
    }
  });
}

/**
 * Check if the bridge host is available (quick ping).
 */
export async function isBridgeAvailable(): Promise<boolean> {
  try {
    const result = (await bridgeCall('ping', {}, { deadlineMs: 2000 })) as {
      pong?: boolean;
    };
    return result?.pong === true;
  } catch {
    return false;
  }
}
