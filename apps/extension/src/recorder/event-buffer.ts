/**
 * In-page event buffer that debounces consecutive `input` events on the
 * same element and flushes on focus change, Enter, Tab, submit, 750 ms
 * idle, or target change.
 *
 * This is designed to run inside the content-script context and communicate
 * batches to the service worker via a Chrome port.
 */

import type { RawRecordedEventInput } from '@waypoint/shared-types';

export type FlushCallback = (events: RawRecordedEventInput[]) => void;

export interface EventBufferOptions {
  /** Max idle time (ms) before auto-flushing pending inputs. Default 750. */
  idleMs?: number;
  onFlush: FlushCallback;
}

export class EventBuffer {
  private pending: RawRecordedEventInput[] = [];
  private currentTargetKey: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleMs: number;
  private readonly onFlush: FlushCallback;

  constructor(options: EventBufferOptions) {
    this.idleMs = options.idleMs ?? 750;
    this.onFlush = options.onFlush;
  }

  /** Returns a string key used to detect target changes. */
  private static targetKey(event: RawRecordedEventInput): string {
    if ('target' in event && event.target) {
      return JSON.stringify(event.target.primaryLocator);
    }
    return '';
  }

  /**
   * Push an event into the buffer. Input events on the same target are
   * debounced; all other event types trigger an immediate flush.
   */
  push(event: RawRecordedEventInput): void {
    const key = EventBuffer.targetKey(event);

    if (event.type === 'input') {
      if (this.currentTargetKey !== null && this.currentTargetKey !== key) {
        this.flush();
      }
      this.currentTargetKey = key;
      // Replace the last pending input on the same target (keep first + last).
      if (
        this.pending.length > 0 &&
        this.pending[this.pending.length - 1]!.type === 'input'
      ) {
        // Keep the very first input event; replace intermediate ones.
        if (this.pending.length === 1) {
          this.pending.push(event);
        } else {
          this.pending[this.pending.length - 1] = event;
        }
      } else {
        this.pending.push(event);
      }
      this.resetIdleTimer();
      return;
    }

    // Non-input event: flush any pending inputs first, then queue this event.
    this.flush();
    this.pending.push(event);
    this.flush();
  }

  /** Flush all pending events to the callback and reset state. */
  flush(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.pending.length > 0) {
      const batch = this.pending;
      this.pending = [];
      this.currentTargetKey = null;
      this.onFlush(batch);
    }
  }

  /** Dispose the buffer, flushing any remaining events. */
  dispose(): void {
    this.flush();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => this.flush(), this.idleMs);
  }
}
