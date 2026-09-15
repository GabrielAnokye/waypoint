export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** SQL used to initialize the migration bookkeeping table. */
export const CREATE_MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);
`;

/** Core v1 SQLite schema for workflow persistence and execution history. */
export const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS auth_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  browser_engine TEXT NOT NULL,
  storage_state_path TEXT NOT NULL,
  profile_directory TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_validated_at TEXT,
  metadata_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL,
  trigger_json TEXT NOT NULL,
  default_auth_profile_id TEXT,
  latest_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tags_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  change_summary TEXT,
  created_by TEXT NOT NULL,
  source_recording_id TEXT,
  UNIQUE(workflow_id, version)
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL,
  type TEXT NOT NULL,
  timezone TEXT NOT NULL,
  hour INTEGER NOT NULL,
  minute INTEGER NOT NULL,
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  workflow_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  schedule_id TEXT REFERENCES schedules(id) ON DELETE SET NULL,
  auth_profile_id TEXT REFERENCES auth_profiles(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  step_type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  resolved_locator_json TEXT,
  error_code TEXT,
  error_message TEXT,
  artifact_ids_json TEXT NOT NULL,
  debug_json TEXT NOT NULL,
  UNIQUE(run_id, step_id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  run_step_result_id TEXT REFERENCES run_steps(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id
  ON workflow_versions(workflow_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_runs_workflow_id
  ON runs(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_steps_run_id
  ON run_steps(run_id, started_at ASC);
CREATE INDEX IF NOT EXISTS idx_artifacts_run_id
  ON artifacts(run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_schedules_workflow_id
  ON schedules(workflow_id);
`;

/** Adds pattern_json, missed_run_policy, auth_profile_id, last_run_status to schedules; drops type. */
export const SCHEDULES_V2_SQL = `
ALTER TABLE schedules ADD COLUMN pattern_json TEXT NOT NULL DEFAULT '{"kind":"daily"}';
ALTER TABLE schedules ADD COLUMN missed_run_policy TEXT NOT NULL DEFAULT 'skip';
ALTER TABLE schedules ADD COLUMN auth_profile_id TEXT REFERENCES auth_profiles(id) ON DELETE SET NULL;
ALTER TABLE schedules ADD COLUMN last_run_status TEXT;

-- Migrate existing type column data into pattern_json.
UPDATE schedules SET pattern_json = '{"kind":"' || type || '"}' WHERE type IS NOT NULL;
`;

/** Ordered migration list applied to every opened database. */
export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: '001_initial_schema',
    sql: INITIAL_SCHEMA_SQL
  },
  {
    id: 2,
    name: '002_schedules_v2',
    sql: SCHEDULES_V2_SQL
  }
];
