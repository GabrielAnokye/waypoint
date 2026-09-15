import type { Run } from '@waypoint/shared-types';

type RunStatus = Run['status'];

export interface RunRegistryEntry {
  runId: string;
  workflowId: string;
  status: RunStatus;
  abort: AbortController;
  startedAt: string;
}

/** In-memory registry of in-flight runs used to support cancellation + status. */
export class RunRegistry {
  private readonly runs = new Map<string, RunRegistryEntry>();

  public register(entry: Omit<RunRegistryEntry, 'abort'> & { abort?: AbortController }): RunRegistryEntry {
    const stored: RunRegistryEntry = {
      ...entry,
      abort: entry.abort ?? new AbortController()
    };
    this.runs.set(entry.runId, stored);
    return stored;
  }

  public get(runId: string): RunRegistryEntry | undefined {
    return this.runs.get(runId);
  }

  public setStatus(runId: string, status: RunStatus): void {
    const entry = this.runs.get(runId);
    if (entry) entry.status = status;
  }

  public cancel(runId: string): boolean {
    const entry = this.runs.get(runId);
    if (!entry) return false;
    entry.abort.abort();
    entry.status = 'canceled';
    return true;
  }

  public remove(runId: string): void {
    this.runs.delete(runId);
  }

  public activeRunIds(): string[] {
    return [...this.runs.values()]
      .filter((r) => r.status === 'running' || r.status === 'queued')
      .map((r) => r.runId);
  }
}
