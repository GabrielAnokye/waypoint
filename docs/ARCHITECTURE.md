# Waypoint Architecture

## System Overview

Waypoint is a split local-first system with three runtime surfaces:

- A Chrome Extension (Manifest V3) for recording UI, workflow management UI, event capture, schedule triggers, and communication initiation.
- A local Runner Service (Node.js + Fastify + Playwright + SQLite) for workflow execution, persistence, artifact management, and scheduling durability.
- A Native Messaging Host bridge that allows the extension to communicate with the runner without broad network permissions or remote code.

The system is intentionally biased toward reliable replay and deep observability rather than lightweight best-effort macros.

## Runtime Boundaries

### Chrome Extension Responsibilities

- Side panel UI for workflows, runs, settings, and repair actions.
- Service worker for event orchestration, alarm registration, and bridge communication.
- Content scripts for DOM event capture and DOM snapshot extraction.
- Active-tab driven script injection for recording with minimal persistent host permissions.
- Local UI state with Zustand.
- Input validation at UI and bridge boundaries with Zod.
- Local schedule trigger intent generation.
- Import/export UI for workflow JSON.

### Local Runner Responsibilities

- Host Fastify API for local operations and internal orchestration.
- Own SQLite persistence and artifact indexing.
- Run Playwright browser automation in dedicated managed profiles.
- Compile raw recordings into durable workflow revisions.
- Execute schedules reliably and restore them on startup.
- Produce Pino logs, screenshots, traces, and structured run diagnostics.
- Manage workflow migrations and validation on import.

### Native Messaging Host Responsibilities

- Provide a narrow extension-to-local-process bridge.
- Start the runner if it is not already running.
- Relay request/response envelopes between extension and runner.
- Avoid storing product data; act as transport and process supervisor only.

## Why the Native Bridge Exists

The extension should not depend on broad host permissions or direct localhost networking as its primary control path. Native messaging gives a stable local bridge that:

- Keeps extension permissions lean.
- Avoids remote dependencies.
- Allows process supervision and runner startup.
- Preserves a clean trust boundary between browser UI logic and privileged local execution.

## Workflow Lifecycle

### 1. Record

- User starts recording from the side panel.
- Extension service worker injects content capture logic into the active tab.
- Content scripts emit raw capture events: clicks, typing, navigations, tab/frame changes, target metadata, and timing.
- Sensitive inputs are redacted before persistence.
- Recorder stores a session buffer in extension memory and streams summaries to the runner as needed.

### 2. Compile

- Runner validates the raw recording payload with Zod.
- Compiler normalizes noisy event streams into a workflow DSL.
- Selector engine produces a prioritized locator set: role/name, label, text, test id, CSS, XPath, coordinates.
- Compiler emits diagnostics for dropped/merged events and confidence scores for target selection.

### 3. Save

- Runner writes the workflow revision and metadata to SQLite.
- Raw recording summaries and artifacts are written to the artifact store.
- Exportable workflow JSON is derived from the canonical stored workflow revision format.

### 4. Replay

- User triggers a run manually or via schedule.
- Runner loads the workflow revision and selected auth profile.
- Playwright launches a managed browser context.
- Runner executes steps serially with structured retries and captures per-step results.
- Logs, trace, screenshots, and step timing are emitted throughout execution.

### 5. Debug

- Failed runs are classified into a normalized failure taxonomy.
- The UI shows failing step details, selected locator attempts, last page URL, logs, screenshots, and trace link.
- The user can inspect the source recording summary that produced the compiled step.

### 6. Repair

- User edits the broken step or selector from the side panel.
- Runner validates and saves a new workflow revision.
- The next replay uses the new revision while prior revisions remain available for audit and diff.

## Core Data Model

### SQLite Tables

- `workflows`
- `workflow_revisions`
- `recording_sessions`
- `recording_events`
- `profiles`
- `schedules`
- `runs`
- `run_steps`
- `artifacts`
- `settings`

### Artifact Store Layout

Artifacts live on disk outside the repo root under an app data directory such as:

```text
data/
  app.db
  artifacts/
    recordings/
    screenshots/
    traces/
    logs/
  profiles/
    <profile-id>/
```

The exact OS-specific base path is implementation-defined, but it must be outside the repository and inaccessible to the extension except through the runner.

### Workflow Revision Shape

At a high level:

```json
{
  "schemaVersion": 1,
  "workflowVersion": 4,
  "workflowId": "wf_01J...",
  "name": "Morning setup",
  "trigger": { "type": "manual" },
  "defaultProfileId": "profile_work",
  "steps": [
    {
      "id": "step_01J...",
      "type": "goto",
      "url": "https://docs.google.com/spreadsheets",
      "timeoutMs": 30000
    },
    {
      "id": "step_01J...",
      "type": "click",
      "target": {
        "primary": { "kind": "role", "role": "button", "name": "Functions" },
        "fallback": [
          { "kind": "text", "text": "Functions" },
          { "kind": "css", "selector": "[aria-label='Functions']" }
        ]
      }
    }
  ]
}
```

## Extension and Runner Interface

### Transport Shape

All bridge messages are JSON envelopes validated with Zod:

```json
{
  "requestId": "req_01J...",
  "type": "workflow.run",
  "payload": {}
}
```

### Required Request Families

- `runner.health`
- `recording.start`
- `recording.stop`
- `workflow.compile`
- `workflow.save`
- `workflow.list`
- `workflow.run`
- `workflow.repair`
- `schedule.upsert`
- `run.get`
- `artifact.open`

### Error Envelope

Errors must be machine-readable:

```json
{
  "requestId": "req_01J...",
  "error": {
    "code": "AUTH_STATE_MISSING",
    "message": "Selected profile is not available.",
    "retryable": false
  }
}
```

## Failure Taxonomy

Every run and bridge failure must map to one of these categories:

- `BRIDGE_UNAVAILABLE`: extension cannot reach native host or runner.
- `PERMISSION_DENIED`: required browser/extension permission missing.
- `RECORDING_CAPTURE_FAILED`: content capture or DOM extraction failed.
- `COMPILATION_FAILED`: raw recording could not be normalized safely.
- `WORKFLOW_VALIDATION_FAILED`: invalid schema or invalid imported JSON.
- `PROFILE_UNAVAILABLE`: selected auth profile missing or corrupted.
- `AUTH_EXPIRED`: session exists but target site requires reauthentication.
- `BROWSER_LAUNCH_FAILED`: Playwright could not create the managed browser context.
- `NAVIGATION_FAILED`: destination did not load within policy.
- `LOCATOR_NOT_FOUND`: no candidate locator resolved.
- `ELEMENT_NOT_ACTIONABLE`: element existed but was not interactable.
- `ASSERTION_FAILED`: workflow verification step failed.
- `STATE_WRITE_FAILED`: SQLite or artifact write failed.
- `SCHEDULE_MISSED`: scheduled run could not be executed at the expected time.
- `INTERNAL_ERROR`: uncategorized product defect.

Each failure record must also store:

- `failureCode`
- `failureCategory`
- `stepId` when applicable
- `url`
- `retryable`
- `suggestedRepairAction`

## Versioning Strategy for Workflow JSON

- Store one canonical latest workflow revision format in SQLite.
- Export workflow JSON with explicit `schemaVersion`.
- Maintain migration functions for every breaking schema change.
- Never mutate imported historical JSON in place; save migrated output as a new revision.
- Use additive optional fields for backward-compatible features whenever possible.
- Reject imports from future schema versions with a clear error and no partial writes.

## Threat Model

### Assets

- Authenticated browser state.
- Workflow JSON and revision history.
- Raw recording artifacts and screenshots.
- Logs and traces containing URLs, page content, and user-entered non-secret data.

### Trust Boundaries

- Web page content is untrusted.
- Content scripts run in hostile pages and must treat DOM data as tainted input.
- Extension UI and service worker are trusted but limited.
- Native host and runner are trusted local components.
- Local filesystem is trusted only to the degree of the user's OS account protections.

### Likely Threats

- Sensitive data leakage through recordings, logs, or screenshots.
- Malicious DOM content attempting to poison selector generation or stored metadata.
- Accidental workflow export of secrets or auth artifacts.
- Local compromise of the user's OS account exposing auth state files.
- Excessive extension permissions increasing install friction and attack surface.

### Controls

- Redact password and secret-like fields before persistence.
- Validate all cross-boundary payloads with Zod.
- Keep auth state outside the repo and outside exported workflow JSON.
- Store auth state under restrictive file permissions in per-profile directories.
- Keep the extension code fully bundled; no remote executable code.
- Prefer `activeTab` and programmatic injection over persistent broad host permissions.

## Privacy Model

- All core execution data remains on the local machine in v1.
- Workflow exports include workflow logic and metadata only, not auth profiles or artifact blobs by default.
- Users can delete workflows, runs, and profiles locally.
- Traces and screenshots are retained locally and can be purged by retention policy.
- Analytics and telemetry are out of scope for v1.

## Target Repository Tree

```text
apps/
  extension/
    src/
      sidepanel/
      service-worker/
      content/
  native-host/
    src/
      bridge/
      process/
  runner/
    src/
      api/
      bridge/
      db/
      playback/
      schedules/

packages/
  compiler/
  logging/
  selector-engine/
  shared-types/
  storage/
  workflow-schema/
  bridge-contract/

docs/
  PRD.md
  ARCHITECTURE.md
  ADR-001-stack.md
  ADR-002-recording-and-replay-model.md
  ADR-003-auth-and-security-model.md
  ROADMAP.md

tests/
  e2e/
```

## Planned Command Surface

The scaffold phase should establish these workspace commands:

- `pnpm dev`
- `pnpm build`
- `pnpm lint`
- `pnpm test`
- `pnpm test:e2e`
