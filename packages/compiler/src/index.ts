import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_STEP_TIMEOUT_MS,
  RecordingSessionSchema,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowSchema,
  createDefaultDebugMetadata,
  type DebugMetadata,
  type Locator,
  type RawRecordedEvent,
  type RecordingSessionInput,
  type Target,
  type Workflow,
  type WorkflowStep
} from '@waypoint/shared-types';

export interface CompileWorkflowOptions {
  name?: string;
  workflowId?: string;
  workflowVersion?: number;
  createdAt?: string;
}

const ACCIDENTAL_DOUBLE_CLICK_WINDOW_MS = 400;

const LOCATOR_SCORE: Record<Locator['kind'], number> = {
  role: 100,
  testId: 90,
  label: 80,
  placeholder: 75,
  text: 70,
  css: 50,
  xpath: 20,
  coordinates: 10
};

const SEMANTIC_KINDS = new Set<Locator['kind']>([
  'role',
  'testId',
  'label',
  'placeholder',
  'text'
]);

interface RankedLocators {
  primary: Locator;
  fallbacks: Locator[];
  confidence: number;
  lowConfidence: boolean;
}

function rankTargetLocators(target: Target): RankedLocators {
  const all = [target.primaryLocator, ...target.fallbackLocators];
  const sorted = [...all].sort(
    (a, b) => LOCATOR_SCORE[b.kind] - LOCATOR_SCORE[a.kind]
  );
  const primary = sorted[0]!;
  const fallbacks = sorted.slice(1);
  const hasSemantic = sorted.some((l) => SEMANTIC_KINDS.has(l.kind));

  let confidence: number;
  switch (primary.kind) {
    case 'role':
    case 'testId':
      confidence = 0.95;
      break;
    case 'label':
    case 'placeholder':
    case 'text':
      confidence = 0.85;
      break;
    case 'css':
      confidence = hasSemantic ? 0.75 : 0.55;
      break;
    case 'xpath':
      confidence = hasSemantic ? 0.55 : 0.4;
      break;
    case 'coordinates':
    default:
      confidence = 0.3;
  }

  return {
    primary,
    fallbacks,
    confidence,
    lowConfidence: confidence < 0.6
  };
}

function targetKey(target: Target): string {
  return (
    JSON.stringify(target.primaryLocator) +
    '|' +
    JSON.stringify(target.framePath ?? null)
  );
}

/** Drop noise events that should not influence step compilation. */
function preFilter(events: RawRecordedEvent[]): RawRecordedEvent[] {
  return events.filter((e) => {
    if (e.type === 'focus' || e.type === 'blur') return false;
    if (e.type === 'tabActivated') return false;
    if (e.type === 'historyChange') return false;
    if (e.type === 'input' && e.redacted) return false;
    return true;
  });
}

/** Collapse consecutive same-target inputs and accidental double-clicks. */
function mergeEvents(events: RawRecordedEvent[]): RawRecordedEvent[] {
  const out: RawRecordedEvent[] = [];

  for (const event of events) {
    const last = out[out.length - 1];

    if (
      event.type === 'input' &&
      last &&
      last.type === 'input' &&
      targetKey(last.target) === targetKey(event.target)
    ) {
      out[out.length - 1] = {
        ...last,
        value: event.value,
        atMs: event.atMs,
        debug: {
          ...last.debug,
          sourceEventIds: [
            ...(last.debug?.sourceEventIds ?? []),
            event.eventId
          ],
          notes: [
            ...(last.debug?.notes ?? []),
            'merged-consecutive-input'
          ]
        }
      };
      continue;
    }

    if (
      event.type === 'click' &&
      last &&
      last.type === 'click' &&
      targetKey(last.target) === targetKey(event.target) &&
      last.button === event.button &&
      event.atMs - last.atMs < ACCIDENTAL_DOUBLE_CLICK_WINDOW_MS
    ) {
      out[out.length - 1] = {
        ...last,
        debug: {
          ...last.debug,
          sourceEventIds: [
            ...(last.debug?.sourceEventIds ?? []),
            event.eventId
          ],
          notes: [
            ...(last.debug?.notes ?? []),
            'merged-accidental-double-click'
          ]
        }
      };
      continue;
    }

    out.push(event);
  }

  return out;
}

/** Promote `click(link) + navigate(href)` into a single goto. */
function promoteEvents(events: RawRecordedEvent[]): RawRecordedEvent[] {
  const out: RawRecordedEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const next = events[i + 1];

    if (
      event.type === 'click' &&
      next &&
      next.type === 'navigate' &&
      event.element
    ) {
      const tag = event.element.tagName?.toLowerCase();
      const href = event.element.attributes?.href;
      if (tag === 'a' && href && href === next.url) {
        out.push({
          ...next,
          debug: {
            ...next.debug,
            sourceEventIds: [
              ...(next.debug?.sourceEventIds ?? []),
              event.eventId
            ],
            notes: [
              ...(next.debug?.notes ?? []),
              'promoted-from-link-click'
            ]
          }
        });
        i++;
        continue;
      }
    }

    out.push(event);
  }

  return out;
}

function buildDebug(
  event: RawRecordedEvent,
  ranked?: RankedLocators
): DebugMetadata {
  const base = createDefaultDebugMetadata();
  return {
    ...base,
    sourceEventIds: [event.eventId, ...(event.debug?.sourceEventIds ?? [])],
    notes: [...(event.debug?.notes ?? [])],
    tags: ranked?.lowConfidence ? ['low-confidence'] : [],
    rawEventType: event.type,
    sourceUrl: event.pageUrl,
    confidence: ranked?.confidence,
    extra: {}
  };
}

function compileEventToSteps(
  event: RawRecordedEvent,
  nextId: () => string
): WorkflowStep[] {
  switch (event.type) {
    case 'tabOpened':
      return [
        {
          id: nextId(),
          type: 'newTab',
          enabled: true,
          timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
          retryPolicy: DEFAULT_RETRY_POLICY,
          debug: buildDebug(event),
          tabAlias: event.tabId,
          initialUrl: event.initialUrl
        }
      ];

    case 'tabClosed':
      return [
        {
          id: nextId(),
          type: 'closeTab',
          enabled: true,
          timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
          retryPolicy: DEFAULT_RETRY_POLICY,
          debug: buildDebug(event),
          tabAlias: event.tabId
        }
      ];

    case 'navigate':
      return [
        {
          id: nextId(),
          type: 'goto',
          enabled: true,
          url: event.url,
          waitUntil: 'load',
          timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
          retryPolicy: DEFAULT_RETRY_POLICY,
          debug: buildDebug(event),
          tabAlias: event.tabId
        }
      ];

    case 'click': {
      const ranked = rankTargetLocators(event.target);
      return [
        {
          id: nextId(),
          type: 'click',
          enabled: true,
          primaryLocator: ranked.primary,
          fallbackLocators: ranked.fallbacks,
          framePath: event.target.framePath,
          timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
          retryPolicy: DEFAULT_RETRY_POLICY,
          debug: buildDebug(event, ranked),
          button: event.button,
          clickCount: 1,
          tabAlias: event.tabId
        }
      ];
    }

    case 'input': {
      const ranked = rankTargetLocators(event.target);
      return [
        {
          id: nextId(),
          type: 'type',
          enabled: true,
          primaryLocator: ranked.primary,
          fallbackLocators: ranked.fallbacks,
          framePath: event.target.framePath,
          timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
          retryPolicy: DEFAULT_RETRY_POLICY,
          debug: buildDebug(event, ranked),
          value: event.value,
          clearBefore: true,
          sensitive: false,
          tabAlias: event.tabId
        }
      ];
    }

    case 'select': {
      const ranked = rankTargetLocators(event.target);
      return [
        {
          id: nextId(),
          type: 'select',
          enabled: true,
          primaryLocator: ranked.primary,
          fallbackLocators: ranked.fallbacks,
          framePath: event.target.framePath,
          timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
          retryPolicy: DEFAULT_RETRY_POLICY,
          debug: buildDebug(event, ranked),
          option: event.option,
          tabAlias: event.tabId
        }
      ];
    }

    case 'submit': {
      const ranked = rankTargetLocators(event.target);
      return [
        {
          id: nextId(),
          type: 'press',
          enabled: true,
          primaryLocator: ranked.primary,
          fallbackLocators: ranked.fallbacks,
          framePath: event.target.framePath,
          timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
          retryPolicy: DEFAULT_RETRY_POLICY,
          debug: {
            ...buildDebug(event, ranked),
            notes: ['compiled-from-submit']
          },
          key: 'Enter',
          modifiers: [],
          tabAlias: event.tabId
        }
      ];
    }

    case 'press': {
      if (!event.target) return [];
      const ranked = rankTargetLocators(event.target);
      return [
        {
          id: nextId(),
          type: 'press',
          enabled: true,
          primaryLocator: ranked.primary,
          fallbackLocators: ranked.fallbacks,
          framePath: event.target.framePath,
          timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
          retryPolicy: DEFAULT_RETRY_POLICY,
          debug: buildDebug(event, ranked),
          key: event.key,
          modifiers: event.modifiers,
          tabAlias: event.tabId
        }
      ];
    }

    case 'waitFor': {
      if (!event.target) return [];
      const ranked = rankTargetLocators(event.target);
      return [
        {
          id: nextId(),
          type: 'waitFor',
          enabled: true,
          primaryLocator: ranked.primary,
          fallbackLocators: ranked.fallbacks,
          framePath: event.target.framePath,
          timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
          retryPolicy: DEFAULT_RETRY_POLICY,
          debug: buildDebug(event, ranked),
          condition: event.condition,
          tabAlias: event.tabId
        }
      ];
    }

    case 'assert': {
      if (!event.target) return [];
      const ranked = rankTargetLocators(event.target);
      return [
        {
          id: nextId(),
          type: 'assert',
          enabled: true,
          primaryLocator: ranked.primary,
          fallbackLocators: ranked.fallbacks,
          framePath: event.target.framePath,
          timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
          retryPolicy: DEFAULT_RETRY_POLICY,
          debug: buildDebug(event, ranked),
          assertion: event.assertion,
          tabAlias: event.tabId
        }
      ];
    }

    case 'focus':
    case 'blur':
    case 'historyChange':
    case 'tabActivated':
      return [];
  }
}

/** Steps that carry their own locator/target. */
function getStepTarget(step: WorkflowStep): Target | null {
  if (
    step.type === 'click' ||
    step.type === 'type' ||
    step.type === 'select' ||
    step.type === 'press' ||
    step.type === 'waitFor' ||
    step.type === 'assert'
  ) {
    if (!('primaryLocator' in step) || !step.primaryLocator) return null;
    return {
      primaryLocator: step.primaryLocator,
      fallbackLocators: step.fallbackLocators ?? [],
      framePath: step.framePath
    };
  }
  return null;
}

/**
 * Insert `waitFor` steps between a click/goto and a follow-up interactive step
 * so the runner waits for the next target to appear before acting on it.
 */
function insertPostconditions(
  steps: WorkflowStep[],
  nextId: () => string
): WorkflowStep[] {
  const out: WorkflowStep[] = [];

  for (const step of steps) {
    const prev = out[out.length - 1];
    if (
      prev &&
      (prev.type === 'click' || prev.type === 'goto') &&
      step.type !== 'waitFor'
    ) {
      const target = getStepTarget(step);
      if (target) {
        const ranked = rankTargetLocators(target);
        const waitForStep: WorkflowStep = {
          id: nextId(),
          type: 'waitFor',
          enabled: true,
          primaryLocator: ranked.primary,
          fallbackLocators: ranked.fallbacks,
          framePath: target.framePath,
          timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
          retryPolicy: DEFAULT_RETRY_POLICY,
          debug: {
            ...createDefaultDebugMetadata(),
            sourceEventIds: [
              ...(prev.debug?.sourceEventIds ?? []),
              ...(step.debug?.sourceEventIds ?? [])
            ],
            notes: ['inferred-postcondition'],
            tags: ranked.lowConfidence ? ['low-confidence'] : [],
            confidence: ranked.confidence,
            extra: {}
          },
          condition: 'visible',
          tabAlias: step.tabAlias
        };
        out.push(waitForStep);
      }
    }
    out.push(step);
  }

  return out;
}

/**
 * Compiles a raw recording session into the persisted workflow DSL via a
 * deterministic pipeline:
 * pre-filter → merge → promote → compile → insert postconditions.
 */
export function compileRecording(
  input: RecordingSessionInput,
  options: CompileWorkflowOptions = {}
): Workflow {
  const recording = RecordingSessionSchema.parse(input);

  const filtered = preFilter(recording.events);
  const merged = mergeEvents(filtered);
  const promoted = promoteEvents(merged);

  let counter = 0;
  const nextId = () => `step_${++counter}`;

  const compiledSteps: WorkflowStep[] = [];
  for (const event of promoted) {
    compiledSteps.push(...compileEventToSteps(event, nextId));
  }

  const withPostconditions = insertPostconditions(compiledSteps, nextId);

  const createdAt = options.createdAt ?? recording.startedAt;

  return WorkflowSchema.parse({
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    workflowVersion: options.workflowVersion ?? 1,
    workflowId: options.workflowId ?? recording.recordingId,
    name: options.name ?? recording.name,
    enabled: true,
    trigger: { type: 'manual' },
    createdAt,
    updatedAt: createdAt,
    tags: [],
    metadata: {
      recordingId: recording.recordingId
    },
    steps:
      withPostconditions.length > 0
        ? withPostconditions
        : // Schema requires at least one step. If a recording produced no
          // executable steps (e.g. only redacted inputs), emit a no-op assert
          // so the workflow remains importable.
          ([
            {
              id: 'step_noop',
              type: 'assert',
              enabled: true,
              primaryLocator: { kind: 'css', selector: 'body' },
              fallbackLocators: [],
              timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
              retryPolicy: DEFAULT_RETRY_POLICY,
              debug: {
                ...createDefaultDebugMetadata(),
                notes: ['empty-recording-noop']
              },
              assertion: { kind: 'visible' }
            }
          ] as WorkflowStep[])
  });
}
