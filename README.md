# Waypoint

A local-first browser workflow automation engine, built as the experimental
platform for a senior seminar study on **locator robustness**.

## Research Question

> How robust are different browser locator strategies to realistic webpage
> changes, and can self-healing techniques improve the reliability of browser
> automation?

Browser automation is fragile. A recorded click that identifies a button by CSS
selector or screen coordinates often breaks after a site changes its markup,
class names, or layout — even when the button is visually unchanged and still
present. This project measures *how* fragile each strategy is, and whether a
failed step can be repaired automatically instead of re-recorded by hand.

## Locator Strategy Taxonomy

Every recorded step carries one primary locator plus an ordered fallback chain.
Strategies group into three families, which are the independent variable of the
study:

| Family | Strategies | Binds to |
| --- | --- | --- |
| Coordinate | `coordinates` | Absolute viewport position |
| Structural | `css`, `xpath` | DOM shape, class names, attributes |
| Intent-based | `role`, `label`, `text`, `testId`, `placeholder` | Accessibility semantics and visible meaning |

The hypothesis is that intent-based locators survive structural and cosmetic
change substantially better than structural or coordinate locators, because they
bind to what the element *means* to a user rather than where it sits in the tree.

## System Surfaces

| Surface | Role |
| --- | --- |
| `apps/extension` | Chrome MV3 extension — records actions, captures locator candidates, manages workflows |
| `apps/runner` | Node + Fastify + Playwright service — executes workflows, resolves locators, records diagnostics |
| `apps/bridge-host` | Native messaging host bridging extension and runner |
| `packages/shared-types` | Zod schemas for workflows, steps, locators, and run events |
| `packages/compiler` | Turns raw recorded traces into durable workflow steps |
| `packages/db` | SQLite persistence with migrations |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for runtime boundaries and
[docs/RESEARCH-PLAN.md](docs/RESEARCH-PLAN.md) for the experimental design.

## Getting Started

Requires Node >= 22 and pnpm >= 9.

```bash
pnpm install
pnpm typecheck     # tsc -b across all project references
pnpm test          # Vitest unit + integration suites
pnpm test:e2e      # Playwright end-to-end (builds first)
```

## Project Status

The automation engine and the locator resolution layer are in place. The
experimental apparatus — the DOM mutation engine, the benchmark harness, and the
self-healing repair algorithm — is the remaining work. See
[docs/RESEARCH-PLAN.md](docs/RESEARCH-PLAN.md).
