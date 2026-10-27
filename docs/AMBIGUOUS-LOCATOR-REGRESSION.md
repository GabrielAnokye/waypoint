# Ambiguous Delete locator regression

The resolver previously accepted two or three semantic/test-contract matches by
returning `.first()` at half confidence. The launcher never checked that score,
so all three recorded `role=button, name=Delete` clicks executed on Alpha.

Resolution now advances through the recorded fallbacks until exactly one element
matches. It returns the original strict Playwright locator, without `.first()`,
so a new duplicate appearing before execution also causes abstention. Coordinates
are not used to break element-locator ties. If nothing resolves uniquely,
`ambiguous_locator` (or `locator_not_found` for all misses) carries the attempted
locators and counts. The launcher throws `LocatorResolutionError`; the executor
preserves its repair record and stops the workflow. The persisted record is at
`steps[].debug.extra.repairRecord`, including through `GET /runs/:id`.

The compiler also compared only primary locators when collapsing rapid clicks.
It now includes recorded fallbacks and tab identity, preserving distinct clicks
inside the 400 ms merge window without consulting the ground-truth oracle.
Inferred waits inherit the expected identity. A successful action without an
expected identity keeps its observation but receives no correctness label.

`data-truth-id` is observed only for evaluation, after normal locator resolution.
It is not a matching heuristic. A unique recorded fallback can still hit the
wrong element after DOM change: the classifier retains both identities and
reports `false_positive`. Execution status alone is not a correctness metric.

## Changed files

| File | Change |
| --- | --- |
| `apps/runner/src/core/locate.ts` | Strict unique resolution, ambiguity failures, match-count diagnostics, typed error |
| `apps/runner/src/core/playwright-launcher.ts` | Preserve strict locators and repair errors; enforce optional `allowedFamily` throughout execution |
| `apps/runner/src/core/executor.ts` | Preserve repair record and expected identity on failure; label safe ambiguity abstention; avoid correctness labels without expected identity |
| `apps/runner/src/core/persist.ts` | Persist repair records with step diagnostics |
| `packages/shared-types/src/index.ts` | Optional per-locator match counts in repair schema; document abstention classification |
| `packages/compiler/src/index.ts` | Preserve distinct rapid clicks and expected identities on inferred waits |
| `apps/runner/src/core/locate.test.ts` | Duplicate counts, strict handles, fallback order, family isolation |
| `apps/runner/src/core/executor.test.ts` | Structured persisted abstention, workflow stopping, missing expected identity |
| `packages/compiler/src/index.test.ts` | Rapid distinct clicks and inferred-wait identity |
| `playwright.browser.config.ts` | Dedicated real-browser suite with a fresh runner on port 3101 |
| `tests/browser/ambiguous-replay.spec.ts` | Actual extension recording, HTTP replay, trusted click evidence, wrong targets, abstention, independent families, DOM race |

## Repeat the browser demonstration

```sh
corepack pnpm test:e2e --config playwright.browser.config.ts --headed
```

Omit `--headed` for unattended real Chromium runs. This command rebuilds the
extension and runner before starting. The configuration refuses to reuse an
existing runner on port 3101. Each test loads the rebuilt extension, restarts its
dedicated Chromium profile to reload it, and verifies the extension responds
before recording. Browser debug port 9223 must be available.

The suite records Alpha, Beta and Gamma with the real content recorder and
service worker, saves through `/recordings`, and replays through the real HTTP
runner. Recording selects buttons by visible item context. A page listener
independently captures each trusted click and displays an on-page evidence log.
Both actual events and SQLite-backed run identities are asserted.

| Scenario | Actual clicks | Expected result |
| --- | --- | --- |
| Original recorded workflow | Alpha, Beta, Gamma | Three true positives through distinct recorded CSS fallbacks |
| Distinguishing ancestor selectors removed; truth IDs retained | None | `ambiguous_locator`, safe abstention, persisted repair record |
| Beta step deliberately given Alpha's unique recorded fallback | Alpha | Expected `delete-beta`, resolved `delete-alpha`, `false_positive` |
| Intent family only | None | Ambiguous; cannot borrow CSS or test IDs |
| Test-contract family only | None | No recorded test-ID candidate for these buttons |
| Structural family only | Alpha, Beta, Gamma | Three true positives |
| Coordinate family only | Alpha, Beta, Gamma | Three true positives at recorded positions |
| Unique CSS becomes duplicated on focus before click | None | Strict-mode ambiguity; no first-match action |

Family trials use a fresh `allowedFamily` launcher for each family. Normal replay
remains an ordered cross-family fallback chain. A CSS recovery is not an intent
success. Coordinate-only trials use click steps because inferred element waits
are not positional actions. The attached browser in this regression is a
controlled execution-path demonstration, not a mutation benchmark dataset.

The HTML report at `playwright-report/browser/index.html` contains browser videos,
screenshots, original recordings, persisted run JSON, actual click-event JSON and
separate family results. The positive/negative screenshots show the on-page
trusted-event log, not merely a successful locator count.

## Verification completed on 2026-10-27

- Full unit/integration suite: **205 passed**, 20 files (run with local-port access).
- Real Chromium regression suite: **5 passed** headless; **5 passed** again headed.
- Full workspace build, TypeScript project checks, ESLint, and `git diff --check`: **passed**.
- The everyday runner on port 3100 was restarted with the rebuilt code before
  the headed demonstration. The browser suite also started its own fresh runner
  on port 3101 and reloaded the extension in each dedicated browser profile.
- No mutation-engine implementation changes were made.

Saved headed demonstration:

- [Three correct clicks, screenshot](../test-results/ambiguity-demonstration/correct-targets/three-correct-clicks.png)
- [Three correct clicks, video](../test-results/ambiguity-demonstration/correct-targets/browser-video.webm)
- [Actual trusted click events](../test-results/ambiguity-demonstration/correct-targets/actual-click-events.json)
- [Correct-target persisted run](../test-results/ambiguity-demonstration/correct-targets/persisted-run.json)
- [Safe abstention, screenshot](../test-results/ambiguity-demonstration/safe-abstention/safe-abstention.png)
- [Safe abstention, persisted diagnostics](../test-results/ambiguity-demonstration/safe-abstention/persisted-run.json)
- [Wrong-target persisted comparison](../test-results/ambiguity-demonstration/wrong-target/persisted-run.json)

The negative workflow stops at the compiler-inferred wait before its first click:
expected `delete-alpha`, no resolved identity, `ambiguous_locator`, zero trusted
click events. The separate DOM-race case exercises refusal in the click action
itself. These artifacts are local test outputs and are ignored by Git.
