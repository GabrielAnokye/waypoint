import { z } from 'zod';

/** JSON-compatible value used for debug metadata, settings, and artifacts. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Current schema version for exported and persisted workflow JSON. */
export const WORKFLOW_SCHEMA_VERSION = 1 as const;

/** Default timeout applied to steps when no explicit override is present. */
export const DEFAULT_STEP_TIMEOUT_MS = 30_000;

/** Default retry policy for version 1 workflow execution. */
export const DEFAULT_RETRY_POLICY = {
  maxAttempts: 1,
  backoffMs: 0,
  strategy: 'fixed'
} as const;

/** Creates default debug metadata attached to normalized workflow steps. */
export function createDefaultDebugMetadata() {
  return {
    sourceEventIds: [] as string[],
    notes: [] as string[],
    tags: [] as string[],
    extra: {} as Record<string, JsonValue>
  };
}

/** JSON schema used across settings, artifacts, and debug metadata. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
);

/** Shared identifier schema for persisted product entities. */
export const EntityIdSchema = z.string().min(1);

/** ISO 8601 datetime string used for persisted timestamps. */
export const IsoDateTimeSchema = z.string().datetime();

/** Supported step type names in the workflow DSL. */
export const WorkflowStepTypeSchema = z.enum([
  'newTab',
  'goto',
  'click',
  'type',
  'select',
  'press',
  'waitFor',
  'assert',
  'closeTab'
]);

/** Retry strategy used when a step is safe to retry. */
export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(1),
  backoffMs: z.number().int().nonnegative().default(0),
  strategy: z.enum(['fixed', 'exponential']).default('fixed')
});

/** Debug metadata that links compiled artifacts back to recording context. */
export const DebugMetadataSchema = z.object({
  sourceEventIds: z.array(EntityIdSchema).default([]),
  notes: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  sourceUrl: z.string().url().optional(),
  rawEventType: z.string().min(1).optional(),
  extra: z.record(z.string(), JsonValueSchema).default({})
});

/** Frame path for locating targets within nested frames. */
export const FramePathSchema = z.array(
  z.object({
    index: z.number().int().nonnegative(),
    name: z.string().min(1).optional(),
    url: z.string().url().optional()
  })
);

const LocatorBaseSchema = z.object({
  description: z.string().min(1).optional()
});

/** Locator strategies ranked from semantic-first to coordinate-last. */
export const LocatorSchema = z.discriminatedUnion('kind', [
  LocatorBaseSchema.extend({
    kind: z.literal('role'),
    role: z.string().min(1),
    name: z.string().min(1)
  }),
  LocatorBaseSchema.extend({
    kind: z.literal('label'),
    label: z.string().min(1)
  }),
  LocatorBaseSchema.extend({
    kind: z.literal('text'),
    text: z.string().min(1),
    exact: z.boolean().default(false)
  }),
  LocatorBaseSchema.extend({
    kind: z.literal('testId'),
    testId: z.string().min(1)
  }),
  LocatorBaseSchema.extend({
    kind: z.literal('placeholder'),
    placeholder: z.string().min(1)
  }),
  LocatorBaseSchema.extend({
    kind: z.literal('css'),
    selector: z.string().min(1)
  }),
  LocatorBaseSchema.extend({
    kind: z.literal('xpath'),
    selector: z.string().min(1)
  }),
  LocatorBaseSchema.extend({
    kind: z.literal('coordinates'),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative()
  })
]);

/** Shared target representation used during recording and replay. */
export const TargetSchema = z.object({
  primaryLocator: LocatorSchema,
  fallbackLocators: z.array(LocatorSchema).default([]),
  framePath: FramePathSchema.optional()
});

/** Trigger metadata stored on workflow definitions and workflow records. */
export const WorkflowTriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('manual')
  }),
  z.object({
    type: z.literal('schedule'),
    scheduleId: EntityIdSchema.optional()
  })
]);

const StepBaseSchema = z.object({
  id: EntityIdSchema,
  label: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(DEFAULT_STEP_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema.default(DEFAULT_RETRY_POLICY),
  debug: DebugMetadataSchema.default(createDefaultDebugMetadata),
  tabAlias: z.string().min(1).optional()
});

const InteractiveStepBaseSchema = StepBaseSchema.extend(TargetSchema.shape);

/** Selection value supported by `select` steps. */
export const SelectOptionSchema = z
  .object({
    by: z.enum(['value', 'label', 'index']),
    value: z.union([z.string(), z.number().int().nonnegative()])
  })
  .superRefine((value, ctx) => {
    if (value.by === 'index' && typeof value.value !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select options using index must provide a numeric value.',
        path: ['value']
      });
    }

    if (value.by !== 'index' && typeof value.value !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select options using label or value must provide a string.',
        path: ['value']
      });
    }
  });

/** Element assertion variants used by `assert` steps. */
export const AssertionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('visible')
  }),
  z.object({
    kind: z.literal('hidden')
  }),
  z.object({
    kind: z.literal('textEquals'),
    expected: z.string()
  }),
  z.object({
    kind: z.literal('textContains'),
    expected: z.string()
  }),
  z.object({
    kind: z.literal('valueEquals'),
    expected: z.string()
  }),
  z.object({
    kind: z.literal('attributeEquals'),
    name: z.string().min(1),
    expected: z.string()
  })
]);

/** Wait conditions used by `waitFor` steps. */
export const WaitConditionSchema = z.enum([
  'attached',
  'detached',
  'visible',
  'hidden',
  'enabled',
  'disabled'
]);

/** Canonical workflow step schema used for persistence and import/export. */
export const WorkflowStepSchema = z.discriminatedUnion('type', [
  StepBaseSchema.extend({
    type: z.literal('newTab'),
    initialUrl: z.string().url().optional()
  }),
  StepBaseSchema.extend({
    type: z.literal('goto'),
    url: z.string().url(),
    waitUntil: z
      .enum(['load', 'domcontentloaded', 'networkidle'])
      .default('load')
  }),
  InteractiveStepBaseSchema.extend({
    type: z.literal('click'),
    button: z.enum(['left', 'middle', 'right']).default('left'),
    clickCount: z.number().int().min(1).max(3).default(1)
  }),
  InteractiveStepBaseSchema.extend({
    type: z.literal('type'),
    value: z.string(),
    clearBefore: z.boolean().default(true),
    sensitive: z.boolean().default(false)
  }),
  InteractiveStepBaseSchema.extend({
    type: z.literal('select'),
    option: SelectOptionSchema
  }),
  InteractiveStepBaseSchema.extend({
    type: z.literal('press'),
    key: z.string().min(1),
    modifiers: z
      .array(z.enum(['Alt', 'Control', 'Meta', 'Shift']))
      .default([])
  }),
  InteractiveStepBaseSchema.extend({
    type: z.literal('waitFor'),
    condition: WaitConditionSchema.default('visible')
  }),
  InteractiveStepBaseSchema.extend({
    type: z.literal('assert'),
    assertion: AssertionSchema
  }),
  StepBaseSchema.extend({
    type: z.literal('closeTab')
  })
]);

/** Exported workflow JSON document stored and exchanged outside the database. */
export const WorkflowSchema = z.object({
  schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
  workflowVersion: z.number().int().positive(),
  workflowId: EntityIdSchema,
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  trigger: WorkflowTriggerSchema,
  defaultAuthProfileId: EntityIdSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  tags: z.array(z.string()).default([]),
  steps: z.array(WorkflowStepSchema).min(1),
  metadata: z.record(z.string(), JsonValueSchema).default({})
});

/** Workflow metadata stored in the `workflows` table. */
export const WorkflowRecordSchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  trigger: WorkflowTriggerSchema,
  defaultAuthProfileId: EntityIdSchema.optional(),
  latestVersion: z.number().int().positive(),
  schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  tags: z.array(z.string()).default([])
});

/** Immutable workflow revision stored in the `workflow_versions` table. */
export const WorkflowVersionSchema = z
  .object({
    id: EntityIdSchema,
    workflowId: EntityIdSchema,
    version: z.number().int().positive(),
    schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
    definition: WorkflowSchema,
    createdAt: IsoDateTimeSchema,
    changeSummary: z.string().min(1).optional(),
    createdBy: z.enum(['user', 'system']).default('user'),
    sourceRecordingId: EntityIdSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.workflowId !== value.definition.workflowId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Workflow version workflowId must match the definition workflowId.',
        path: ['workflowId']
      });
    }

    if (value.version !== value.definition.workflowVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Workflow version number must match the definition workflowVersion.',
        path: ['version']
      });
    }

    if (value.schemaVersion !== value.definition.schemaVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Schema version must match the definition schemaVersion.',
        path: ['schemaVersion']
      });
    }
  });

/** Bounding rectangle captured for an element snapshot. */
export const BoundingRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative()
});

/**
 * Element snapshot captured by the recorder. The required `tagName` is preserved
 * for backwards compatibility; every other field is optional so older fixtures
 * keep parsing.
 */
export const ElementSnapshotSchema = z.object({
  tagName: z.string().min(1),
  textContent: z.string().optional(),
  attributes: z.record(z.string(), z.string()).default({}),
  role: z.string().min(1).optional(),
  accessibleName: z.string().optional(),
  labelText: z.string().optional(),
  placeholder: z.string().optional(),
  nameAttr: z.string().optional(),
  testId: z.string().optional(),
  nearbyText: z.string().optional(),
  cssCandidate: z.string().optional(),
  xpathFallback: z.string().optional(),
  boundingRect: BoundingRectSchema.optional(),
  framePath: FramePathSchema.optional(),
  shadowPath: z.array(z.string()).optional(),
  pageUrl: z.string().url().optional(),
  frameUrl: z.string().url().optional(),
  isPasswordField: z.boolean().optional(),
  isSensitiveHeuristic: z.boolean().optional()
});

const RawRecordedEventBaseSchema = z.object({
  eventId: EntityIdSchema,
  atMs: z.number().int().nonnegative(),
  tabId: EntityIdSchema,
  pageUrl: z.string().url().optional(),
  framePath: FramePathSchema.optional(),
  debug: DebugMetadataSchema.default(createDefaultDebugMetadata)
});

/** Raw browser events captured during recording before compilation. */
export const RawRecordedEventSchema = z.discriminatedUnion('type', [
  RawRecordedEventBaseSchema.extend({
    type: z.literal('tabOpened'),
    openerTabId: EntityIdSchema.optional(),
    initialUrl: z.string().url().optional()
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('tabClosed')
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('navigate'),
    url: z.string().url(),
    title: z.string().optional()
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('click'),
    target: TargetSchema,
    element: ElementSnapshotSchema.optional(),
    button: z.enum(['left', 'middle', 'right']).default('left')
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('input'),
    target: TargetSchema,
    element: ElementSnapshotSchema.optional(),
    value: z.string(),
    redacted: z.boolean().default(false)
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('select'),
    target: TargetSchema,
    option: SelectOptionSchema,
    element: ElementSnapshotSchema.optional()
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('press'),
    target: TargetSchema.optional(),
    key: z.string().min(1),
    modifiers: z
      .array(z.enum(['Alt', 'Control', 'Meta', 'Shift']))
      .default([])
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('waitFor'),
    target: TargetSchema.optional(),
    condition: WaitConditionSchema.default('visible')
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('assert'),
    target: TargetSchema.optional(),
    assertion: AssertionSchema
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('focus'),
    target: TargetSchema,
    element: ElementSnapshotSchema.optional()
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('blur'),
    target: TargetSchema,
    element: ElementSnapshotSchema.optional()
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('submit'),
    target: TargetSchema,
    element: ElementSnapshotSchema.optional()
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('historyChange'),
    kind: z.enum(['pushState', 'replaceState', 'popstate', 'hashchange']),
    url: z.string().url(),
    title: z.string().optional()
  }),
  RawRecordedEventBaseSchema.extend({
    type: z.literal('tabActivated'),
    previousTabId: EntityIdSchema.optional()
  })
]);

/** Recording session payload passed into the compiler layer. */
export const RecordingSessionSchema = z.object({
  recordingId: EntityIdSchema,
  name: z.string().min(1),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.optional(),
  events: z.array(RawRecordedEventSchema).min(1)
});

/** Run status for top-level workflow executions. */
export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled'
]);

/** Per-step execution status stored for every run. */
export const RunStepStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped'
]);

/** Persisted workflow run metadata. */
export const RunSchema = z.object({
  id: EntityIdSchema,
  workflowId: EntityIdSchema,
  workflowVersionId: EntityIdSchema,
  workflowVersion: z.number().int().positive(),
  status: RunStatusSchema,
  triggerSource: z.enum(['manual', 'schedule', 'repair']),
  scheduleId: EntityIdSchema.optional(),
  authProfileId: EntityIdSchema.optional(),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  metadata: z.record(z.string(), JsonValueSchema).default({})
});

/** Result for a single compiled step within a workflow run. */
export const RunStepResultSchema = z.object({
  id: EntityIdSchema,
  runId: EntityIdSchema,
  stepId: EntityIdSchema,
  stepType: WorkflowStepTypeSchema,
  status: RunStepStatusSchema,
  attemptCount: z.number().int().min(1),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.optional(),
  durationMs: z.number().int().nonnegative().optional(),
  resolvedLocator: LocatorSchema.optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
  artifactIds: z.array(EntityIdSchema).default([]),
  debug: DebugMetadataSchema.default(createDefaultDebugMetadata)
});

/** Stored artifact created during recording, replay, or debugging. */
export const ArtifactSchema = z.object({
  id: EntityIdSchema,
  runId: EntityIdSchema.optional(),
  runStepResultId: EntityIdSchema.optional(),
  kind: z.enum([
    'screenshot',
    'trace',
    'log',
    'recording',
    'domSnapshot',
    'export'
  ]),
  path: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().min(1).optional(),
  createdAt: IsoDateTimeSchema,
  metadata: z.record(z.string(), JsonValueSchema).default({})
});

/** Day-of-week enum (0=Sunday through 6=Saturday, matches JS Date.getDay). */
export const DayOfWeekSchema = z.number().int().min(0).max(6);

/** Schedule recurrence pattern. */
export const SchedulePatternSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily') }),
  z.object({ kind: z.literal('weekdays') }),
  z.object({ kind: z.literal('specific'), days: z.array(DayOfWeekSchema).min(1) })
]);

/** Missed-run policy when Chrome was closed during a scheduled time. */
export const MissedRunPolicySchema = z.enum(['skip', 'run_on_next_open']);

/** Local schedule used for workflow execution. */
export const ScheduleSchema = z.object({
  id: EntityIdSchema,
  workflowId: EntityIdSchema,
  enabled: z.boolean().default(true),
  pattern: SchedulePatternSchema.default({ kind: 'daily' }),
  timezone: z.string().min(1),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  missedRunPolicy: MissedRunPolicySchema.default('skip'),
  authProfileId: EntityIdSchema.optional(),
  nextRunAt: IsoDateTimeSchema.optional(),
  lastRunAt: IsoDateTimeSchema.optional(),
  lastRunStatus: z.string().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

/** Auth profile status derived from validation state. */
export const AuthProfileStatusSchema = z.enum([
  'never_initialized',
  'valid',
  'likely_expired',
  'invalid'
]);

/** Named authenticated browser profile reused during replay. */
export const AuthProfileSchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1),
  browserEngine: z.enum(['chromium']).default('chromium'),
  storageStatePath: z.string().min(1),
  profileDirectory: z.string().min(1),
  notes: z.string().min(1).optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  lastValidatedAt: IsoDateTimeSchema.optional(),
  metadata: z.record(z.string(), JsonValueSchema).default({})
});

/** Generic settings key/value row used by the local persistence layer. */
export const SettingSchema = z.object({
  key: z.string().min(1),
  value: JsonValueSchema,
  updatedAt: IsoDateTimeSchema
});

/** Standard runner health payload used by local health checks. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('runner'),
  version: z.string().min(1),
  uptimeSeconds: z.number().nonnegative()
});

/** Failure classification codes for structured error handling. */
export const FailureCodeSchema = z.enum([
  'locator_not_found',
  'ambiguous_locator',
  'timeout',
  'navigation_mismatch',
  'auth_expired',
  'frame_mismatch',
  'blocked_page',
  'modal_blocked',
  'step_failed',
  'unknown'
]);

/** Repair record emitted when fallback resolution confidence is low. */
export const RepairRecordSchema = z.object({
  stepId: EntityIdSchema,
  stepType: WorkflowStepTypeSchema,
  failureCode: FailureCodeSchema,
  attemptedLocators: z.array(LocatorSchema),
  resolvedLocator: LocatorSchema.optional(),
  confidence: z.number().min(0).max(1),
  screenshot: z.string().optional(),
  domSnippet: z.string().optional(),
  suggestion: z.string().optional(),
  timestamp: IsoDateTimeSchema
});

/** Structured error payload returned by the runner. */
export const RunErrorSchema = z.object({
  code: FailureCodeSchema.or(z.string().min(1)),
  message: z.string().min(1),
  stepId: EntityIdSchema.optional(),
  details: JsonValueSchema.optional(),
  repairRecord: RepairRecordSchema.optional()
});

/** Streaming run-event union emitted by the executor. */
export const RunEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('run.started'),
    runId: EntityIdSchema,
    workflowId: EntityIdSchema,
    workflowVersion: z.number().int().positive(),
    startedAt: IsoDateTimeSchema
  }),
  z.object({
    kind: z.literal('step.started'),
    runId: EntityIdSchema,
    stepId: EntityIdSchema,
    stepIndex: z.number().int().nonnegative(),
    stepType: WorkflowStepTypeSchema,
    startedAt: IsoDateTimeSchema,
    attempt: z.number().int().min(1).default(1)
  }),
  z.object({
    kind: z.literal('step.succeeded'),
    runId: EntityIdSchema,
    stepId: EntityIdSchema,
    stepIndex: z.number().int().nonnegative(),
    finishedAt: IsoDateTimeSchema,
    durationMs: z.number().int().nonnegative(),
    resolvedLocator: LocatorSchema.optional()
  }),
  z.object({
    kind: z.literal('step.failed'),
    runId: EntityIdSchema,
    stepId: EntityIdSchema,
    stepIndex: z.number().int().nonnegative(),
    finishedAt: IsoDateTimeSchema,
    durationMs: z.number().int().nonnegative(),
    error: RunErrorSchema,
    screenshotPath: z.string().min(1).optional()
  }),
  z.object({
    kind: z.literal('step.retrying'),
    runId: EntityIdSchema,
    stepId: EntityIdSchema,
    stepIndex: z.number().int().nonnegative(),
    attempt: z.number().int().min(2),
    delayMs: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal('run.finished'),
    runId: EntityIdSchema,
    status: RunStatusSchema,
    finishedAt: IsoDateTimeSchema,
    error: RunErrorSchema.optional()
  })
]);

/** Compact summary of a run used in list endpoints. */
export const RunSummarySchema = z.object({
  id: EntityIdSchema,
  workflowId: EntityIdSchema,
  workflowVersion: z.number().int().positive(),
  status: RunStatusSchema,
  triggerSource: z.enum(['manual', 'schedule', 'repair']),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional()
});

/** Full run graph: the run row + per-step results + artifact rows. */
export const RunGraphSchema = z.object({
  run: RunSchema,
  steps: z.array(RunStepResultSchema),
  artifacts: z.array(ArtifactSchema)
});

/** Compact workflow summary used by list endpoints. */
export const WorkflowSummarySchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  enabled: z.boolean(),
  latestVersion: z.number().int().positive(),
  updatedAt: IsoDateTimeSchema,
  tags: z.array(z.string()).default([])
});

/** Runner status endpoint response shape. */
export const RunnerStatusResponseSchema = z.object({
  service: z.literal('runner'),
  version: z.string().min(1),
  active: z.array(EntityIdSchema),
  lastRun: RunSummarySchema.optional()
});

/** POST /recordings response shape. */
export const SaveRecordingResponseSchema = z.object({
  recordingId: EntityIdSchema,
  workflowId: EntityIdSchema,
  workflowVersion: z.number().int().positive()
});

/** POST /workflows/:id/run request and response shapes. */
export const StartRunRequestSchema = z.object({
  authProfileId: EntityIdSchema.optional(),
  debugMode: z.boolean().optional()
});

export const StartRunResponseSchema = z.object({
  runId: EntityIdSchema,
  status: RunStatusSchema
});

/** POST /runs/:id/cancel response. */
export const CancelRunResponseSchema = z.object({
  runId: EntityIdSchema,
  status: RunStatusSchema
});

/** GET /runs response. */
export const ListRunsResponseSchema = z.object({
  runs: z.array(RunSummarySchema)
});

/** GET /workflows response. */
export const ListWorkflowsResponseSchema = z.object({
  workflows: z.array(WorkflowSummarySchema)
});

/** POST /auth-profiles/:id/validate request and response. */
export const ValidateAuthProfileRequestSchema = z.object({
  probeUrl: z.string().url().optional(),
  probeSelector: z.string().min(1).optional()
});

export const ValidateAuthProfileResponseSchema = z.object({
  valid: z.boolean(),
  reason: z.string().min(1).optional()
});

/** PUT /workflows/:id request. */
export const UpdateWorkflowRequestSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  defaultAuthProfileId: EntityIdSchema.nullable().optional(),
  tags: z.array(z.string()).optional()
});

/** POST /workflows/:id/duplicate response. */
export const DuplicateWorkflowResponseSchema = z.object({
  workflowId: EntityIdSchema,
  workflowVersion: z.number().int().positive(),
  name: z.string().min(1)
});

/** POST /auth-profiles request. */
export const CreateAuthProfileRequestSchema = z.object({
  name: z.string().min(1),
  browserEngine: z.enum(['chromium']).default('chromium'),
  notes: z.string().optional()
});

/** POST /auth-profiles/:id/login-session response. */
export const LoginSessionResponseSchema = z.object({
  authProfileId: EntityIdSchema,
  status: z.enum(['ready', 'saved', 'failed']),
  message: z.string().optional()
});

/** GET /auth-profiles response. */
export const ListAuthProfilesResponseSchema = z.object({
  profiles: z.array(AuthProfileSchema.extend({
    status: AuthProfileStatusSchema
  }))
});

/** POST /schedules request. */
export const CreateScheduleRequestSchema = z.object({
  workflowId: EntityIdSchema,
  pattern: SchedulePatternSchema.default({ kind: 'daily' }),
  timezone: z.string().min(1),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  missedRunPolicy: MissedRunPolicySchema.default('skip'),
  authProfileId: EntityIdSchema.optional(),
  enabled: z.boolean().default(true)
});

/** PUT /workflows/:id/definition request — full workflow step editing. */
export const UpdateWorkflowDefinitionRequestSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  steps: z.array(WorkflowStepSchema).min(1).optional(),
  tags: z.array(z.string()).optional(),
  changeSummary: z.string().min(1).optional()
});

/** POST /workflows/:id/test-step request. */
export const TestStepRequestSchema = z.object({
  step: WorkflowStepSchema,
  authProfileId: EntityIdSchema.optional()
});

/** POST /workflows/:id/test-step response. */
export const TestStepResponseSchema = z.object({
  ok: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  resolvedLocator: LocatorSchema.optional(),
  error: RunErrorSchema.optional(),
  screenshotPath: z.string().optional()
});

/** POST /workflows/:id/run-from request — run starting at a specific step. */
export const RunFromStepRequestSchema = z.object({
  fromStepIndex: z.number().int().nonnegative(),
  authProfileId: EntityIdSchema.optional(),
  debugMode: z.boolean().optional()
});

/** Log redaction rules applied to structured logs before persistence. */
export const LOG_REDACTION_PATTERNS: readonly RegExp[] = [
  /(?<=password["\s:=]*)[^\s"',}{]+/gi,
  /(?<=secret["\s:=]*)[^\s"',}{]+/gi,
  /(?<=token["\s:=]*)[^\s"',}{]+/gi,
  /(?<=authorization["\s:=]*)\S+/gi,
  /(?<=cookie["\s:=]*)\S+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,
  /\b(?:\d[ -]*?){13,19}\b/g
];

/** Redact sensitive values in a string using the standard patterns. */
export function redactString(input: string): string {
  let result = input;
  for (const pattern of LOG_REDACTION_PATTERNS) {
    result = result.replace(pattern, '***REDACTED***');
  }
  return result;
}

/** Redact sensitive values in a JSON-serializable object. */
export function redactObject<T>(obj: T): T {
  if (typeof obj === 'string') return redactString(obj) as T;
  if (Array.isArray(obj)) return obj.map(redactObject) as T;
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/password|secret|token|cookie|authorization|credential/i.test(k)) {
        out[k] = '***REDACTED***';
      } else {
        out[k] = redactObject(v);
      }
    }
    return out as T;
  }
  return obj;
}

/** Diagnostics bundle export shape. */
export const DiagnosticsBundleSchema = z.object({
  exportedAt: IsoDateTimeSchema,
  environment: z.object({
    nodeVersion: z.string(),
    platform: z.string(),
    arch: z.string(),
    runnerVersion: z.string()
  }),
  workflow: WorkflowSchema.optional(),
  run: RunSchema.optional(),
  steps: z.array(RunStepResultSchema).optional(),
  artifacts: z.array(ArtifactSchema).optional(),
  logs: z.array(z.object({
    level: z.string(),
    time: z.number(),
    msg: z.string(),
    correlationId: z.string().optional()
  })).optional()
});

/** PUT /schedules/:id request. */
export const UpdateScheduleRequestSchema = z.object({
  pattern: SchedulePatternSchema.optional(),
  timezone: z.string().min(1).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  missedRunPolicy: MissedRunPolicySchema.optional(),
  authProfileId: EntityIdSchema.nullable().optional(),
  enabled: z.boolean().optional()
});

/** GET /schedules response. */
export const ListSchedulesResponseSchema = z.object({
  schedules: z.array(ScheduleSchema)
});

/** Parses a workflow JSON object, applying compatible migrations when needed. */
export function normalizeWorkflowImport(input: unknown): Workflow {
  const candidate = z
    .object({
      schemaVersion: z.number().int().positive().optional()
    })
    .passthrough()
    .parse(input);

  const schemaVersion = candidate.schemaVersion ?? WORKFLOW_SCHEMA_VERSION;

  if (schemaVersion > WORKFLOW_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported workflow schema version ${schemaVersion}. Expected ${WORKFLOW_SCHEMA_VERSION} or lower.`
    );
  }

  switch (schemaVersion) {
    case 1:
      return WorkflowSchema.parse({
        ...candidate,
        schemaVersion: WORKFLOW_SCHEMA_VERSION
      });
    default:
      throw new Error(`No migration path exists for schema version ${schemaVersion}.`);
  }
}

/** Imports and validates workflow JSON for persistence or execution. */
export function importWorkflowFromJson(source: string): Workflow {
  return normalizeWorkflowImport(JSON.parse(source) as unknown);
}

/** Exports workflow JSON in the current canonical schema version. */
export function exportWorkflowToJson(workflow: Workflow): string {
  const normalized = WorkflowSchema.parse({
    ...workflow,
    schemaVersion: WORKFLOW_SCHEMA_VERSION
  });

  return JSON.stringify(normalized, null, 2) + '\n';
}

/** Creates the workflow row stored alongside workflow revisions in SQLite. */
export function createWorkflowRecord(workflow: Workflow): WorkflowRecord {
  return WorkflowRecordSchema.parse({
    id: workflow.workflowId,
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    trigger: workflow.trigger,
    defaultAuthProfileId: workflow.defaultAuthProfileId,
    latestVersion: workflow.workflowVersion,
    schemaVersion: workflow.schemaVersion,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    tags: workflow.tags
  });
}

/** Creates an immutable workflow revision record around a workflow definition. */
export function createWorkflowVersion(
  workflow: Workflow,
  options: {
    id?: string;
    createdAt?: string;
    changeSummary?: string;
    createdBy?: 'user' | 'system';
    sourceRecordingId?: string;
  } = {}
): WorkflowVersion {
  return WorkflowVersionSchema.parse({
    id:
      options.id ??
      `${workflow.workflowId}_v${workflow.workflowVersion.toString(10)}`,
    workflowId: workflow.workflowId,
    version: workflow.workflowVersion,
    schemaVersion: workflow.schemaVersion,
    definition: workflow,
    createdAt: options.createdAt ?? workflow.updatedAt,
    changeSummary: options.changeSummary,
    createdBy: options.createdBy ?? 'system',
    sourceRecordingId: options.sourceRecordingId
  });
}

/** Concrete sample workflow used by docs, tests, and seed utilities. */
export const SampleWorkflow = WorkflowSchema.parse({
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  workflowVersion: 1,
  workflowId: 'wf_morning_setup',
  name: 'Morning browser setup',
  description: 'Open core tools, load the dashboard, and verify the page is ready.',
  enabled: true,
  trigger: {
    type: 'manual'
  },
  defaultAuthProfileId: 'profile_work',
  createdAt: '2026-03-09T12:00:00.000Z',
  updatedAt: '2026-03-09T12:00:00.000Z',
  tags: ['sample', 'morning'],
  metadata: {
    owner: 'local-user'
  },
  steps: [
    {
      id: 'step_new_tab',
      type: 'newTab',
      initialUrl: 'https://app.example.com/dashboard',
      timeoutMs: 10_000,
      retryPolicy: DEFAULT_RETRY_POLICY,
      debug: {
        ...createDefaultDebugMetadata(),
        notes: ['Create a fresh tab for the daily dashboard.']
      }
    },
    {
      id: 'step_goto_dashboard',
      type: 'goto',
      url: 'https://app.example.com/dashboard',
      waitUntil: 'load',
      timeoutMs: 30_000,
      retryPolicy: DEFAULT_RETRY_POLICY,
      debug: {
        ...createDefaultDebugMetadata(),
        notes: ['Prefer direct navigation over replaying intermediary search steps.']
      }
    },
    {
      id: 'step_open_filters',
      type: 'click',
      primaryLocator: {
        kind: 'role',
        role: 'button',
        name: 'Filters'
      },
      fallbackLocators: [
        {
          kind: 'text',
          text: 'Filters',
          exact: true
        },
        {
          kind: 'css',
          selector: "[data-testid='filters-button']"
        }
      ],
      timeoutMs: 20_000,
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 250,
        strategy: 'fixed'
      },
      debug: {
        ...createDefaultDebugMetadata(),
        notes: ['Menu opens the morning filter panel.'],
        confidence: 0.94
      },
      button: 'left',
      clickCount: 1
    },
    {
      id: 'step_wait_dashboard_ready',
      type: 'waitFor',
      primaryLocator: {
        kind: 'testId',
        testId: 'dashboard-ready'
      },
      fallbackLocators: [
        {
          kind: 'css',
          selector: "[data-state='ready']"
        }
      ],
      timeoutMs: 30_000,
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 500,
        strategy: 'fixed'
      },
      debug: {
        ...createDefaultDebugMetadata(),
        notes: ['Wait until the dashboard reports a ready state.']
      },
      condition: 'visible'
    },
    {
      id: 'step_assert_header',
      type: 'assert',
      primaryLocator: {
        kind: 'role',
        role: 'heading',
        name: 'Operations Dashboard'
      },
      fallbackLocators: [
        {
          kind: 'text',
          text: 'Operations Dashboard',
          exact: true
        }
      ],
      timeoutMs: 15_000,
      retryPolicy: DEFAULT_RETRY_POLICY,
      debug: {
        ...createDefaultDebugMetadata(),
        notes: ['Final guard that the expected dashboard is visible.']
      },
      assertion: {
        kind: 'visible'
      }
    }
  ]
});

export const RecordingEventSchema = RawRecordedEventSchema;

export type Locator = z.infer<typeof LocatorSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;
export type DebugMetadata = z.infer<typeof DebugMetadataSchema>;
export type WorkflowInput = z.input<typeof WorkflowSchema>;
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowRecord = z.infer<typeof WorkflowRecordSchema>;
export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;
export type RawRecordedEventInput = z.input<typeof RawRecordedEventSchema>;
export type RawRecordedEvent = z.infer<typeof RawRecordedEventSchema>;
export type RecordingEvent = z.infer<typeof RecordingEventSchema>;
export type RecordingSessionInput = z.input<typeof RecordingSessionSchema>;
export type RecordingSession = z.infer<typeof RecordingSessionSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunStepResult = z.infer<typeof RunStepResultSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type AuthProfile = z.infer<typeof AuthProfileSchema>;
export type Setting = z.infer<typeof SettingSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ElementSnapshot = z.infer<typeof ElementSnapshotSchema>;
export type BoundingRect = z.infer<typeof BoundingRectSchema>;
export type RunError = z.infer<typeof RunErrorSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type RunGraph = z.infer<typeof RunGraphSchema>;
export type WorkflowSummary = z.infer<typeof WorkflowSummarySchema>;
export type RunnerStatusResponse = z.infer<typeof RunnerStatusResponseSchema>;
export type SaveRecordingResponse = z.infer<typeof SaveRecordingResponseSchema>;
export type StartRunRequest = z.infer<typeof StartRunRequestSchema>;
export type StartRunResponse = z.infer<typeof StartRunResponseSchema>;
export type CancelRunResponse = z.infer<typeof CancelRunResponseSchema>;
export type ListRunsResponse = z.infer<typeof ListRunsResponseSchema>;
export type ListWorkflowsResponse = z.infer<typeof ListWorkflowsResponseSchema>;
export type ValidateAuthProfileRequest = z.infer<typeof ValidateAuthProfileRequestSchema>;
export type ValidateAuthProfileResponse = z.infer<typeof ValidateAuthProfileResponseSchema>;
export type SchedulePattern = z.infer<typeof SchedulePatternSchema>;
export type MissedRunPolicy = z.infer<typeof MissedRunPolicySchema>;
export type AuthProfileStatus = z.infer<typeof AuthProfileStatusSchema>;
export type UpdateWorkflowRequest = z.infer<typeof UpdateWorkflowRequestSchema>;
export type UpdateWorkflowDefinitionRequest = z.infer<typeof UpdateWorkflowDefinitionRequestSchema>;
export type TestStepRequest = z.infer<typeof TestStepRequestSchema>;
export type TestStepResponse = z.infer<typeof TestStepResponseSchema>;
export type RunFromStepRequest = z.infer<typeof RunFromStepRequestSchema>;
export type FailureCode = z.infer<typeof FailureCodeSchema>;
export type RepairRecord = z.infer<typeof RepairRecordSchema>;
export type DiagnosticsBundle = z.infer<typeof DiagnosticsBundleSchema>;
export type DuplicateWorkflowResponse = z.infer<typeof DuplicateWorkflowResponseSchema>;
export type CreateAuthProfileRequest = z.infer<typeof CreateAuthProfileRequestSchema>;
export type LoginSessionResponse = z.infer<typeof LoginSessionResponseSchema>;
export type CreateScheduleRequest = z.infer<typeof CreateScheduleRequestSchema>;
export type UpdateScheduleRequest = z.infer<typeof UpdateScheduleRequestSchema>;
