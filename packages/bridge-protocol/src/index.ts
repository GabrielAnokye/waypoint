import { z } from 'zod';

import {
  HealthResponseSchema,
  RecordingSessionSchema,
  RunGraphSchema,
  RunSummarySchema,
  WorkflowSummarySchema
} from '@waypoint/shared-types';

// ---- Protocol constants ----

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 1_048_576; // 1 MB (Chrome's limit)

// ---- Error codes ----

export const BridgeErrorCodeSchema = z.enum([
  'bad_request',
  'unknown_command',
  'runner_unreachable',
  'timeout',
  'not_found',
  'internal',
  'version_mismatch',
  'host_not_running'
]);

export type BridgeErrorCode = z.infer<typeof BridgeErrorCodeSchema>;

// ---- Envelope schemas ----

export const BridgeRequestSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  payload: z.unknown().default({}),
  deadlineMs: z.number().int().positive().optional()
});

export type BridgeRequest = z.infer<typeof BridgeRequestSchema>;

export const BridgeResponseOkSchema = z.object({
  id: z.string().min(1),
  ok: z.literal(true),
  result: z.unknown()
});

export const BridgeResponseErrorSchema = z.object({
  id: z.string().min(1),
  ok: z.literal(false),
  error: z.object({
    code: BridgeErrorCodeSchema,
    message: z.string().min(1),
    details: z.unknown().optional()
  })
});

export const BridgeResponseSchema = z.discriminatedUnion('ok', [
  BridgeResponseOkSchema,
  BridgeResponseErrorSchema
]);

export type BridgeResponse = z.infer<typeof BridgeResponseSchema>;

export const BridgeEventSchema = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(['log', 'progress', 'runEvent']),
  payload: z.unknown()
});

export type BridgeEvent = z.infer<typeof BridgeEventSchema>;

// ---- Command payload schemas ----

export const PingResultSchema = z.object({
  pong: z.literal(true),
  hostVersion: z.string().min(1),
  protocolVersion: z.number().int().positive()
});

export const GetHealthResultSchema = HealthResponseSchema;

export const RunWorkflowPayloadSchema = z.object({
  workflowId: z.string().min(1),
  authProfileId: z.string().min(1).optional(),
  debugMode: z.boolean().optional()
});

export const RunWorkflowResultSchema = z.object({
  runId: z.string().min(1)
});

export const CancelRunPayloadSchema = z.object({
  runId: z.string().min(1)
});

export const CancelRunResultSchema = z.object({
  runId: z.string().min(1),
  status: z.literal('cancelling')
});

export const ListRunsPayloadSchema = z.object({
  workflowId: z.string().min(1).optional(),
  limit: z.number().int().positive().optional()
});

export const ListRunsResultSchema = z.object({
  runs: z.array(RunSummarySchema)
});

export const GetRunDetailsPayloadSchema = z.object({
  runId: z.string().min(1)
});

export const GetRunDetailsResultSchema = RunGraphSchema;

export const CreateAuthProfilePayloadSchema = z.object({
  name: z.string().min(1),
  browserEngine: z.literal('chromium').default('chromium'),
  interactive: z.boolean().default(false)
});

export const CreateAuthProfileResultSchema = z.object({
  authProfileId: z.string().min(1)
});

export const ValidateAuthProfilePayloadSchema = z.object({
  authProfileId: z.string().min(1),
  probeUrl: z.string().url().optional(),
  probeSelector: z.string().min(1).optional()
});

export const ValidateAuthProfileResultSchema = z.object({
  valid: z.boolean(),
  reason: z.string().min(1).optional()
});

export const SaveWorkflowPayloadSchema = z.object({
  recording: RecordingSessionSchema,
  name: z.string().min(1).optional()
});

export const SaveWorkflowResultSchema = z.object({
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive()
});

export const ListWorkflowsResultSchema = z.object({
  workflows: z.array(WorkflowSummarySchema)
});

// ---- Command map (for typed dispatch) ----

export const BRIDGE_COMMANDS = [
  'ping',
  'getHealth',
  'runWorkflow',
  'cancelRun',
  'listRuns',
  'getRunDetails',
  'createAuthProfile',
  'validateAuthProfile',
  'saveWorkflow',
  'listWorkflows'
] as const;

export type BridgeCommandName = (typeof BRIDGE_COMMANDS)[number];
