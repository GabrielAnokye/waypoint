# ADR-001: Locked Stack and Monorepo Shape

- Status: Accepted
- Date: 2026-03-09

## Context

Waypoint must be a production-ready local-first browser automation product with:

- no paid services
- no cloud dependency
- a Chrome MV3 extension
- a local Node.js runner
- reliable browser automation
- local persistence
- strong validation, logging, and testability

The stack needs to support three distinct concerns:

- browser-integrated recording and workflow UI
- durable local execution and scheduling
- shared schema and contracts across extension and runner

## Decision

Use the following locked stack:

- `pnpm` workspaces for the monorepo
- TypeScript across all apps and packages
- Chrome Extension Manifest V3
- React + Vite for extension UI
- Chrome side panel + service worker + content scripts
- Node.js + Fastify for the local runner/service
- Playwright for browser automation
- SQLite for local persistence
- Zod for schemas and boundary validation
- Zustand for local extension UI state
- Pino for structured logging
- Vitest for unit/integration tests
- Playwright Test for end-to-end tests

Use a split monorepo:

- `apps/extension`
- `apps/runner`
- shared `packages/*` for schema, bridge contracts, compiler, selector engine, and logging

## Rationale

- `pnpm` workspaces make shared package versioning and local linking simple.
- TypeScript is required to keep extension and runner contracts aligned.
- MV3 is the supported Chrome extension model and allows side panel UX.
- React + Vite is the most direct extension UI stack with fast iteration and bundling.
- Node.js + Fastify is lightweight, typed, and suitable for a local service boundary.
- Playwright provides resilient locators, auto-waiting, traces, and profile reuse.
- SQLite is the simplest durable local database with no external service.
- Zod keeps every boundary explicit and machine-validated.
- Zustand is sufficient for local side panel state without unnecessary complexity.
- Pino provides structured logs useful for support and debugging.
- Vitest and Playwright Test cover unit through end-to-end behavior in one JS/TS-native toolchain.

## Consequences

### Positive

- Single language and tooling chain across the product.
- Clear separation between browser extension concerns and privileged local automation.
- Strong local developer ergonomics without cloud infrastructure.
- Straightforward packaging of a local-first product.

### Negative

- Native messaging host installation and packaging complexity is real.
- Browser extension architecture introduces lifecycle constraints from MV3 service workers.
- Playwright-managed browser profiles are separate from a user's default browser profile.
- SQLite is single-node only, which is acceptable for v1 but not for multi-user future work.

## Rejected Alternatives

### Electron or Tauri Desktop App

Rejected because the product's primary interaction model is browser-native recording and browser-integrated UX. An extension plus local runner yields a smaller surface for v1.

### Puppeteer Instead of Playwright

Rejected because Playwright has stronger locator ergonomics, tracing, and execution stability for this product shape.

### Express Instead of Fastify

Rejected because Fastify gives better schema-centric structure and lower overhead for a local service with no extra complexity.

### PostgreSQL Instead of SQLite

Rejected because it adds operational burden and is unnecessary for single-user local-first v1.

### Redux Instead of Zustand

Rejected because the extension side panel does not justify the extra ceremony for local UI state.

## Implementation Notes

- The initial scaffold must expose root workspace commands for build, lint, test, and end-to-end test.
- Every cross-boundary payload between extension, native host, and runner must live in a shared package and be validated with Zod.
- All non-trivial packages must include Vitest coverage from the first implementation slice.
