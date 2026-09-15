import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

import { compileRecording } from '@waypoint/compiler';
import {
  openWaypointDatabase,
  type WaypointRepository
} from '@waypoint/db';
import { createRuntimePaths } from '@waypoint/db/runtime-paths';
import { createLogger } from '@waypoint/logger';
import {
  CreateAuthProfileRequestSchema,
  CreateScheduleRequestSchema,
  HealthResponseSchema,
  RecordingSessionSchema,
  RunFromStepRequestSchema,
  StartRunRequestSchema,
  TestStepRequestSchema,
  UpdateScheduleRequestSchema,
  UpdateWorkflowDefinitionRequestSchema,
  UpdateWorkflowRequestSchema,
  ValidateAuthProfileRequestSchema,
  redactObject,
  type AuthProfileStatus,
  type HealthResponse,
  type RunSummary,
  type Schedule,
  type Workflow
} from '@waypoint/shared-types';

import {
  executeWorkflow,
  noopBrowserLauncher,
  type BrowserLauncher
} from './core/executor.js';
import { buildRunGraph } from './core/persist.js';
import { RunRegistry } from './core/run-registry.js';
import type { RunnerEnv } from './env.js';

export interface RunnerServer {
  app: FastifyInstance;
  runtimePaths: ReturnType<typeof createRuntimePaths>;
  repository: WaypointRepository;
  registry: RunRegistry;
}

export interface RunnerOverrides {
  repository?: WaypointRepository;
  browserLauncher?: BrowserLauncher;
}

const RUNNER_VERSION = '0.1.0';

/**
 * Builds the Fastify runner instance used by dev, test, and production entrypoints.
 */
export function buildRunnerServer(
  env: RunnerEnv,
  overrides: RunnerOverrides = {}
): RunnerServer {
  const logger = createLogger({
    level: env.LOG_LEVEL,
    name: 'waypoint-runner'
  });
  const runtimePaths = createRuntimePaths();
  const app = Fastify({ logger: false });

  const repository =
    overrides.repository ?? openWaypointDatabase(':memory:').repository;
  const launcher = overrides.browserLauncher ?? noopBrowserLauncher;
  const registry = new RunRegistry();

  // Track the most recently completed run for /status.
  let lastRun: RunSummary | undefined;

  app.get('/health', async (): Promise<HealthResponse> =>
    HealthResponseSchema.parse({
      status: 'ok',
      service: 'runner',
      version: RUNNER_VERSION,
      uptimeSeconds: process.uptime()
    })
  );

  app.get('/status', async () => ({
    service: 'runner' as const,
    version: RUNNER_VERSION,
    active: registry.activeRunIds(),
    lastRun
  }));

  app.get('/config', async () => ({
    host: env.RUNNER_HOST,
    port: env.RUNNER_PORT,
    runtimePaths
  }));

  app.get('/compiler-sample', async () => {
    const workflow = compileRecording({
      recordingId: 'sample_morning_setup',
      name: 'Morning setup',
      startedAt: '2026-03-09T10:00:00.000Z',
      events: [
        {
          eventId: 'evt_1',
          type: 'navigate',
          atMs: 0,
          tabId: 'tab_main',
          url: 'https://example.com'
        }
      ]
    });

    return { workflow };
  });

  app.post('/recordings', async (request, reply) => {
    const parsed = RecordingSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const workflow = compileRecording(parsed.data);
    const version = repository.saveWorkflowDefinition(workflow, {
      sourceRecordingId: parsed.data.recordingId
    });
    return {
      recordingId: parsed.data.recordingId,
      workflowId: version.workflowId,
      workflowVersion: version.version
    };
  });

  app.get('/workflows', async () => ({
    workflows: repository.listWorkflows().map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      enabled: w.enabled,
      latestVersion: w.latestVersion,
      updatedAt: w.updatedAt,
      tags: w.tags
    }))
  }));

  app.post('/workflows/:workflowId/run', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const parsed = StartRunRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const workflow: Workflow | null =
      repository.getLatestWorkflowDefinition(workflowId);
    if (!workflow) {
      return reply.code(404).send({ error: 'workflow_not_found' });
    }
    const versionRows = repository.listWorkflowVersions(workflowId);
    const latest = versionRows[0];
    if (!latest) {
      return reply.code(404).send({ error: 'workflow_version_not_found' });
    }

    const runId = `run_${randomUUID()}`;
    const entry = registry.register({
      runId,
      workflowId,
      status: 'running',
      startedAt: new Date().toISOString()
    });

    // Fire and forget — caller polls /runs/:id for completion.
    void (async () => {
      try {
        const events = executeWorkflow(workflow, {
          runId,
          ...(parsed.data.authProfileId !== undefined && {
            authProfileId: parsed.data.authProfileId
          }),
          ...(parsed.data.debugMode !== undefined && {
            debugMode: parsed.data.debugMode
          }),
          signal: entry.abort.signal,
          launcher
        });
        const graph = await buildRunGraph(workflow, events, {
          workflowVersionId: latest.id,
          ...(parsed.data.authProfileId !== undefined && {
            authProfileId: parsed.data.authProfileId
          })
        });
        repository.saveRunGraph(graph);
        registry.setStatus(runId, graph.run.status);
        lastRun = {
          id: graph.run.id,
          workflowId: graph.run.workflowId,
          workflowVersion: graph.run.workflowVersion,
          status: graph.run.status,
          triggerSource: graph.run.triggerSource,
          startedAt: graph.run.startedAt,
          finishedAt: graph.run.finishedAt,
          errorCode: graph.run.errorCode,
          errorMessage: graph.run.errorMessage
        };
      } catch (err) {
        logger.error({ err, runId }, 'run execution crashed');
        registry.setStatus(runId, 'failed');
      } finally {
        // Keep the entry for status visibility — purge after a short delay.
        setTimeout(() => registry.remove(runId), 60_000).unref?.();
      }
    })();

    return reply.send({ runId, status: 'running' as const });
  });

  app.post('/runs/:runId/cancel', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const ok = registry.cancel(runId);
    if (!ok) return reply.code(404).send({ error: 'run_not_found' });
    return { runId, status: 'canceled' as const };
  });

  app.get('/runs', async (request) => {
    const { workflowId } = (request.query ?? {}) as { workflowId?: string };
    const toSummary = (r: RunSummary) => ({
      id: r.id,
      workflowId: r.workflowId,
      workflowVersion: r.workflowVersion,
      status: r.status,
      triggerSource: r.triggerSource,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage
    });

    if (!workflowId) {
      return { runs: repository.listRuns().map(toSummary) };
    }
    return {
      runs: repository.listRunsForWorkflow(workflowId).map(toSummary)
    };
  });

  app.get('/runs/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const graph = repository.getRunGraph(runId);
    if (!graph) return reply.code(404).send({ error: 'run_not_found' });
    return graph;
  });

  // ---- Workflow CRUD ----

  app.put('/workflows/:workflowId', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const parsed = UpdateWorkflowRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const updated = repository.updateWorkflow(workflowId, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'workflow_not_found' });
    return updated;
  });

  app.delete('/workflows/:workflowId', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const deleted = repository.deleteWorkflow(workflowId);
    if (!deleted) return reply.code(404).send({ error: 'workflow_not_found' });
    return { ok: true };
  });

  app.post('/workflows/:workflowId/duplicate', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const workflow = repository.getLatestWorkflowDefinition(workflowId);
    if (!workflow) return reply.code(404).send({ error: 'workflow_not_found' });

    const newId = `wf_${randomUUID()}`;
    const duplicated: Workflow = {
      ...workflow,
      workflowId: newId,
      name: `${workflow.name} (copy)`,
      workflowVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const version = repository.saveWorkflowDefinition(duplicated, {
      changeSummary: `Duplicated from ${workflowId}`
    });
    return {
      workflowId: newId,
      workflowVersion: version.version,
      name: duplicated.name
    };
  });

  // ---- Workflow definition editing ----

  app.put('/workflows/:workflowId/definition', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const parsed = UpdateWorkflowDefinitionRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const existing = repository.getLatestWorkflowDefinition(workflowId);
    if (!existing) return reply.code(404).send({ error: 'workflow_not_found' });

    const updated: Workflow = {
      ...existing,
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description || undefined }),
      ...(parsed.data.steps !== undefined && { steps: parsed.data.steps }),
      ...(parsed.data.tags !== undefined && { tags: parsed.data.tags }),
      workflowVersion: existing.workflowVersion + 1,
      updatedAt: new Date().toISOString()
    };
    const version = repository.saveWorkflowDefinition(updated, {
      changeSummary: parsed.data.changeSummary ?? 'Edited via workflow editor'
    });

    // Also update the workflow record metadata
    repository.updateWorkflow(workflowId, {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.tags !== undefined && { tags: parsed.data.tags })
    });

    return {
      workflowId,
      workflowVersion: version.version,
      workflow: updated
    };
  });

  app.get('/workflows/:workflowId/definition', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const workflow = repository.getLatestWorkflowDefinition(workflowId);
    if (!workflow) return reply.code(404).send({ error: 'workflow_not_found' });
    return { workflow };
  });

  app.post('/workflows/:workflowId/splice', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const body = request.body as { fromStepIndex?: number; recording?: unknown } | null;
    if (!body || typeof body.fromStepIndex !== 'number' || !body.recording) {
      return reply.code(400).send({ error: 'fromStepIndex (number) and recording (object) are required.' });
    }
    const { fromStepIndex } = body;

    const existing = repository.getLatestWorkflowDefinition(workflowId);
    if (!existing) return reply.code(404).send({ error: 'workflow_not_found' });

    if (fromStepIndex < 0 || fromStepIndex > existing.steps.length) {
      return reply.code(400).send({ error: 'fromStepIndex out of range.' });
    }

    const parsed = RecordingSessionSchema.safeParse(body.recording);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    // Compile the new recording into a temporary workflow to extract its steps
    const compiled = compileRecording(parsed.data);

    // Splice: keep steps 0..fromStepIndex-1, then append all compiled steps
    const keptSteps = existing.steps.slice(0, fromStepIndex);
    const splicedSteps = [...keptSteps, ...compiled.steps];
    const stepsReplaced = existing.steps.length - fromStepIndex;

    const updated: Workflow = {
      ...existing,
      steps: splicedSteps,
      workflowVersion: existing.workflowVersion + 1,
      updatedAt: new Date().toISOString()
    };

    const version = repository.saveWorkflowDefinition(updated, {
      changeSummary: `Re-recorded from step ${fromStepIndex + 1}: replaced ${stepsReplaced} step(s) with ${compiled.steps.length} new step(s)`,
      sourceRecordingId: parsed.data.recordingId
    });

    return {
      workflowId,
      workflowVersion: version.version,
      stepsReplaced
    };
  });

  app.get('/workflows/:workflowId/versions', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const versions = repository.listWorkflowVersions(workflowId);
    if (versions.length === 0) {
      return reply.code(404).send({ error: 'workflow_not_found' });
    }
    return {
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        createdAt: v.createdAt,
        changeSummary: v.changeSummary,
        createdBy: v.createdBy
      }))
    };
  });

  app.post('/workflows/:workflowId/test-step', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const parsed = TestStepRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const workflow = repository.getLatestWorkflowDefinition(workflowId);
    if (!workflow) return reply.code(404).send({ error: 'workflow_not_found' });

    const stepStartMs = Date.now();
    try {
      await launcher.executeStep(parsed.data.step, {
        runId: `test_${randomUUID()}`,
        stepIndex: 0,
        attempt: 1,
        signal: new AbortController().signal
      });
      return {
        ok: true,
        durationMs: Date.now() - stepStartMs
      };
    } catch (err) {
      return {
        ok: false,
        durationMs: Date.now() - stepStartMs,
        error: {
          code: 'step_failed',
          message: err instanceof Error ? err.message : 'Step test failed.'
        }
      };
    }
  });

  app.post('/workflows/:workflowId/run-from', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const parsed = RunFromStepRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const workflow: Workflow | null = repository.getLatestWorkflowDefinition(workflowId);
    if (!workflow) return reply.code(404).send({ error: 'workflow_not_found' });
    if (parsed.data.fromStepIndex >= workflow.steps.length) {
      return reply.code(400).send({ error: 'step_index_out_of_range' });
    }

    const versionRows = repository.listWorkflowVersions(workflowId);
    const latest = versionRows[0];
    if (!latest) return reply.code(404).send({ error: 'workflow_version_not_found' });

    const runId = `run_${randomUUID()}`;
    const entry = registry.register({
      runId,
      workflowId,
      status: 'running',
      startedAt: new Date().toISOString()
    });

    void (async () => {
      try {
        const events = executeWorkflow(workflow, {
          runId,
          ...(parsed.data.authProfileId !== undefined && { authProfileId: parsed.data.authProfileId }),
          ...(parsed.data.debugMode !== undefined && { debugMode: parsed.data.debugMode }),
          fromStepIndex: parsed.data.fromStepIndex,
          signal: entry.abort.signal,
          launcher
        });
        const graph = await buildRunGraph(workflow, events, {
          workflowVersionId: latest.id,
          ...(parsed.data.authProfileId !== undefined && { authProfileId: parsed.data.authProfileId })
        });
        repository.saveRunGraph(graph);
        registry.setStatus(runId, graph.run.status);
        lastRun = {
          id: graph.run.id,
          workflowId: graph.run.workflowId,
          workflowVersion: graph.run.workflowVersion,
          status: graph.run.status,
          triggerSource: graph.run.triggerSource,
          startedAt: graph.run.startedAt,
          finishedAt: graph.run.finishedAt,
          errorCode: graph.run.errorCode,
          errorMessage: graph.run.errorMessage
        };
      } catch (err) {
        logger.error({ err, runId }, 'run-from execution crashed');
        registry.setStatus(runId, 'failed');
      } finally {
        setTimeout(() => registry.remove(runId), 60_000).unref?.();
      }
    })();

    return reply.send({ runId, status: 'running' as const, fromStepIndex: parsed.data.fromStepIndex });
  });

  // ---- Diagnostics export ----

  app.get('/runs/:runId/diagnostics', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const graph = repository.getRunGraph(runId);
    if (!graph) return reply.code(404).send({ error: 'run_not_found' });

    const workflow = repository.getLatestWorkflowDefinition(graph.run.workflowId);

    const bundle = redactObject({
      exportedAt: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        runnerVersion: RUNNER_VERSION
      },
      ...(workflow ? { workflow } : {}),
      run: graph.run,
      steps: graph.steps,
      artifacts: graph.artifacts
    });

    return bundle;
  });

  // ---- Auth profile CRUD ----

  app.post('/auth-profiles', async (request, reply) => {
    const parsed = CreateAuthProfileRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const profileId = `profile_${randomUUID()}`;
    const now = new Date().toISOString();
    const profileDir = `${runtimePaths.profilesDir}/${profileId}`;
    const profile = repository.upsertAuthProfile({
      id: profileId,
      name: parsed.data.name,
      browserEngine: parsed.data.browserEngine,
      storageStatePath: `${profileDir}/storage-state.json`,
      profileDirectory: profileDir,
      notes: parsed.data.notes,
      createdAt: now,
      updatedAt: now,
      metadata: {}
    });
    return { profile };
  });

  app.get('/auth-profiles', async () => {
    const profiles = repository.listAuthProfiles();
    return {
      profiles: profiles.map((p) => {
        let status: AuthProfileStatus = 'never_initialized';
        if (existsSync(p.storageStatePath)) {
          if (p.lastValidatedAt) {
            const validatedMs = new Date(p.lastValidatedAt).getTime();
            const ageHours = (Date.now() - validatedMs) / (1000 * 60 * 60);
            status = ageHours > 72 ? 'likely_expired' : 'valid';
          } else {
            status = 'valid';
          }
        }
        return { ...p, status };
      })
    };
  });

  app.delete('/auth-profiles/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = repository.deleteAuthProfile(id);
    if (!deleted) return reply.code(404).send({ error: 'profile_not_found' });
    return { ok: true };
  });

  app.post('/auth-profiles/:id/login-session', async (request, reply) => {
    const { id } = request.params as { id: string };
    const profile = repository.getAuthProfile(id);
    if (!profile) {
      return reply.code(404).send({ error: 'profile_not_found' });
    }
    // Placeholder — real interactive login requires spawning a headful Playwright context.
    return {
      authProfileId: id,
      status: 'ready' as const,
      message: 'Interactive login session not yet implemented.'
    };
  });

  app.post('/auth-profiles/:id/validate', async (request, reply) => {
    const parsed = ValidateAuthProfileRequestSchema.safeParse(
      request.body ?? {}
    );
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { id } = request.params as { id: string };
    const profile = repository.getAuthProfile(id);
    if (!profile) {
      return { valid: false, reason: 'profile_not_found' };
    }
    if (!existsSync(profile.storageStatePath)) {
      return { valid: false, reason: 'storage_state_missing' };
    }
    // Real Playwright validation lands later.
    return { valid: true };
  });

  // ---- Schedule CRUD ----

  app.post('/schedules', async (request, reply) => {
    const parsed = CreateScheduleRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const workflow = repository.getWorkflow(parsed.data.workflowId);
    if (!workflow) return reply.code(404).send({ error: 'workflow_not_found' });

    const scheduleId = `sched_${randomUUID()}`;
    const now = new Date().toISOString();
    const schedule: Schedule = {
      id: scheduleId,
      workflowId: parsed.data.workflowId,
      enabled: parsed.data.enabled,
      pattern: parsed.data.pattern,
      timezone: parsed.data.timezone,
      hour: parsed.data.hour,
      minute: parsed.data.minute,
      missedRunPolicy: parsed.data.missedRunPolicy,
      authProfileId: parsed.data.authProfileId,
      createdAt: now,
      updatedAt: now
    };
    repository.upsertSchedule(schedule);
    return { schedule };
  });

  app.get('/schedules', async (request) => {
    const { workflowId } = (request.query ?? {}) as { workflowId?: string };
    const all = repository.listSchedules();
    const schedules = workflowId
      ? all.filter((s) => s.workflowId === workflowId)
      : all;
    return { schedules };
  });

  app.put('/schedules/:scheduleId', async (request, reply) => {
    const { scheduleId } = request.params as { scheduleId: string };
    const parsed = UpdateScheduleRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const existing = repository.getSchedule(scheduleId);
    if (!existing) return reply.code(404).send({ error: 'schedule_not_found' });

    const updated: Schedule = {
      ...existing,
      ...(parsed.data.pattern !== undefined && { pattern: parsed.data.pattern }),
      ...(parsed.data.timezone !== undefined && { timezone: parsed.data.timezone }),
      ...(parsed.data.hour !== undefined && { hour: parsed.data.hour }),
      ...(parsed.data.minute !== undefined && { minute: parsed.data.minute }),
      ...(parsed.data.missedRunPolicy !== undefined && { missedRunPolicy: parsed.data.missedRunPolicy }),
      ...(parsed.data.authProfileId !== undefined && { authProfileId: parsed.data.authProfileId ?? undefined }),
      ...(parsed.data.enabled !== undefined && { enabled: parsed.data.enabled }),
      updatedAt: new Date().toISOString()
    };
    repository.upsertSchedule(updated);
    return { schedule: updated };
  });

  app.delete('/schedules/:scheduleId', async (request, reply) => {
    const { scheduleId } = request.params as { scheduleId: string };
    const deleted = repository.deleteSchedule(scheduleId);
    if (!deleted) return reply.code(404).send({ error: 'schedule_not_found' });
    return { ok: true };
  });

  app.addHook('onReady', async () => {
    logger.info(
      {
        dataDir: runtimePaths.baseDir,
        port: env.RUNNER_PORT
      },
      'Runner scaffold ready.'
    );
  });

  return { app, runtimePaths, repository, registry };
}
