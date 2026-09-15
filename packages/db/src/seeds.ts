import {
  SampleWorkflow,
  createWorkflowVersion,
  type Artifact,
  type AuthProfile,
  type Run,
  type RunStepResult,
  type Schedule,
  type Setting,
  type Workflow,
  type WorkflowVersion
} from '@waypoint/shared-types';

import type { RunGraph, WaypointRepository } from './repository.js';

export interface DevelopmentSeedBundle {
  workflow: Workflow;
  workflowVersion: WorkflowVersion;
  schedule: Schedule;
  authProfile: AuthProfile;
  runGraph: RunGraph;
  settings: Setting[];
}

/**
 * Creates deterministic seed data for local development and tests.
 */
export function createDevelopmentSeedBundle(
  now = '2026-03-09T12:00:00.000Z',
  artifactBasePath = '/tmp/waypoint-dev'
): DevelopmentSeedBundle {
  const workflow: Workflow = {
    ...SampleWorkflow,
    createdAt: now,
    updatedAt: now
  };
  const workflowVersion = createWorkflowVersion(workflow, {
    id: 'wfv_morning_setup_v1',
    createdAt: now,
    createdBy: 'system',
    changeSummary: 'Initial development seed'
  });
  const schedule: Schedule = {
    id: 'schedule_morning_setup',
    workflowId: workflow.workflowId,
    enabled: true,
    pattern: { kind: 'daily' },
    timezone: 'America/Chicago',
    hour: 8,
    minute: 30,
    missedRunPolicy: 'skip',
    nextRunAt: '2026-03-10T14:30:00.000Z',
    lastRunAt: '2026-03-09T14:30:00.000Z',
    createdAt: now,
    updatedAt: now
  };
  const authProfile: AuthProfile = {
    id: 'profile_work',
    name: 'Work profile',
    browserEngine: 'chromium',
    storageStatePath: `${artifactBasePath}/profiles/work/storage-state.json`,
    profileDirectory: `${artifactBasePath}/profiles/work`,
    notes: 'Dedicated browser profile for morning setup flows.',
    createdAt: now,
    updatedAt: now,
    lastValidatedAt: now,
    metadata: {
      source: 'seed'
    }
  };
  const run: Run = {
    id: 'run_morning_setup_v1',
    workflowId: workflow.workflowId,
    workflowVersionId: workflowVersion.id,
    workflowVersion: workflow.workflowVersion,
    status: 'succeeded',
    triggerSource: 'manual',
    scheduleId: schedule.id,
    authProfileId: authProfile.id,
    startedAt: now,
    finishedAt: '2026-03-09T12:00:05.000Z',
    createdAt: now,
    updatedAt: '2026-03-09T12:00:05.000Z',
    metadata: {
      source: 'seed'
    }
  };
  const steps: RunStepResult[] = workflow.steps.map((step, index) => ({
    id: `run_step_${index + 1}`,
    runId: run.id,
    stepId: step.id,
    stepType: step.type,
    status: 'succeeded',
    attemptCount: 1,
    startedAt: now,
    finishedAt: '2026-03-09T12:00:05.000Z',
    durationMs: 500,
    resolvedLocator:
      'primaryLocator' in step ? step.primaryLocator : undefined,
    artifactIds: [],
    debug: step.debug
  }));
  const artifacts: Artifact[] = [
    {
      id: 'artifact_trace_1',
      runId: run.id,
      runStepResultId: steps[0]?.id,
      kind: 'trace',
      path: `${artifactBasePath}/artifacts/traces/run_morning_setup_v1.zip`,
      mimeType: 'application/zip',
      sizeBytes: 2048,
      createdAt: now,
      metadata: {
        retained: true
      }
    },
    {
      id: 'artifact_screenshot_1',
      runId: run.id,
      runStepResultId: steps[2]?.id,
      kind: 'screenshot',
      path: `${artifactBasePath}/artifacts/screenshots/run_morning_setup_v1.png`,
      mimeType: 'image/png',
      sizeBytes: 1024,
      createdAt: now,
      metadata: {
        retained: true
      }
    }
  ];
  const settings: Setting[] = [
    {
      key: 'retention.days',
      value: 7,
      updatedAt: now
    },
    {
      key: 'runner.logLevel',
      value: 'info',
      updatedAt: now
    }
  ];

  return {
    workflow,
    workflowVersion,
    schedule,
    authProfile,
    runGraph: {
      run,
      steps,
      artifacts
    },
    settings
  };
}

/**
 * Seeds a repository with deterministic development data.
 */
export function seedDevelopmentData(
  repository: WaypointRepository,
  seedBundle = createDevelopmentSeedBundle()
): DevelopmentSeedBundle {
  repository.transaction(() => {
    repository.upsertAuthProfile(seedBundle.authProfile);
    repository.saveWorkflowVersion(seedBundle.workflowVersion);
    repository.upsertSchedule(seedBundle.schedule);
    repository.saveRunGraph(seedBundle.runGraph);
    seedBundle.settings.forEach((setting) => {
      repository.setSetting(setting);
    });
  });

  return seedBundle;
}
