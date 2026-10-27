import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_STEP_TIMEOUT_MS,
  createDefaultDebugMetadata,
  type Locator,
  type RunEvent,
  type Workflow,
  type WorkflowStep
} from '@waypoint/shared-types';

import { executeWorkflow, type BrowserLauncher } from './executor.js';
import { LocatorResolutionError } from './locate.js';
import { buildRunGraph } from './persist.js';

function makeWorkflow(steps: WorkflowStep[]): Workflow {
  return {
    workflowId: 'wf_test',
    name: 'Test Workflow',
    schemaVersion: 1,
    workflowVersion: 1,
    enabled: true,
    trigger: { type: 'manual' },
    steps,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    tags: [],
    metadata: {}
  };
}

function clickStep(id: string, opts: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id,
    type: 'click',
    enabled: true,
    primaryLocator: { kind: 'role', role: 'button', name: 'OK' },
    fallbackLocators: [],
    timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    retryPolicy: DEFAULT_RETRY_POLICY,
    debug: createDefaultDebugMetadata(),
    button: 'left',
    clickCount: 1,
    ...opts
  } as WorkflowStep;
}

async function collectEvents(iter: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const e of iter) events.push(e);
  return events;
}

describe('executeWorkflow', () => {
  it('emits run.started, step events, and run.finished for a successful run', async () => {
    const wf = makeWorkflow([clickStep('s1'), clickStep('s2')]);
    const events = await collectEvents(executeWorkflow(wf));
    const kinds = events.map(e => e.kind);

    expect(kinds[0]).toBe('run.started');
    expect(kinds[kinds.length - 1]).toBe('run.finished');
    expect(kinds.filter(k => k === 'step.started')).toHaveLength(2);
    expect(kinds.filter(k => k === 'step.succeeded')).toHaveLength(2);

    const finished = events.find(e => e.kind === 'run.finished')!;
    expect(finished.status).toBe('succeeded');
  });

  it('skips disabled steps', async () => {
    const wf = makeWorkflow([
      clickStep('s1'),
      clickStep('s2', { enabled: false }),
      clickStep('s3')
    ]);
    const executed: string[] = [];
    const launcher: BrowserLauncher = {
      async executeStep(step) { executed.push(step.id); }
    };
    await collectEvents(executeWorkflow(wf, { launcher }));

    expect(executed).toEqual(['s1', 's3']);
  });

  it('retries on step failure up to maxAttempts', async () => {
    const wf = makeWorkflow([
      clickStep('s1', {
        retryPolicy: { maxAttempts: 3, backoffMs: 0, strategy: 'fixed' }
      })
    ]);
    let calls = 0;
    const launcher: BrowserLauncher = {
      async executeStep() {
        calls++;
        if (calls < 3) throw new Error('transient failure');
      }
    };
    const events = await collectEvents(executeWorkflow(wf, { launcher }));

    expect(calls).toBe(3);
    expect(events.filter(e => e.kind === 'step.retrying')).toHaveLength(2);
    expect(events.find(e => e.kind === 'step.succeeded')).toBeTruthy();
    expect(events.find(e => e.kind === 'run.finished')!.status).toBe('succeeded');
  });

  it('fails the run after exhausting retry attempts', async () => {
    const wf = makeWorkflow([
      clickStep('s1', {
        retryPolicy: { maxAttempts: 2, backoffMs: 0, strategy: 'fixed' }
      })
    ]);
    const launcher: BrowserLauncher = {
      async executeStep() { throw new Error('persistent failure'); }
    };
    const events = await collectEvents(executeWorkflow(wf, { launcher }));

    expect(events.find(e => e.kind === 'step.failed')).toBeTruthy();
    expect(events.find(e => e.kind === 'run.finished')!.status).toBe('failed');
  });

  it('cancels via AbortSignal', async () => {
    const ac = new AbortController();
    const wf = makeWorkflow([clickStep('s1'), clickStep('s2'), clickStep('s3')]);
    let stepCount = 0;
    const launcher: BrowserLauncher = {
      async executeStep() {
        stepCount++;
        if (stepCount === 1) ac.abort();
      }
    };
    const events = await collectEvents(executeWorkflow(wf, { signal: ac.signal, launcher }));

    const finished = events.find(e => e.kind === 'run.finished')!;
    expect(finished.status).toBe('canceled');
    expect(stepCount).toBeLessThanOrEqual(2);
  });

  it('starts from a specific step index', async () => {
    const wf = makeWorkflow([clickStep('s1'), clickStep('s2'), clickStep('s3')]);
    const executed: string[] = [];
    const launcher: BrowserLauncher = {
      async executeStep(step) { executed.push(step.id); }
    };
    await collectEvents(executeWorkflow(wf, { launcher, fromStepIndex: 1 }));

    expect(executed).toEqual(['s2', 's3']);
  });

  it('classifies errors with failure codes in step.failed events', async () => {
    const wf = makeWorkflow([
      clickStep('s1', { retryPolicy: { maxAttempts: 1, backoffMs: 0, strategy: 'fixed' } })
    ]);
    const launcher: BrowserLauncher = {
      async executeStep() { throw new Error('Timeout 30000ms exceeded'); }
    };
    const events = await collectEvents(executeWorkflow(wf, { launcher }));

    const failed = events.find(e => e.kind === 'step.failed')!;
    expect(failed.error.code).toBe('timeout');
  });

  it('calls launcher.dispose on completion', async () => {
    let disposed = false;
    const wf = makeWorkflow([clickStep('s1')]);
    const launcher: BrowserLauncher = {
      async executeStep() {},
      async dispose() { disposed = true; }
    };
    await collectEvents(executeWorkflow(wf, { launcher }));
    expect(disposed).toBe(true);
  });

  it('surfaces resolvedLocator and usedFallback from launcher result', async () => {
    const wf = makeWorkflow([clickStep('s1')]);
    const resolvedLocator: Locator = { kind: 'css', selector: '.btn-ok' };
    const launcher: BrowserLauncher = {
      async executeStep() {
        return { resolvedLocator, usedFallback: true };
      }
    };
    const events = await collectEvents(executeWorkflow(wf, { launcher }));
    const succeeded = events.find(e => e.kind === 'step.succeeded')!;
    expect(succeeded.resolvedLocator).toEqual(resolvedLocator);
    expect(succeeded.usedFallback).toBe(true);
  });

  describe('Ground-Truth Comparator', () => {
    it('retains an observed identity without inventing correctness when the recording has no oracle', async () => {
      const events = await collectEvents(executeWorkflow(makeWorkflow([clickStep('s1')]), {
        launcher: { async executeStep() { return { resolvedTruthId: 'delete-alpha' }; } }
      }));
      const succeeded = events.find(e => e.kind === 'step.succeeded')!;
      expect(succeeded.resolvedTruthId).toBe('delete-alpha');
      expect(succeeded.expectedTruthId).toBeUndefined();
      expect(succeeded.truthClassification).toBeUndefined();
    });
    it('persists structured ambiguity, expected identity, and abstention; stops later steps', async () => {
      const wf = makeWorkflow([clickStep('s1', { dataTruthId: 'delete-beta' }), clickStep('s2')]);
      const primary = { kind: 'role', role: 'button', name: 'Delete' } as const;
      const repairRecord = {
        stepId: 's1', stepType: 'click' as const, failureCode: 'ambiguous_locator' as const,
        attemptedLocators: [primary], locatorAttempts: [{ locator: primary, matchCount: 3 }],
        confidence: 0, timestamp: '2026-10-27T12:00:00.000Z', suggestion: 'Rebind this step.'
      };
      const launcher: BrowserLauncher = {
        async executeStep(step) {
          expect(step.id).toBe('s1');
          throw new LocatorResolutionError({ failureCode: 'ambiguous_locator', attemptedLocators: [primary], repairRecord });
        }
      };
      const graph = await buildRunGraph(wf, executeWorkflow(wf, { launcher }), { workflowVersionId: 'wf_test_v1' });
      expect(graph.run.status).toBe('failed');
      expect(graph.steps).toHaveLength(1);
      expect(graph.steps[0]).toMatchObject({
        errorCode: 'ambiguous_locator', truthClassification: 'true_negative', expectedTruthId: 'delete-beta',
        debug: { extra: { repairRecord } }
      });
      expect(graph.steps[0]?.resolvedTruthId).toBeUndefined();
    });
    it('classifies step as true_positive when resolved data-truth-id matches expected truth ID', async () => {
      const wf = makeWorkflow([
        clickStep('s1', { dataTruthId: 'submit-order-alpha' })
      ]);
      const launcher: BrowserLauncher = {
        async executeStep() {
          return {
            resolvedLocator: { kind: 'role', role: 'button', name: 'Submit' },
            resolvedTruthId: 'submit-order-alpha'
          };
        }
      };

      const events = await collectEvents(executeWorkflow(wf, { launcher }));
      const succeeded = events.find(e => e.kind === 'step.succeeded')!;
      expect(succeeded.truthClassification).toBe('true_positive');
      expect(succeeded.resolvedTruthId).toBe('submit-order-alpha');
      expect(succeeded.expectedTruthId).toBe('submit-order-alpha');
    });

    it('classifies step as false_positive when resolved data-truth-id differs from expected truth ID (wrong target)', async () => {
      const wf = makeWorkflow([
        clickStep('s1', { dataTruthId: 'delete-order-alpha' })
      ]);
      const launcher: BrowserLauncher = {
        async executeStep() {
          return {
            resolvedLocator: { kind: 'role', role: 'button', name: 'Delete' },
            resolvedTruthId: 'delete-order-beta' // Wrong target clicked!
          };
        }
      };

      const events = await collectEvents(executeWorkflow(wf, { launcher }));
      const succeeded = events.find(e => e.kind === 'step.succeeded')!;
      expect(succeeded.truthClassification).toBe('false_positive');
      expect(succeeded.resolvedTruthId).toBe('delete-order-beta');
      expect(succeeded.expectedTruthId).toBe('delete-order-alpha');
    });

    it('classifies step as true_negative when locator safely failed with locator_not_found (count === 0)', async () => {
      const wf = makeWorkflow([
        clickStep('s1', {
          dataTruthId: 'login-submit-btn',
          retryPolicy: { maxAttempts: 1, backoffMs: 0, strategy: 'fixed' }
        })
      ]);
      const launcher: BrowserLauncher = {
        async executeStep() {
          throw new Error('Click failed: locator_not_found — None of the locators matched any element (count === 0).');
        }
      };

      const events = await collectEvents(executeWorkflow(wf, { launcher }));
      const failed = events.find(e => e.kind === 'step.failed')!;
      expect(failed.error.code).toBe('locator_not_found');
      expect(failed.truthClassification).toBe('true_negative');
      expect(failed.expectedTruthId).toBe('login-submit-btn');
    });
  });
});
