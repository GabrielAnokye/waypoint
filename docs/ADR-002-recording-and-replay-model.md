# ADR-002: Recording and Replay Model

- Status: Accepted
- Date: 2026-03-09

## Context

Naive browser macro tools often replay raw clicks and keystrokes exactly as recorded. That approach is brittle because websites change layout, loading time varies, and indirect navigation paths are often less stable than the destination they imply.

Waypoint needs to:

- capture enough detail for debugging
- replay user intent reliably
- preserve workflow JSON compatibility over time
- support repair without full re-recording

## Decision

Adopt a dual-layer model:

- Raw Capture Layer: detailed browser interaction events and DOM context collected during recording.
- Compiled Workflow Layer: a normalized DSL used for persistence, editing, replay, import/export, and repair.

The runner replays only compiled workflow steps, never the raw event stream directly.

## Raw Capture Layer

The recorder captures:

- tab creation and closure
- navigation start and completion
- frame context
- click targets and coordinates
- text entry intent and redacted values where required
- select/input changes
- keyboard actions with intent significance
- URL changes
- timestamps and coarse timing
- element snapshots and semantic locator candidates

Raw capture data exists to support:

- compilation
- debugging
- future migrations
- repair context

It is not the canonical execution format.

## Compiled Workflow Layer

The canonical saved workflow consists of typed steps such as:

- `newTab`
- `goto`
- `click`
- `type`
- `select`
- `waitFor`
- `assert`
- `closeTab`

Each step may include:

- stable step id
- timeout policy
- page/tab scope
- primary locator
- ordered fallback locators
- step metadata explaining compilation origin

## Selector Strategy

Selectors are ranked in this order:

1. semantic role/name
2. label
3. stable text
4. test id
5. CSS
6. XPath
7. coordinates

Coordinates are a last resort only when the system cannot produce a safer target. Coordinate-only steps must be marked low-confidence and surfaced clearly in repair UI.

## Compilation Rules

- Prefer direct navigation when the destination is known and stable.
- Collapse redundant waits and intermediate focus noise.
- Merge sequential text-entry events into a single `type` step.
- Drop events that do not change user intent and are not needed for replay.
- Preserve a source mapping from compiled step to raw event ids.
- Emit compilation warnings for ambiguous or low-confidence targets.

## Replay Rules

- Replay only compiled steps.
- Execute serially inside a Playwright-managed browser context.
- Use Playwright locators and auto-wait semantics by default.
- Attempt fallbacks in deterministic order and record which locator succeeded.
- Capture trace, screenshots, logs, and per-step timing.

## Versioning Decision

Workflow JSON is versioned at the compiled workflow layer, not the raw capture layer.

- `schemaVersion` governs the exported and persisted workflow DSL.
- Raw recording structures may evolve faster internally.
- Migration support is required only for persisted/exported workflow schema versions.

This keeps compatibility work focused on user-owned artifacts that matter.

## Consequences

### Positive

- Replay becomes more reliable than literal event reproduction.
- Repair UI can operate on understandable steps rather than noisy event streams.
- Backward compatibility is easier to manage.
- Debugging remains strong because raw capture is still retained.

### Negative

- Compiler quality becomes a critical product risk.
- Some recorded nuances may be lost if the compiler is too aggressive.
- Additional storage is required for raw capture plus compiled revisions.

## Rejected Alternatives

### Direct Event Replay

Rejected because it is too brittle for modern dynamic websites.

### Coordinate-First Playback

Rejected because it fails frequently with layout changes and responsive pages.

### Extension-Only Playback

Rejected because reliable automation, traces, and managed profiles belong in Playwright, not in extension scripts.

## Implementation Notes

- The compiler package must expose deterministic transforms with test fixtures.
- Every compiled step should record its originating raw event ids for traceability.
- Repair UI should show low-confidence selectors and allow explicit selector replacement.
