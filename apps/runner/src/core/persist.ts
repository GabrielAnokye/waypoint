import { randomUUID } from 'node:crypto';

import type {
  RunEvent,
  RunGraph,
  Workflow
} from '@waypoint/shared-types';

interface StepAccumulator {
  id: string;
  stepId: string;
  stepType: RunGraph['steps'][number]['stepType'];
  status: RunGraph['steps'][number]['status'];
  attemptCount: number;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Consumes a stream of RunEvents and accumulates a persisted RunGraph. The
 * caller is expected to pass the resulting graph to
 * `WaypointRepository.saveRunGraph`.
 */
export async function buildRunGraph(
  workflow: Workflow,
  events: AsyncIterable<RunEvent>,
  options: {
    workflowVersionId: string;
    triggerSource?: 'manual' | 'schedule' | 'repair';
    authProfileId?: string;
    now?: () => Date;
  }
): Promise<RunGraph> {
  const now = options.now ?? (() => new Date());
  const stepsById = new Map<string, StepAccumulator>();
  let runId = '';
  let startedAt = now().toISOString();
  let finishedAt: string | undefined;
  let status: RunGraph['run']['status'] = 'queued';
  let errorCode: string | undefined;
  let errorMessage: string | undefined;

  for await (const event of events) {
    switch (event.kind) {
      case 'run.started':
        runId = event.runId;
        startedAt = event.startedAt;
        status = 'running';
        break;
      case 'step.started': {
        const existing = stepsById.get(event.stepId);
        if (existing) {
          existing.attemptCount = event.attempt;
          existing.status = 'running';
        } else {
          stepsById.set(event.stepId, {
            id: `rsr_${randomUUID()}`,
            stepId: event.stepId,
            stepType: event.stepType,
            status: 'running',
            attemptCount: event.attempt,
            startedAt: event.startedAt
          });
        }
        break;
      }
      case 'step.succeeded': {
        const acc = stepsById.get(event.stepId);
        if (acc) {
          acc.status = 'succeeded';
          acc.finishedAt = event.finishedAt;
          acc.durationMs = event.durationMs;
        }
        break;
      }
      case 'step.failed': {
        const acc = stepsById.get(event.stepId);
        if (acc) {
          acc.status = 'failed';
          acc.finishedAt = event.finishedAt;
          acc.durationMs = event.durationMs;
          acc.errorCode = event.error.code;
          acc.errorMessage = event.error.message;
        }
        break;
      }
      case 'step.retrying':
        // attempt count updates on next step.started
        break;
      case 'run.finished':
        status = event.status;
        finishedAt = event.finishedAt;
        if (event.error) {
          errorCode = event.error.code;
          errorMessage = event.error.message;
        }
        break;
    }
  }

  const createdAt = startedAt;
  const updatedAt = finishedAt ?? now().toISOString();

  return {
    run: {
      id: runId || `run_${randomUUID()}`,
      workflowId: workflow.workflowId,
      workflowVersionId: options.workflowVersionId,
      workflowVersion: workflow.workflowVersion,
      status,
      triggerSource: options.triggerSource ?? 'manual',
      authProfileId: options.authProfileId,
      startedAt,
      finishedAt,
      errorCode,
      errorMessage,
      createdAt,
      updatedAt,
      metadata: {}
    },
    steps: [...stepsById.values()].map((acc) => ({
      id: acc.id,
      runId: runId,
      stepId: acc.stepId,
      stepType: acc.stepType,
      status: acc.status,
      attemptCount: acc.attemptCount,
      startedAt: acc.startedAt,
      finishedAt: acc.finishedAt,
      durationMs: acc.durationMs,
      errorCode: acc.errorCode,
      errorMessage: acc.errorMessage,
      artifactIds: [],
      debug: {
        sourceEventIds: [],
        notes: [],
        tags: [],
        extra: {}
      }
    })),
    artifacts: []
  };
}
