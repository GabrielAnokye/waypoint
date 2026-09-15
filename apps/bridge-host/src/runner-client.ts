/**
 * Forwards bridge commands to the local runner over HTTP.
 * Falls back to runner_unreachable on connection failure.
 */

import type { BridgeCommandName } from '@waypoint/bridge-protocol';
import type { CommandHandler } from './dispatcher.js';

export interface RunnerClientOptions {
  baseUrl?: string;
}

function baseUrl(opts?: RunnerClientOptions): string {
  return opts?.baseUrl ?? 'http://127.0.0.1:3100';
}

async function fetchRunner(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const resp = await fetch(url, init);
  const body = await resp.json();
  return { ok: resp.ok, status: resp.status, body };
}

/**
 * Returns a handler map that proxies commands to the runner's HTTP API.
 */
export function createHttpHandlers(
  opts?: RunnerClientOptions
): Partial<Record<BridgeCommandName, CommandHandler>> {
  const url = baseUrl(opts);

  return {
    async ping() {
      return {
        pong: true,
        hostVersion: '0.1.0',
        protocolVersion: 1
      };
    },

    async getHealth() {
      const r = await fetchRunner(`${url}/health`);
      if (!r.ok) throw new Error('Runner health check failed');
      return r.body;
    },

    async runWorkflow(payload) {
      const { workflowId, authProfileId, debugMode } = payload as {
        workflowId: string;
        authProfileId?: string;
        debugMode?: boolean;
      };
      const r = await fetchRunner(`${url}/workflows/${workflowId}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authProfileId, debugMode })
      });
      if (!r.ok) throw new Error(`Run failed: ${JSON.stringify(r.body)}`);
      return r.body;
    },

    async cancelRun(payload) {
      const { runId } = payload as { runId: string };
      const r = await fetchRunner(`${url}/runs/${runId}/cancel`, {
        method: 'POST'
      });
      if (!r.ok) throw new Error(`Cancel failed: ${JSON.stringify(r.body)}`);
      return r.body;
    },

    async listRuns(payload) {
      const { workflowId } = (payload ?? {}) as { workflowId?: string };
      const qs = workflowId ? `?workflowId=${workflowId}` : '';
      const r = await fetchRunner(`${url}/runs${qs}`);
      return r.body;
    },

    async getRunDetails(payload) {
      const { runId } = payload as { runId: string };
      const r = await fetchRunner(`${url}/runs/${runId}`);
      if (!r.ok) throw new Error('Run not found');
      return r.body;
    },

    async saveWorkflow(payload) {
      const { recording, name } = payload as {
        recording: unknown;
        name?: string;
      };
      const r = await fetchRunner(`${url}/recordings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(recording)
      });
      if (!r.ok) throw new Error(`Save failed: ${JSON.stringify(r.body)}`);
      return r.body;
    },

    async listWorkflows() {
      const r = await fetchRunner(`${url}/workflows`);
      return r.body;
    },

    async createAuthProfile(payload) {
      // Stub — auth profile creation is out of scope for this phase.
      return { authProfileId: 'stub_profile' };
    },

    async validateAuthProfile(payload) {
      const { authProfileId, probeUrl, probeSelector } = payload as {
        authProfileId: string;
        probeUrl?: string;
        probeSelector?: string;
      };
      const r = await fetchRunner(
        `${url}/auth-profiles/${authProfileId}/validate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ probeUrl, probeSelector })
        }
      );
      return r.body;
    }
  };
}
