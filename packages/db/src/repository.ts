import { createRequire } from 'node:module';

import {
  ArtifactSchema,
  AuthProfileSchema,
  RunSchema,
  RunStepResultSchema,
  ScheduleSchema,
  SettingSchema,
  WorkflowRecordSchema,
  WorkflowSchema,
  WorkflowVersionSchema,
  createWorkflowRecord,
  createWorkflowVersion,
  type Artifact,
  type AuthProfile,
  type Run,
  type RunStepResult,
  type Schedule,
  type Setting,
  type Workflow,
  type WorkflowRecord,
  type WorkflowVersion
} from '@waypoint/shared-types';

import { CREATE_MIGRATIONS_TABLE_SQL, MIGRATIONS, type Migration } from './migrations.js';

export interface RunGraph {
  run: Run;
  steps: RunStepResult[];
  artifacts: Artifact[];
}

export interface WaypointDatabase {
  db: DatabaseSync;
  repository: WaypointRepository;
  close: () => void;
}

interface StatementSync {
  setAllowBareNamedParameters: (value: boolean) => void;
  run: (params?: Record<string, unknown>) => unknown;
  get: (params?: Record<string, unknown>) => unknown;
  all: (params?: Record<string, unknown>) => unknown[];
}

interface DatabaseSync {
  exec: (sql: string) => void;
  prepare: (sql: string) => StatementSync;
  close: () => void;
}

interface SqliteModule {
  DatabaseSync: new (filename: string) => DatabaseSync;
}

type SqliteRow = Record<string, unknown>;
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as SqliteModule;

function prepareNamed(database: DatabaseSync, sql: string): StatementSync {
  const statement = database.prepare(sql);
  statement.setAllowBareNamedParameters(true);
  return statement;
}

function parseJsonColumn<TSchema extends { parse: (input: unknown) => unknown }>(
  schema: TSchema,
  serialized: string | null
): ReturnType<TSchema['parse']> {
  return schema.parse(
    serialized === null ? null : (JSON.parse(serialized) as unknown)
  ) as ReturnType<TSchema['parse']>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: unknown): boolean {
  return Number(value) === 1;
}

function asNumber(value: unknown): number {
  return Number(value);
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

function mapWorkflowRow(row: SqliteRow): WorkflowRecord {
  return WorkflowRecordSchema.parse({
    id: row.id,
    name: row.name,
    description: asOptionalString(row.description),
    enabled: asBoolean(row.enabled),
    trigger: parseJsonColumn(WorkflowRecordSchema.shape.trigger, row.trigger_json as string),
    defaultAuthProfileId: asOptionalString(row.default_auth_profile_id),
    latestVersion: asNumber(row.latest_version),
    schemaVersion: asNumber(row.schema_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags: parseJsonColumn(WorkflowRecordSchema.shape.tags, row.tags_json as string)
  });
}

function mapWorkflowVersionRow(row: SqliteRow): WorkflowVersion {
  return WorkflowVersionSchema.parse({
    id: row.id,
    workflowId: row.workflow_id,
    version: asNumber(row.version),
    schemaVersion: asNumber(row.schema_version),
    definition: parseJsonColumn(WorkflowSchema, row.definition_json as string),
    createdAt: row.created_at,
    changeSummary: asOptionalString(row.change_summary),
    createdBy: row.created_by,
    sourceRecordingId: asOptionalString(row.source_recording_id)
  });
}

function mapRunRow(row: SqliteRow): Run {
  return RunSchema.parse({
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersionId: row.workflow_version_id,
    workflowVersion: asNumber(row.workflow_version),
    status: row.status,
    triggerSource: row.trigger_source,
    scheduleId: asOptionalString(row.schedule_id),
    authProfileId: asOptionalString(row.auth_profile_id),
    startedAt: row.started_at,
    finishedAt: asOptionalString(row.finished_at),
    errorCode: asOptionalString(row.error_code),
    errorMessage: asOptionalString(row.error_message),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: parseJsonColumn(RunSchema.shape.metadata, row.metadata_json as string)
  });
}

function mapRunStepRow(row: SqliteRow): RunStepResult {
  return RunStepResultSchema.parse({
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    stepType: row.step_type,
    status: row.status,
    attemptCount: asNumber(row.attempt_count),
    startedAt: row.started_at,
    finishedAt: asOptionalString(row.finished_at),
    durationMs: row.duration_ms === null ? undefined : asNumber(row.duration_ms),
    resolvedLocator:
      row.resolved_locator_json === null
        ? undefined
        : parseJsonColumn(
            RunStepResultSchema.shape.resolvedLocator,
            row.resolved_locator_json as string
          ),
    errorCode: asOptionalString(row.error_code),
    errorMessage: asOptionalString(row.error_message),
    artifactIds: parseJsonColumn(
      RunStepResultSchema.shape.artifactIds,
      row.artifact_ids_json as string
    ),
    debug: parseJsonColumn(RunStepResultSchema.shape.debug, row.debug_json as string)
  });
}

function mapArtifactRow(row: SqliteRow): Artifact {
  return ArtifactSchema.parse({
    id: row.id,
    runId: asOptionalString(row.run_id),
    runStepResultId: asOptionalString(row.run_step_result_id),
    kind: row.kind,
    path: row.path,
    mimeType: row.mime_type,
    sizeBytes: asNumber(row.size_bytes),
    sha256: asOptionalString(row.sha256),
    createdAt: row.created_at,
    metadata: parseJsonColumn(ArtifactSchema.shape.metadata, row.metadata_json as string)
  });
}

function mapScheduleRow(row: SqliteRow): Schedule {
  return ScheduleSchema.parse({
    id: row.id,
    workflowId: row.workflow_id,
    enabled: asBoolean(row.enabled),
    pattern: JSON.parse((row.pattern_json as string) || '{"kind":"daily"}'),
    timezone: row.timezone,
    hour: asNumber(row.hour),
    minute: asNumber(row.minute),
    missedRunPolicy: row.missed_run_policy ?? 'skip',
    authProfileId: asOptionalString(row.auth_profile_id),
    nextRunAt: asOptionalString(row.next_run_at),
    lastRunAt: asOptionalString(row.last_run_at),
    lastRunStatus: asOptionalString(row.last_run_status),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapAuthProfileRow(row: SqliteRow): AuthProfile {
  return AuthProfileSchema.parse({
    id: row.id,
    name: row.name,
    browserEngine: row.browser_engine,
    storageStatePath: row.storage_state_path,
    profileDirectory: row.profile_directory,
    notes: asOptionalString(row.notes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastValidatedAt: asOptionalString(row.last_validated_at),
    metadata: parseJsonColumn(AuthProfileSchema.shape.metadata, row.metadata_json as string)
  });
}

function mapSettingRow(row: SqliteRow): Setting {
  return SettingSchema.parse({
    key: row.key,
    value: parseJsonColumn(SettingSchema.shape.value, row.value_json as string),
    updatedAt: row.updated_at
  });
}

/**
 * Applies pending migrations to a database connection.
 */
export function applyMigrations(database: DatabaseSync): Migration[] {
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(CREATE_MIGRATIONS_TABLE_SQL);

  const appliedMigrationIds = new Set(
    prepareNamed(database, 'SELECT id FROM migrations ORDER BY id ASC')
      .all()
      .map((row) => Number((row as SqliteRow).id))
  );

  const applied: Migration[] = [];

  for (const migration of MIGRATIONS) {
    if (appliedMigrationIds.has(migration.id)) {
      continue;
    }

    database.exec('BEGIN IMMEDIATE;');

    try {
      database.exec(migration.sql);
      prepareNamed(
        database,
        'INSERT INTO migrations (id, name, applied_at) VALUES (:id, :name, :appliedAt)'
      ).run({
        id: migration.id,
        name: migration.name,
        appliedAt: currentTimestamp()
      });
      database.exec('COMMIT;');
      applied.push(migration);
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  return applied;
}

/**
 * Typed repository over the local SQLite schema.
 */
export class WaypointRepository {
  private transactionDepth = 0;

  public constructor(private readonly database: DatabaseSync) {
    this.database.exec('PRAGMA foreign_keys = ON;');
  }

  public transaction<T>(callback: () => T): T {
    if (this.transactionDepth > 0) {
      return callback();
    }

    this.database.exec('BEGIN IMMEDIATE;');
    this.transactionDepth += 1;

    try {
      const result = callback();
      this.database.exec('COMMIT;');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
  }

  public saveWorkflowDefinition(
    workflowInput: Workflow,
    options: Parameters<typeof createWorkflowVersion>[1] = {}
  ): WorkflowVersion {
    const workflow = WorkflowSchema.parse(workflowInput);
    const version = createWorkflowVersion(workflow, options);

    this.saveWorkflowVersion(version);

    return version;
  }

  public saveWorkflowVersion(versionInput: WorkflowVersion): WorkflowVersion {
    const version = WorkflowVersionSchema.parse(versionInput);
    const workflow = createWorkflowRecord(version.definition);

    this.transaction(() => {
      prepareNamed(
        this.database,
        `
        INSERT INTO workflows (
          id,
          name,
          description,
          enabled,
          trigger_json,
          default_auth_profile_id,
          latest_version,
          schema_version,
          created_at,
          updated_at,
          tags_json
        ) VALUES (
          :id,
          :name,
          :description,
          :enabled,
          :triggerJson,
          :defaultAuthProfileId,
          :latestVersion,
          :schemaVersion,
          :createdAt,
          :updatedAt,
          :tagsJson
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          enabled = excluded.enabled,
          trigger_json = excluded.trigger_json,
          default_auth_profile_id = excluded.default_auth_profile_id,
          latest_version = excluded.latest_version,
          schema_version = excluded.schema_version,
          updated_at = excluded.updated_at,
          tags_json = excluded.tags_json
        `
      ).run({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description ?? null,
        enabled: workflow.enabled ? 1 : 0,
        triggerJson: serializeJson(workflow.trigger),
        defaultAuthProfileId: workflow.defaultAuthProfileId ?? null,
        latestVersion: workflow.latestVersion,
        schemaVersion: workflow.schemaVersion,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        tagsJson: serializeJson(workflow.tags)
      });

      prepareNamed(
        this.database,
        `
        INSERT INTO workflow_versions (
          id,
          workflow_id,
          version,
          schema_version,
          definition_json,
          created_at,
          change_summary,
          created_by,
          source_recording_id
        ) VALUES (
          :id,
          :workflowId,
          :version,
          :schemaVersion,
          :definitionJson,
          :createdAt,
          :changeSummary,
          :createdBy,
          :sourceRecordingId
        )
        ON CONFLICT(workflow_id, version) DO UPDATE SET
          definition_json = excluded.definition_json,
          created_at = excluded.created_at,
          change_summary = excluded.change_summary,
          created_by = excluded.created_by,
          source_recording_id = excluded.source_recording_id
        `
      ).run({
        id: version.id,
        workflowId: version.workflowId,
        version: version.version,
        schemaVersion: version.schemaVersion,
        definitionJson: serializeJson(version.definition),
        createdAt: version.createdAt,
        changeSummary: version.changeSummary ?? null,
        createdBy: version.createdBy,
        sourceRecordingId: version.sourceRecordingId ?? null
      });
    });

    return version;
  }

  public listWorkflows(): WorkflowRecord[] {
    return prepareNamed(
      this.database,
      'SELECT * FROM workflows ORDER BY updated_at DESC'
    )
      .all()
      .map((row) => mapWorkflowRow(row as SqliteRow));
  }

  public getWorkflow(workflowId: string): WorkflowRecord | null {
    const row = prepareNamed(
      this.database,
      'SELECT * FROM workflows WHERE id = :workflowId'
    ).get({
      workflowId
    });

    return row ? mapWorkflowRow(row as SqliteRow) : null;
  }

  public listWorkflowVersions(workflowId: string): WorkflowVersion[] {
    return prepareNamed(
      this.database,
      `
      SELECT * FROM workflow_versions
      WHERE workflow_id = :workflowId
      ORDER BY version DESC
      `
    )
      .all({ workflowId })
      .map((row) => mapWorkflowVersionRow(row as SqliteRow));
  }

  public getWorkflowVersion(
    workflowId: string,
    version: number
  ): WorkflowVersion | null {
    const row = prepareNamed(
      this.database,
      `
      SELECT * FROM workflow_versions
      WHERE workflow_id = :workflowId AND version = :version
      `
    ).get({
      workflowId,
      version
    });

    return row ? mapWorkflowVersionRow(row as SqliteRow) : null;
  }

  public getLatestWorkflowDefinition(workflowId: string): Workflow | null {
    const row = prepareNamed(
      this.database,
      `
      SELECT * FROM workflow_versions
      WHERE workflow_id = :workflowId
      ORDER BY version DESC
      LIMIT 1
      `
    ).get({
      workflowId
    });

    return row
      ? WorkflowSchema.parse(
          parseJsonColumn(WorkflowSchema, (row as SqliteRow).definition_json as string)
        )
      : null;
  }

  public saveRunGraph(runGraphInput: RunGraph): RunGraph {
    const runGraph = {
      run: RunSchema.parse(runGraphInput.run),
      steps: runGraphInput.steps.map((step) => RunStepResultSchema.parse(step)),
      artifacts: runGraphInput.artifacts.map((artifact) =>
        ArtifactSchema.parse(artifact)
      )
    };

    this.transaction(() => {
      prepareNamed(
        this.database,
        `
        INSERT INTO runs (
          id,
          workflow_id,
          workflow_version_id,
          workflow_version,
          status,
          trigger_source,
          schedule_id,
          auth_profile_id,
          started_at,
          finished_at,
          error_code,
          error_message,
          created_at,
          updated_at,
          metadata_json
        ) VALUES (
          :id,
          :workflowId,
          :workflowVersionId,
          :workflowVersion,
          :status,
          :triggerSource,
          :scheduleId,
          :authProfileId,
          :startedAt,
          :finishedAt,
          :errorCode,
          :errorMessage,
          :createdAt,
          :updatedAt,
          :metadataJson
        )
        ON CONFLICT(id) DO UPDATE SET
          workflow_id = excluded.workflow_id,
          workflow_version_id = excluded.workflow_version_id,
          workflow_version = excluded.workflow_version,
          status = excluded.status,
          trigger_source = excluded.trigger_source,
          schedule_id = excluded.schedule_id,
          auth_profile_id = excluded.auth_profile_id,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          metadata_json = excluded.metadata_json
        `
      ).run({
        id: runGraph.run.id,
        workflowId: runGraph.run.workflowId,
        workflowVersionId: runGraph.run.workflowVersionId,
        workflowVersion: runGraph.run.workflowVersion,
        status: runGraph.run.status,
        triggerSource: runGraph.run.triggerSource,
        scheduleId: runGraph.run.scheduleId ?? null,
        authProfileId: runGraph.run.authProfileId ?? null,
        startedAt: runGraph.run.startedAt,
        finishedAt: runGraph.run.finishedAt ?? null,
        errorCode: runGraph.run.errorCode ?? null,
        errorMessage: runGraph.run.errorMessage ?? null,
        createdAt: runGraph.run.createdAt,
        updatedAt: runGraph.run.updatedAt,
        metadataJson: serializeJson(runGraph.run.metadata)
      });

      prepareNamed(this.database, 'DELETE FROM artifacts WHERE run_id = :runId').run({
        runId: runGraph.run.id
      });
      prepareNamed(this.database, 'DELETE FROM run_steps WHERE run_id = :runId').run({
        runId: runGraph.run.id
      });

      const insertRunStep = prepareNamed(
        this.database,
        `
        INSERT INTO run_steps (
          id,
          run_id,
          step_id,
          step_type,
          status,
          attempt_count,
          started_at,
          finished_at,
          duration_ms,
          resolved_locator_json,
          error_code,
          error_message,
          artifact_ids_json,
          debug_json
        ) VALUES (
          :id,
          :runId,
          :stepId,
          :stepType,
          :status,
          :attemptCount,
          :startedAt,
          :finishedAt,
          :durationMs,
          :resolvedLocatorJson,
          :errorCode,
          :errorMessage,
          :artifactIdsJson,
          :debugJson
        )
        `
      );

      for (const step of runGraph.steps) {
        insertRunStep.run({
          id: step.id,
          runId: step.runId,
          stepId: step.stepId,
          stepType: step.stepType,
          status: step.status,
          attemptCount: step.attemptCount,
          startedAt: step.startedAt,
          finishedAt: step.finishedAt ?? null,
          durationMs: step.durationMs ?? null,
          resolvedLocatorJson: step.resolvedLocator
            ? serializeJson(step.resolvedLocator)
            : null,
          errorCode: step.errorCode ?? null,
          errorMessage: step.errorMessage ?? null,
          artifactIdsJson: serializeJson(step.artifactIds),
          debugJson: serializeJson(step.debug)
        });
      }

      const insertArtifact = prepareNamed(
        this.database,
        `
        INSERT INTO artifacts (
          id,
          run_id,
          run_step_result_id,
          kind,
          path,
          mime_type,
          size_bytes,
          sha256,
          created_at,
          metadata_json
        ) VALUES (
          :id,
          :runId,
          :runStepResultId,
          :kind,
          :path,
          :mimeType,
          :sizeBytes,
          :sha256,
          :createdAt,
          :metadataJson
        )
        `
      );

      for (const artifact of runGraph.artifacts) {
        insertArtifact.run({
          id: artifact.id,
          runId: artifact.runId ?? null,
          runStepResultId: artifact.runStepResultId ?? null,
          kind: artifact.kind,
          path: artifact.path,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256 ?? null,
          createdAt: artifact.createdAt,
          metadataJson: serializeJson(artifact.metadata)
        });
      }
    });

    return runGraph;
  }

  public getRunGraph(runId: string): RunGraph | null {
    const runRow = prepareNamed(
      this.database,
      'SELECT * FROM runs WHERE id = :runId'
    ).get({ runId });

    if (!runRow) {
      return null;
    }

    const steps = prepareNamed(
      this.database,
      'SELECT * FROM run_steps WHERE run_id = :runId ORDER BY started_at ASC'
    )
      .all({ runId })
      .map((row) => mapRunStepRow(row as SqliteRow));
    const artifacts = prepareNamed(
      this.database,
      'SELECT * FROM artifacts WHERE run_id = :runId ORDER BY created_at ASC'
    )
      .all({ runId })
      .map((row) => mapArtifactRow(row as SqliteRow));

    return {
      run: mapRunRow(runRow as SqliteRow),
      steps,
      artifacts
    };
  }

  public listRunsForWorkflow(workflowId: string): Run[] {
    return prepareNamed(
      this.database,
      'SELECT * FROM runs WHERE workflow_id = :workflowId ORDER BY started_at DESC'
    )
      .all({ workflowId })
      .map((row) => mapRunRow(row as SqliteRow));
  }

  public upsertSchedule(scheduleInput: Schedule): Schedule {
    const schedule = ScheduleSchema.parse(scheduleInput);

    this.transaction(() => {
      prepareNamed(
        this.database,
        `
        INSERT INTO schedules (
          id,
          workflow_id,
          enabled,
          type,
          pattern_json,
          timezone,
          hour,
          minute,
          missed_run_policy,
          auth_profile_id,
          next_run_at,
          last_run_at,
          last_run_status,
          created_at,
          updated_at
        ) VALUES (
          :id,
          :workflowId,
          :enabled,
          :type,
          :patternJson,
          :timezone,
          :hour,
          :minute,
          :missedRunPolicy,
          :authProfileId,
          :nextRunAt,
          :lastRunAt,
          :lastRunStatus,
          :createdAt,
          :updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          workflow_id = excluded.workflow_id,
          enabled = excluded.enabled,
          type = excluded.type,
          pattern_json = excluded.pattern_json,
          timezone = excluded.timezone,
          hour = excluded.hour,
          minute = excluded.minute,
          missed_run_policy = excluded.missed_run_policy,
          auth_profile_id = excluded.auth_profile_id,
          next_run_at = excluded.next_run_at,
          last_run_at = excluded.last_run_at,
          last_run_status = excluded.last_run_status,
          updated_at = excluded.updated_at
        `
      ).run({
        id: schedule.id,
        workflowId: schedule.workflowId,
        enabled: schedule.enabled ? 1 : 0,
        type: schedule.pattern.kind,
        patternJson: serializeJson(schedule.pattern),
        timezone: schedule.timezone,
        hour: schedule.hour,
        minute: schedule.minute,
        missedRunPolicy: schedule.missedRunPolicy,
        authProfileId: schedule.authProfileId ?? null,
        nextRunAt: schedule.nextRunAt ?? null,
        lastRunAt: schedule.lastRunAt ?? null,
        lastRunStatus: schedule.lastRunStatus ?? null,
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt
      });
    });

    return schedule;
  }

  public listSchedules(): Schedule[] {
    return prepareNamed(
      this.database,
      'SELECT * FROM schedules ORDER BY updated_at DESC'
    )
      .all()
      .map((row) => mapScheduleRow(row as SqliteRow));
  }

  public upsertAuthProfile(profileInput: AuthProfile): AuthProfile {
    const profile = AuthProfileSchema.parse(profileInput);

    this.transaction(() => {
      prepareNamed(
        this.database,
        `
        INSERT INTO auth_profiles (
          id,
          name,
          browser_engine,
          storage_state_path,
          profile_directory,
          notes,
          created_at,
          updated_at,
          last_validated_at,
          metadata_json
        ) VALUES (
          :id,
          :name,
          :browserEngine,
          :storageStatePath,
          :profileDirectory,
          :notes,
          :createdAt,
          :updatedAt,
          :lastValidatedAt,
          :metadataJson
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          browser_engine = excluded.browser_engine,
          storage_state_path = excluded.storage_state_path,
          profile_directory = excluded.profile_directory,
          notes = excluded.notes,
          updated_at = excluded.updated_at,
          last_validated_at = excluded.last_validated_at,
          metadata_json = excluded.metadata_json
        `
      ).run({
        id: profile.id,
        name: profile.name,
        browserEngine: profile.browserEngine,
        storageStatePath: profile.storageStatePath,
        profileDirectory: profile.profileDirectory,
        notes: profile.notes ?? null,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        lastValidatedAt: profile.lastValidatedAt ?? null,
        metadataJson: serializeJson(profile.metadata)
      });
    });

    return profile;
  }

  public listAuthProfiles(): AuthProfile[] {
    return prepareNamed(
      this.database,
      'SELECT * FROM auth_profiles ORDER BY updated_at DESC'
    )
      .all()
      .map((row) => mapAuthProfileRow(row as SqliteRow));
  }

  public getAuthProfile(profileId: string): AuthProfile | null {
    const row = prepareNamed(
      this.database,
      'SELECT * FROM auth_profiles WHERE id = :profileId'
    ).get({ profileId });

    return row ? mapAuthProfileRow(row as SqliteRow) : null;
  }

  public deleteAuthProfile(profileId: string): boolean {
    const result = prepareNamed(
      this.database,
      'DELETE FROM auth_profiles WHERE id = :profileId'
    ).run({ profileId }) as { changes: number };

    return result.changes > 0;
  }

  public getSchedule(scheduleId: string): Schedule | null {
    const row = prepareNamed(
      this.database,
      'SELECT * FROM schedules WHERE id = :scheduleId'
    ).get({ scheduleId });

    return row ? mapScheduleRow(row as SqliteRow) : null;
  }

  public getScheduleForWorkflow(workflowId: string): Schedule | null {
    const row = prepareNamed(
      this.database,
      'SELECT * FROM schedules WHERE workflow_id = :workflowId LIMIT 1'
    ).get({ workflowId });

    return row ? mapScheduleRow(row as SqliteRow) : null;
  }

  public deleteSchedule(scheduleId: string): boolean {
    const result = prepareNamed(
      this.database,
      'DELETE FROM schedules WHERE id = :scheduleId'
    ).run({ scheduleId }) as { changes: number };

    return result.changes > 0;
  }

  public updateWorkflow(
    workflowId: string,
    updates: { name?: string | undefined; description?: string | undefined; enabled?: boolean | undefined; defaultAuthProfileId?: string | null | undefined; tags?: string[] | undefined }
  ): WorkflowRecord | null {
    const existing = this.getWorkflow(workflowId);
    if (!existing) return null;

    const now = currentTimestamp();
    prepareNamed(
      this.database,
      `
      UPDATE workflows SET
        name = :name,
        description = :description,
        enabled = :enabled,
        default_auth_profile_id = :defaultAuthProfileId,
        tags_json = :tagsJson,
        updated_at = :updatedAt
      WHERE id = :workflowId
      `
    ).run({
      workflowId,
      name: updates.name ?? existing.name,
      description: updates.description !== undefined ? updates.description : (existing.description ?? null),
      enabled: (updates.enabled ?? existing.enabled) ? 1 : 0,
      defaultAuthProfileId: updates.defaultAuthProfileId !== undefined
        ? updates.defaultAuthProfileId
        : (existing.defaultAuthProfileId ?? null),
      tagsJson: serializeJson(updates.tags ?? existing.tags),
      updatedAt: now
    });

    return this.getWorkflow(workflowId);
  }

  public deleteWorkflow(workflowId: string): boolean {
    const result = prepareNamed(
      this.database,
      'DELETE FROM workflows WHERE id = :workflowId'
    ).run({ workflowId }) as { changes: number };

    return result.changes > 0;
  }

  public listRuns(limit = 50): Run[] {
    return prepareNamed(
      this.database,
      'SELECT * FROM runs ORDER BY started_at DESC LIMIT :limit'
    )
      .all({ limit })
      .map((row) => mapRunRow(row as SqliteRow));
  }

  public setSetting(settingInput: Setting): Setting {
    const setting = SettingSchema.parse(settingInput);

    this.transaction(() => {
      prepareNamed(
        this.database,
        `
        INSERT INTO settings (key, value_json, updated_at)
        VALUES (:key, :valueJson, :updatedAt)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
        `
      ).run({
        key: setting.key,
        valueJson: serializeJson(setting.value),
        updatedAt: setting.updatedAt
      });
    });

    return setting;
  }

  public getSetting(key: string): Setting | null {
    const row = prepareNamed(
      this.database,
      'SELECT * FROM settings WHERE key = :key'
    ).get({ key });

    return row ? mapSettingRow(row as SqliteRow) : null;
  }

  public listSettings(): Setting[] {
    return prepareNamed(
      this.database,
      'SELECT * FROM settings ORDER BY key ASC'
    )
      .all()
      .map((row) => mapSettingRow(row as SqliteRow));
  }
}

/**
 * Opens a SQLite database, applies migrations, and returns a typed repository.
 */
export function openWaypointDatabase(filename = ':memory:'): WaypointDatabase {
  const db = new DatabaseSync(filename);

  applyMigrations(db);

  return {
    db,
    repository: new WaypointRepository(db),
    close: () => db.close()
  };
}
