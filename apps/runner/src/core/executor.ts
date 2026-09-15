import { randomUUID } from 'node:crypto';

import type {
  FailureCode,
  RepairRecord,
  RunEvent,
  Workflow,
  WorkflowStep
} from '@waypoint/shared-types';

import { classifyError, computeRetryDelay } from './locate.js';

export interface ExecuteStepContext {
  runId: string;
  stepIndex: number;
  attempt: number;
  signal: AbortSignal;
}

/**
 * Pluggable browser engine. Tests inject a stub; production wires this to a
 * real Playwright launcher in a follow-up. Returning normally = success.
 * Throwing = step failure (retried per the step's retry policy).
 */
export interface BrowserLauncher {
  executeStep(step: WorkflowStep, ctx: ExecuteStepContext): Promise<void>;
  dispose?(): Promise<void>;
}

/** Default launcher: a no-op simulator that succeeds for every step. */
export const noopBrowserLauncher: BrowserLauncher = {
  async executeStep() {
    /* no-op */
  }
};

export interface ExecuteWorkflowOptions {
  runId?: string;
  authProfileId?: string;
  debugMode?: boolean;
  signal?: AbortSignal;
  launcher?: BrowserLauncher;
  now?: () => Date;
  fromStepIndex?: number;
}

/**
 * Streams structured RunEvents for a workflow execution. Honors per-step
 * retryPolicy with capped backoff and AbortSignal-based cancellation.
 * Skips disabled steps. Supports starting from a specific step index.
 */
export async function* executeWorkflow(
  workflow: Workflow,
  options: ExecuteWorkflowOptions = {}
): AsyncIterable<RunEvent> {
  const launcher = options.launcher ?? noopBrowserLauncher;
  const now = options.now ?? (() => new Date());
  const runId = options.runId ?? `run_${randomUUID()}`;
  const signal = options.signal ?? new AbortController().signal;
  const fromIndex = options.fromStepIndex ?? 0;

  const startedAt = now().toISOString();
  yield {
    kind: 'run.started',
    runId,
    workflowId: workflow.workflowId,
    workflowVersion: workflow.workflowVersion,
    startedAt
  };

  let finalStatus: 'succeeded' | 'failed' | 'canceled' = 'succeeded';
  let finalError: { code: string; message: string; stepId?: string; repairRecord?: RepairRecord } | undefined;

  for (let i = fromIndex; i < workflow.steps.length; i++) {
    if (signal.aborted) {
      finalStatus = 'canceled';
      break;
    }
    const step = workflow.steps[i]!;

    // Skip disabled steps
    if ('enabled' in step && step.enabled === false) {
      continue;
    }

    const policy = step.retryPolicy;
    const maxAttempts = policy.maxAttempts;

    let attempt = 1;
    let succeeded = false;

    while (attempt <= maxAttempts) {
      if (signal.aborted) {
        finalStatus = 'canceled';
        break;
      }
      const stepStartedAt = now().toISOString();
      const stepStartMs = Date.now();
      yield {
        kind: 'step.started',
        runId,
        stepId: step.id,
        stepIndex: i,
        stepType: step.type,
        startedAt: stepStartedAt,
        attempt
      };

      try {
        await launcher.executeStep(step, {
          runId,
          stepIndex: i,
          attempt,
          signal
        });
        const finishedAt = now().toISOString();
        yield {
          kind: 'step.succeeded',
          runId,
          stepId: step.id,
          stepIndex: i,
          finishedAt,
          durationMs: Date.now() - stepStartMs
        };
        succeeded = true;
        break;
      } catch (err) {
        const failureCode: FailureCode = classifyError(err, step);

        if (attempt < maxAttempts) {
          const delayMs = computeRetryDelay(
            attempt,
            policy.backoffMs,
            policy.strategy
          );
          yield {
            kind: 'step.retrying',
            runId,
            stepId: step.id,
            stepIndex: i,
            attempt: attempt + 1,
            delayMs
          };
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          attempt++;
          continue;
        }
        // Out of attempts.
        const finishedAt = now().toISOString();
        const message =
          err instanceof Error ? err.message : 'Step execution failed.';
        finalError = {
          code: failureCode,
          message,
          stepId: step.id
        };
        yield {
          kind: 'step.failed',
          runId,
          stepId: step.id,
          stepIndex: i,
          finishedAt,
          durationMs: Date.now() - stepStartMs,
          error: finalError
        };
        finalStatus = 'failed';
        break;
      }
    }

    if (!succeeded) break;
  }

  if (launcher.dispose) {
    try {
      await launcher.dispose();
    } catch {
      /* swallow */
    }
  }

  yield {
    kind: 'run.finished',
    runId,
    status: finalStatus,
    finishedAt: now().toISOString(),
    error: finalError
  };
}
