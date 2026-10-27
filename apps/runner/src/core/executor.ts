import { randomUUID } from 'node:crypto';

import type {
  FailureCode,
  Locator,
  RepairRecord,
  RunEvent,
  TruthClassification,
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
 * What the launcher reports back about a step it executed.
 *
 * `resolvedLocator` is the locator that actually matched, which is not
 * necessarily the step's primary one. Together with `usedFallback` this is the
 * raw observation the locator-robustness study aggregates: for a given page
 * mutation, which strategy still found the element.
 *
 * `resolvedTruthId` is the data-truth-id found on the target element in the DOM.
 * `truthClassification` classifies whether it was a True Positive, False Positive, or True Negative.
 */
export interface StepExecutionResult {
  resolvedLocator?: Locator | undefined;
  usedFallback?: boolean | undefined;
  resolvedTruthId?: string | undefined;
  truthClassification?: TruthClassification | undefined;
}

export interface ExecutionConditions {
  headless: boolean;
  slowMo: number;
  contextIsolation: 'isolated' | 'attached';
  browserEngine: string;
  cdpEndpoint?: string;
  [key: string]: unknown;
}

/**
 * Pluggable browser engine. Tests inject a stub; production wires this to a
 * real Playwright launcher. Returning normally = success.
 * Throwing = step failure (retried per the step's retry policy).
 */
export interface BrowserLauncher {
  executeStep(
    step: WorkflowStep,
    ctx: ExecuteStepContext
  ): Promise<StepExecutionResult | void>;
  /**
   * Discard any page state carried over from a previous run, so the next run
   * starts clean. Called before each run begins.
   */
  resetForRun?(options?: RunTargetOptions): Promise<void>;
  /**
   * Returns execution parameters (headless, slowMo, contextIsolation, browserEngine)
   * embedded into the runs table metadata for research auditability.
   */
  getExecutionConditions?(): ExecutionConditions;
  dispose?(): Promise<void>;
}

/** Where an attached run should play. Launchers that start clean ignore it. */
export interface RunTargetOptions {
  /** The tab the user asked to replay in (active tab beside the side panel). */
  targetUrl?: string;
  /** The URL the workflow was recorded on, as a fallback when no target is given. */
  recordedUrl?: string;
}

/** Default launcher: a no-op simulator that succeeds for every step. */
export const noopBrowserLauncher: BrowserLauncher = {
  async executeStep() {
    /* no-op */
  },
  getExecutionConditions() {
    return {
      headless: true,
      slowMo: 0,
      contextIsolation: 'isolated',
      browserEngine: 'noop'
    };
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

    const stepTarget =
      'target' in step && typeof step.target === 'object' && step.target !== null
        ? (step.target as { dataTruthId?: unknown })
        : undefined;
    const targetTruthId =
      stepTarget && typeof stepTarget.dataTruthId === 'string' && stepTarget.dataTruthId
        ? stepTarget.dataTruthId
        : undefined;
    const directTruthId =
      'dataTruthId' in step && typeof step.dataTruthId === 'string' && step.dataTruthId
        ? step.dataTruthId
        : undefined;
    const expectedTruthId: string | undefined = directTruthId || targetTruthId || undefined;

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
        const result = await launcher.executeStep(step, {
          runId,
          stepIndex: i,
          attempt,
          signal
        });
        const finishedAt = now().toISOString();
        const resolvedTruthId = result && 'resolvedTruthId' in result ? result.resolvedTruthId : undefined;
        let truthClassification: TruthClassification | undefined =
          result && 'truthClassification' in result ? result.truthClassification : undefined;

        if (!truthClassification && (expectedTruthId !== undefined || resolvedTruthId !== undefined)) {
          if (expectedTruthId && resolvedTruthId && expectedTruthId === resolvedTruthId) {
            truthClassification = 'true_positive';
          } else {
            truthClassification = 'false_positive';
          }
        }

        yield {
          kind: 'step.succeeded',
          runId,
          stepId: step.id,
          stepIndex: i,
          finishedAt,
          durationMs: Date.now() - stepStartMs,
          // Carry the winning locator out so it reaches persistence. Omitted
          // rather than set to undefined so schema parsing stays strict.
          ...(result?.resolvedLocator
            ? { resolvedLocator: result.resolvedLocator }
            : {}),
          ...(result?.usedFallback !== undefined
            ? { usedFallback: result.usedFallback }
            : {}),
          ...(truthClassification ? { truthClassification } : {}),
          ...(resolvedTruthId ? { resolvedTruthId } : {}),
          ...(expectedTruthId ? { expectedTruthId } : {})
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
        let failTruthClassification: TruthClassification | undefined;
        if (failureCode === 'locator_not_found') {
          failTruthClassification = 'true_negative';
        }

        yield {
          kind: 'step.failed',
          runId,
          stepId: step.id,
          stepIndex: i,
          finishedAt,
          durationMs: Date.now() - stepStartMs,
          error: finalError,
          ...(failTruthClassification ? { truthClassification: failTruthClassification } : {}),
          ...(expectedTruthId ? { expectedTruthId } : {})
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
