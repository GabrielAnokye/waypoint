import { describe, expect, it } from 'vitest';

import { SampleWorkflow, createWorkflowVersion } from '@waypoint/shared-types';

import {
  INITIAL_SCHEMA_SQL,
  applyMigrations,
  createDevelopmentSeedBundle,
  openWaypointDatabase,
  seedDevelopmentData,
} from './index.js';

describe('SQLite migrations', () => {
  it('creates the expected core tables', () => {
    const database = openWaypointDatabase(':memory:');
    const tables = database.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")
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
        'workflows',
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
      createdBy: 'system',
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

  it('round-trips resolvedLocator and usedFallback on step results', () => {
    const database = openWaypointDatabase(':memory:');
    const seedBundle = createDevelopmentSeedBundle();

    database.repository.upsertAuthProfile(seedBundle.authProfile);
    database.repository.saveWorkflowVersion(seedBundle.workflowVersion);
    database.repository.upsertSchedule(seedBundle.schedule);

    // The study's per-step observation: a fallback resolved, not the primary.
    const steps = seedBundle.runGraph.steps.map((step, index) =>
      index === 0
        ? {
            ...step,
            resolvedLocator: {
              kind: 'testId' as const,
              testId: 'submit-login',
            },
            usedFallback: true,
          }
        : { ...step, usedFallback: false }
    );
    database.repository.saveRunGraph({ ...seedBundle.runGraph, steps });

    const runGraph = database.repository.getRunGraph(seedBundle.runGraph.run.id);
    const first = runGraph?.steps.find((s) => s.stepId === steps[0]!.stepId);
    const second = runGraph?.steps.find((s) => s.stepId === steps[1]?.stepId);

    expect(first?.usedFallback).toBe(true);
    expect(first?.resolvedLocator).toEqual({
      kind: 'testId',
      testId: 'submit-login',
    });
    // false must survive as false, not collapse to undefined via 0/NULL confusion.
    if (second) expect(second.usedFallback).toBe(false);

    database.close();
  });

  it('round-trips truthClassification, audit truth IDs, and run execution metadata', () => {
    const database = openWaypointDatabase(':memory:');
    const seedBundle = createDevelopmentSeedBundle();

    database.repository.upsertAuthProfile(seedBundle.authProfile);
    database.repository.saveWorkflowVersion(seedBundle.workflowVersion);
    database.repository.upsertSchedule(seedBundle.schedule);

    const steps = seedBundle.runGraph.steps.map((step, index) =>
      index === 0
        ? {
            ...step,
            truthClassification: 'true_positive' as const,
            resolvedTruthId: 'truth-btn-submit',
            expectedTruthId: 'truth-btn-submit',
          }
        : {
            ...step,
            truthClassification: 'false_positive' as const,
            resolvedTruthId: 'truth-btn-cancel',
            expectedTruthId: 'truth-btn-save',
          }
    );

    const runWithMetadata = {
      ...seedBundle.runGraph.run,
      metadata: {
        headless: true,
        slowMo: 50,
        contextIsolation: 'isolated',
        browserEngine: 'chromium',
      },
    };

    database.repository.saveRunGraph({
      ...seedBundle.runGraph,
      run: runWithMetadata,
      steps,
    });

    const runGraph = database.repository.getRunGraph(runWithMetadata.id);
    expect(runGraph).toBeDefined();

    // Verify execution condition metadata on run
    expect(runGraph?.run.metadata).toEqual({
      headless: true,
      slowMo: 50,
      contextIsolation: 'isolated',
      browserEngine: 'chromium',
    });

    // Verify truth classification and IDs on steps
    const first = runGraph?.steps[0];
    expect(first?.truthClassification).toBe('true_positive');
    expect(first?.resolvedTruthId).toBe('truth-btn-submit');
    expect(first?.expectedTruthId).toBe('truth-btn-submit');

    const second = runGraph?.steps[1];
    expect(second?.truthClassification).toBe('false_positive');
    expect(second?.resolvedTruthId).toBe('truth-btn-cancel');
    expect(second?.expectedTruthId).toBe('truth-btn-save');

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

it('applies migration 005 and round-trips all seven healing telemetry columns', () => {
  const database = openWaypointDatabase(':memory:');
  const columns = database.db
    .prepare('PRAGMA table_info(run_steps)')
    .all()
    .map((row) => (row as { name: string }).name);
  expect(columns).toEqual(
    expect.arrayContaining([
      'healing_attempted',
      'healing_outcome',
      'healed_score',
      'ambiguity_margin',
      'regenerated_locator',
      'top_candidates',
      'healing_latency_ms',
    ])
  );
  expect(
    (
      database.db.prepare('SELECT name FROM migrations WHERE id=5').get() as {
        name: string;
      }
    )?.name
  ).toBe('005_self_healing_telemetry');
  const seed = createDevelopmentSeedBundle();
  database.repository.upsertAuthProfile(seed.authProfile);
  database.repository.saveWorkflowVersion(seed.workflowVersion);
  database.repository.upsertSchedule(seed.schedule);
  const telemetry = {
    healingAttempted: true,
    healingOutcome: 'autonomous_repair' as const,
    healedScore: 0.91,
    ambiguityMargin: 0.22,
    regeneratedLocator: {
      kind: 'css' as const,
      selector: '[data-waypoint-healed="test"]',
    },
    topCandidates: [
      {
        index: 0,
        score: 0.91,
        tagName: 'button',
        accessibleName: 'Continue',
        features: {
          semantic: 1,
          text: 1,
          attributes: 0.8,
          structural: 1,
          position: 0.5,
        },
      },
    ],
    healingLatencyMs: 3.125,
  };
  const graph = {
    ...seed.runGraph,
    steps: seed.runGraph.steps.map((step) => ({ ...step, ...telemetry })),
  };
  database.repository.saveRunGraph(graph);
  expect(database.repository.getRunGraph(graph.run.id)?.steps[0]).toMatchObject(
    telemetry
  );
  const unchanged = database.db
    .prepare(
      'SELECT healing_attempted,healed_score,healing_latency_ms FROM run_steps LIMIT 1'
    )
    .get();
  expect(unchanged).toMatchObject({
    healing_attempted: 1,
    healed_score: 0.91,
    healing_latency_ms: 3.125,
  });
  database.close();
});

it('upgrades existing v4 step history without data loss and reapplies idempotently', () => {
  const database = openWaypointDatabase(':memory:');
  const seed = createDevelopmentSeedBundle();
  database.repository.upsertAuthProfile(seed.authProfile);
  database.repository.saveWorkflowVersion(seed.workflowVersion);
  database.repository.upsertSchedule(seed.schedule);
  database.repository.saveRunGraph(seed.runGraph);
  for (const column of [
    'healing_attempted',
    'healing_outcome',
    'healed_score',
    'ambiguity_margin',
    'regenerated_locator',
    'top_candidates',
    'healing_latency_ms',
  ])
    database.db.exec(`ALTER TABLE run_steps DROP COLUMN ${column}`);
  database.db.exec('DELETE FROM migrations WHERE id=5');
  expect(applyMigrations(database.db).map((m) => m.name)).toEqual([
    '005_self_healing_telemetry',
  ]);
  expect(applyMigrations(database.db)).toEqual([]);
  const step = database.repository.getRunGraph(seed.runGraph.run.id)?.steps[0];
  expect(step?.stepId).toBe(seed.runGraph.steps[0]?.stepId);
  expect(step?.healingAttempted).toBe(false);
  expect(step?.healingOutcome).toBeNull();
  expect(step?.healedScore).toBeNull();
  database.close();
});
