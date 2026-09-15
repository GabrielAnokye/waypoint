import pino, { type LevelWithSilent, type Logger } from 'pino';

export interface CreateLoggerOptions {
  level?: LevelWithSilent;
  name?: string;
  correlationId?: string;
}

/**
 * Creates the shared Pino logger used across runner-facing surfaces.
 * Optionally binds a correlationId for tracing through a single run.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const bindings: Record<string, string> = {};
  if (options.correlationId) {
    bindings.correlationId = options.correlationId;
  }
  return pino({
    level: options.level ?? 'info',
    name: options.name ?? 'waypoint',
    base: bindings
  });
}

/**
 * Derive a child logger bound to a specific run's correlation ID.
 */
export function childLogger(parent: Logger, correlationId: string): Logger {
  return parent.child({ correlationId });
}

/**
 * In-memory ring buffer that captures log entries for later export.
 * Used by the diagnostics bundle exporter to attach recent logs.
 */
export class LogRingBuffer {
  private readonly buffer: LogEntry[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  push(entry: LogEntry): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
    }
    this.buffer.push(entry);
  }

  entries(): readonly LogEntry[] {
    return this.buffer;
  }

  forCorrelationId(id: string): LogEntry[] {
    return this.buffer.filter((e) => e.correlationId === id);
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

export interface LogEntry {
  level: string;
  time: number;
  msg: string;
  correlationId?: string;
  [key: string]: unknown;
}

/**
 * Creates a Pino destination that writes to both stdout and a ring buffer.
 * Use with `pino(opts, createBufferedDestination(buf))`.
 */
export function createBufferedTransport(ringBuffer: LogRingBuffer) {
  return {
    write(chunk: string): void {
      try {
        const parsed = JSON.parse(chunk) as LogEntry;
        ringBuffer.push(parsed);
      } catch {
        // Non-JSON output, ignore
      }
      process.stdout.write(chunk);
    }
  };
}
