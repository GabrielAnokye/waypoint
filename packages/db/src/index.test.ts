import { describe, expect, it } from 'vitest';

import { SampleWorkflow, createWorkflowVersion } from '@waypoint/shared-types';

import {
  INITIAL_SCHEMA_SQL,
  createDevelopmentSeedBundle,
  openWaypointDatabase,
  seedDevelopmentData
} from './index.js';

describe('SQLite migrations', () => {
  it('creates the expected core tables', () => {
    const database = openWaypointDatabase(':memory:');
    const tables = database.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC"
      )
      .all()
      .map((row) => String((row as { name: string }).name));

    expect(INITIAL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS workflows');
    expect(tables).toEqual(
      expect.arrayContaining([
        'artifacts',
        'auth_profiles',
        'migrations',
        'run_steps',
        'runs',
        'schedules',
        'settings',
        'workflow_versions',
        'workflows'
      ])
    );

    database.close();
  });
});

describe('WaypointRepository', () => {
  it('persists workflows and immutable workflow versions', () => {
    const database = openWaypointDatabase(':memory:');
    const workflowVersion = createWorkflowVersion(SampleWorkflow, {
      id: 'wfv_morning_setup_v1',
      createdAt: '2026-03-09T12:00:00.000Z',
      createdBy: 'system'
    });

    database.repository.saveWorkflowVersion(workflowVersion);

    const workflow = database.repository.getWorkflow(SampleWorkflow.workflowId);
    const loadedVersion = database.repository.getWorkflowVersion(
      SampleWorkflow.workflowId,
      SampleWorkflow.workflowVersion
    );

    expect(workflow?.latestVersion).toBe(1);
    expect(loadedVersion?.definition.steps[2]?.type).toBe('click');

    database.close();
  });

  it('writes runs, step results, and artifacts atomically', () => {
    const database = openWaypointDatabase(':memory:');
    const seedBundle = createDevelopmentSeedBundle();

    database.repository.upsertAuthProfile(seedBundle.authProfile);
    database.repository.saveWorkflowVersion(seedBundle.workflowVersion);
    database.repository.upsertSchedule(seedBundle.schedule);
    database.repository.saveRunGraph(seedBundle.runGraph);

    const runGraph = database.repository.getRunGraph(seedBundle.runGraph.run.id);

    expect(runGraph?.steps).toHaveLength(seedBundle.runGraph.steps.length);
    expect(runGraph?.artifacts).toHaveLength(seedBundle.runGraph.artifacts.length);
    expect(runGraph?.run.status).toBe('succeeded');

    database.close();
  });

  it('rolls back transaction-scoped writes when an error occurs', () => {
    const database = openWaypointDatabase(':memory:');
    const seedBundle = createDevelopmentSeedBundle();

    database.repository.saveWorkflowVersion(seedBundle.workflowVersion);

    expect(() =>
      database.repository.transaction(() => {
        database.repository.upsertSchedule(seedBundle.schedule);
        throw new Error('force rollback');
      })
    ).toThrow('force rollback');

    expect(database.repository.listSchedules()).toHaveLength(0);

    database.close();
  });
});

describe('seedDevelopmentData', () => {
  it('seeds workflows, auth profiles, schedules, runs, and settings', () => {
    const database = openWaypointDatabase(':memory:');
    const seedBundle = seedDevelopmentData(database.repository);

    expect(database.repository.listWorkflows()).toHaveLength(1);
    expect(database.repository.listAuthProfiles()).toHaveLength(1);
    expect(database.repository.listSchedules()).toHaveLength(1);
    expect(
      database.repository.listRunsForWorkflow(seedBundle.workflow.workflowId)
    ).toHaveLength(1);
    expect(database.repository.listSettings()).toHaveLength(2);

    database.close();
  });
});
