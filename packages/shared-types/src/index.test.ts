import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ArtifactSchema,
  AuthProfileSchema,
  RawRecordedEventSchema,
  RunSchema,
  RunStepResultSchema,
  ScheduleSchema,
  SampleWorkflow,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowSchema,
  WorkflowVersionSchema,
  createWorkflowVersion,
  exportWorkflowToJson,
  importWorkflowFromJson,
  redactString,
  redactObject
} from './index.js';

describe('WorkflowSchema', () => {
  it('validates the sample workflow definition', () => {
    const workflow = WorkflowSchema.parse(SampleWorkflow);

    expect(workflow.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION);
    expect(workflow.steps).toHaveLength(5);
    expect(workflow.steps[2]?.type).toBe('click');
  });

  it('round-trips workflow JSON through the import/export helpers', () => {
    const exported = exportWorkflowToJson(SampleWorkflow);
    const imported = importWorkflowFromJson(exported);

    expect(imported.workflowId).toBe(SampleWorkflow.workflowId);
    expect(imported.steps[3]?.type).toBe('waitFor');
  });

  it('treats missing schemaVersion as a backward-compatible v1 import', () => {
    const legacyShape: Record<string, unknown> = { ...SampleWorkflow };
    delete legacyShape.schemaVersion;
    const imported = importWorkflowFromJson(JSON.stringify(legacyShape));

    expect(imported.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION);
  });
});

describe('WorkflowVersionSchema', () => {
  it('wraps workflow definitions in immutable version metadata', () => {
    const workflowVersion = createWorkflowVersion(SampleWorkflow, {
      id: 'wfv_morning_setup_v1',
      createdAt: '2026-03-09T12:00:00.000Z',
      changeSummary: 'Initial import',
      createdBy: 'system'
    });

    const parsed = WorkflowVersionSchema.parse(workflowVersion);

    expect(parsed.workflowId).toBe(SampleWorkflow.workflowId);
    expect(parsed.version).toBe(SampleWorkflow.workflowVersion);
  });
});

describe('supporting schemas', () => {
  it('validates recorded interaction events with locator metadata', () => {
    const event = RawRecordedEventSchema.parse({
      eventId: 'event_click_filters',
      type: 'click',
      atMs: 1_250,
      tabId: 'tab_primary',
      pageUrl: 'https://app.example.com/dashboard',
      target: {
        primaryLocator: {
          kind: 'role',
          role: 'button',
          name: 'Filters'
        },
        fallbackLocators: [
          {
            kind: 'css',
            selector: "[data-testid='filters-button']"
          }
        ],
        framePath: [
          {
            index: 0,
            name: 'main'
          }
        ]
      }
    });

    expect(event.type).toBe('click');
    if (event.type !== 'click') {
      throw new Error('Expected click event.');
    }
    expect(event.target.primaryLocator.kind).toBe('role');
    expect(event.target.fallbackLocators).toHaveLength(1);
  });

  it('validates run persistence entities', () => {
    const run = RunSchema.parse({
      id: 'run_morning_setup_v1',
      workflowId: SampleWorkflow.workflowId,
      workflowVersionId: 'wfv_morning_setup_v1',
      workflowVersion: SampleWorkflow.workflowVersion,
      status: 'succeeded',
      triggerSource: 'manual',
      authProfileId: 'profile_work',
      startedAt: '2026-03-09T12:00:00.000Z',
      finishedAt: '2026-03-09T12:00:05.000Z',
      createdAt: '2026-03-09T12:00:00.000Z',
      updatedAt: '2026-03-09T12:00:05.000Z',
      metadata: {
        source: 'test'
      }
    });
    const step = RunStepResultSchema.parse({
      id: 'run_step_open_filters',
      runId: run.id,
      stepId: 'step_open_filters',
      stepType: 'click',
      status: 'succeeded',
      attemptCount: 1,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: 500,
      resolvedLocator: {
        kind: 'role',
        role: 'button',
        name: 'Filters'
      },
      artifactIds: ['artifact_screenshot_1'],
      debug: {
        sourceEventIds: ['event_click_filters'],
        candidateLocators: [],
        notes: ['Locator resolved on first attempt.'],
        confidence: 0.95
      }
    });
    const artifact = ArtifactSchema.parse({
      id: 'artifact_screenshot_1',
      runId: run.id,
      runStepResultId: step.id,
      kind: 'screenshot',
      path: '/tmp/waypoint/artifacts/run_morning_setup_v1.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      createdAt: run.finishedAt,
      metadata: {
        retained: true
      }
    });
    const schedule = ScheduleSchema.parse({
      id: 'schedule_morning_setup',
      workflowId: SampleWorkflow.workflowId,
      enabled: true,
      pattern: { kind: 'daily' },
      timezone: 'America/Chicago',
      hour: 8,
      minute: 30,
      nextRunAt: '2026-03-10T14:30:00.000Z',
      createdAt: '2026-03-09T12:00:00.000Z',
      updatedAt: '2026-03-09T12:00:00.000Z'
    });
    const authProfile = AuthProfileSchema.parse({
      id: 'profile_work',
      name: 'Work profile',
      browserEngine: 'chromium',
      storageStatePath: '/tmp/waypoint/profiles/work/storage-state.json',
      profileDirectory: '/tmp/waypoint/profiles/work',
      createdAt: '2026-03-09T12:00:00.000Z',
      updatedAt: '2026-03-09T12:00:00.000Z',
      metadata: {
        source: 'test'
      }
    });

    expect(step.artifactIds[0]).toBe(artifact.id);
    expect(schedule.pattern.kind).toBe('daily');
    expect(authProfile.browserEngine).toBe('chromium');
  });
});

describe('redactString', () => {
  it('redacts password values', () => {
    const input = 'password: my-secret-pass123';
    const result = redactString(input);
    expect(result).toContain('***REDACTED***');
    expect(result).not.toContain('my-secret-pass123');
  });

  it('redacts token values', () => {
    const input = 'token=abc123xyz';
    const result = redactString(input);
    expect(result).toContain('***REDACTED***');
    expect(result).not.toContain('abc123xyz');
  });

  it('redacts authorization headers', () => {
    const input = 'authorization: Bearer_eyJhbGciOiJIUzI1NiJ9.test';
    const result = redactString(input);
    expect(result).toContain('***REDACTED***');
    expect(result).not.toContain('Bearer_eyJhbGciOiJIUzI1NiJ9');
  });

  it('redacts email addresses', () => {
    const input = 'User email is user@example.com in the system';
    const result = redactString(input);
    expect(result).toContain('***REDACTED***');
    expect(result).not.toContain('user@example.com');
  });

  it('redacts SSN-like patterns', () => {
    const input = 'SSN: 123-45-6789';
    const result = redactString(input);
    expect(result).toContain('***REDACTED***');
    expect(result).not.toContain('123-45-6789');
  });

  it('leaves safe strings untouched', () => {
    const input = 'Step 3 completed successfully';
    expect(redactString(input)).toBe(input);
  });
});

describe('redactObject', () => {
  it('redacts sensitive keys regardless of value', () => {
    const obj = { username: 'alice', password: 'hunter2', token: 'abc' };
    const result = redactObject(obj);
    expect(result.username).toBe('alice');
    expect(result.password).toBe('***REDACTED***');
    expect(result.token).toBe('***REDACTED***');
  });

  it('redacts nested objects', () => {
    const obj = { config: { secret: 'x', name: 'test' } };
    const result = redactObject(obj);
    expect(result.config.secret).toBe('***REDACTED***');
    expect(result.config.name).toBe('test');
  });

  it('redacts strings inside arrays', () => {
    const arr = ['password: foo123', 'normal text'];
    const result = redactObject(arr);
    expect(result[0]).toContain('***REDACTED***');
    expect(result[1]).toBe('normal text');
  });

  it('passes through numbers and booleans unchanged', () => {
    const obj = { count: 42, active: true };
    const result = redactObject(obj);
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
  });

  it('handles null and undefined gracefully', () => {
    expect(redactObject(null)).toBeNull();
    expect(redactObject(undefined)).toBeUndefined();
  });
});

describe('sample workflow JSON artifact', () => {
  it('matches the checked-in sample file', () => {
    const sampleJson = readFileSync(
      new URL('../samples/morning-setup.workflow.json', import.meta.url),
      'utf8'
    );

    const parsed = importWorkflowFromJson(sampleJson);

    expect(parsed.name).toBe('Morning browser setup');
    expect(parsed.steps[4]?.type).toBe('assert');
  });
});
