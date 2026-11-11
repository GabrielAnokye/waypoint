# Waypoint Weeks 10–12: how to test and record the demo

Run commands from the repository, not the parent Senior Seminar folder:

```bash
cd "/Users/gabrielanokye/Senior Seminar/waypoint"
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
```

The measured checkout is `86d9c7b`. This review used Node v25.9.0 and pnpm 9.0.0.
The project declares Node >=22 and pnpm >=9. Browser binaries must match the
installed Playwright version. The package commands use Corepack internally.

## 1. Run the complete automated checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: **253 tests pass in 24 Vitest files**, with no failed files, and the
other three commands exit 0. Typecheck/lint normally print their command banners
and no diagnostics; a silent success is expected. `pnpm test` first builds the
shared packages, then runs Vitest; its browser integration tests use real
headless Chromium.

To check each research component separately after building:

| What to verify | Command | Expected |
| --- | --- | --- |
| All six mutators, HTTP fixture server, truth immutability | `pnpm exec vitest run apps/runner/src/core/mutation/mutators.test.ts` | 25 passing tests |
| Formula arithmetic, gating, truth isolation, Chromium repair/refusal, stable candidate identity, incompatible actions, all fixture states | `pnpm exec vitest run apps/runner/src/core/healer.test.ts` | 19 passing tests |
| Migration 005, v4 upgrade/idempotence and persistence round trips | `pnpm exec vitest run packages/db/src/index.test.ts` | 9 passing tests |
| Capture metadata survives compilation and inferred waits | `pnpm exec vitest run packages/compiler/src/index.test.ts` | 17 passing tests |
| Manual intervention stops retries and subsequent actions, telemetry reaches the run graph | `pnpm exec vitest run apps/runner/src/core/executor.test.ts` | 15 passing tests |
| Recovery denominators, false positives, zero-attempt cells, mean/P95 aggregation | `pnpm exec vitest run apps/runner/src/core/benchmark/runner.test.ts` | 2 passing tests |

For a short on-camera test, run one named case:

```bash
pnpm exec vitest run apps/runner/src/core/healer.test.ts -t "does not access truth annotations"
pnpm exec vitest run apps/runner/src/core/healer.test.ts -t "refuses all three indistinguishable"
pnpm exec vitest run apps/runner/src/core/healer.test.ts -t "fails unrecoverably"
pnpm exec vitest run packages/db/src/index.test.ts -t "upgrades existing v4"
```

Filtered runs intentionally report other tests as skipped. Do not confuse those
filter skips with failures or claim a filtered run executed all 253 tests.

## 2. Check real recording, compilation and browser replay

```bash
pnpm exec playwright test --config playwright.browser.config.ts --headed
pnpm exec playwright show-report playwright-report/browser
```

Expected: **13 passed, 0 skipped**. The visible flag is necessary for the native
side-panel test; headless mode skips that one demonstration. The suite uses a
fresh dedicated Chromium profile, extension built from `apps/extension/dist`,
a fresh runner on **3101**, CDP on **9223**, and a local fixture server. Its
runner uses the application's normal SQLite runtime location. It records and
replays Alpha/Beta/Gamma and checks actual trusted click events, wrong-target
classification, safe ambiguity refusal, family isolation, strict existing-tab
selection, and the native side-panel button. Browser videos, screenshots,
recordings, persisted-run JSON and click-event attachments are in the report.

The independent API smoke suite can be run without a real browser:

```bash
pnpm exec playwright test --config docs/verification-runs/weeks-10-12-review-2026-11-10/api-smoke.config.mjs
```

Expected: **7 passed**. This review helper starts an **in-memory database and a
no-op launcher on port 3199**, with one test worker. It proves HTTP
recording/compilation/run/list/error contracts, not locator accuracy. The default
`pnpm test:e2e` configuration uses port 3100 and may reuse an existing server;
its sample actions refer to example.com Submit/Refresh controls. Use the
provided isolated config for the API smoke demonstration rather than treating
those sample actions as a real-browser benchmark.

## 3. Inspect the six mutations visually

In one terminal:

```bash
pnpm serve:mutations
```

Leave it running. Open these URLs in Chrome at 100% zoom with the same viewport
and scroll position:

| URL | What to inspect |
| --- | --- |
| `http://127.0.0.1:8080/forms.html` | Original Sign in button, native labels, test IDs and truth IDs |
| `http://127.0.0.1:8080/forms.html?mutation=cosmetic&seed=demo` | Classes hashed to `cls_...`; coordinated CSS retains styling |
| `http://127.0.0.1:8080/forms.html?mutation=attribute&seed=demo` | IDs become `id_...`, test IDs become `tst_...`; label/script references still work |
| `http://127.0.0.1:8080/forms.html?mutation=structural&seed=demo` | New `data-mutation="structural-wrapper"` divs around controls/containers |
| `http://127.0.0.1:8080/forms.html?mutation=layout&seed=demo` | Outer body shifts 80–250px; interactive tag ancestry/names are unchanged |
| `http://127.0.0.1:8080/forms.html?mutation=content&seed=demo` | Sign in → Log in to Account, Submit → Continue, and other copy/placeholder changes |
| `http://127.0.0.1:8080/forms.html?mutation=semantic&seed=demo` | Buttons look similar but are `div.btn-lookalike[tabindex="0"]`; labels become unlinked spans; explicit roles/ARIA names removed |
| `http://127.0.0.1:8080/forms.html?variant=unlabeled` | Processed markup lacks data-testid/explicit ARIA naming; native form labels remain |

Inspect the button in DevTools using this **audit-only** query:

```javascript
const button = document.querySelector('[data-truth-id="login-submit"]');
({
  tag: button.tagName,
  text: button.textContent.trim(),
  testId: button.getAttribute('data-testid'),
  truthId: button.getAttribute('data-truth-id'),
  role: button.getAttribute('role'),
  tabindex: button.getAttribute('tabindex'),
  bodyOffset: getComputedStyle(document.body).top,
  rect: button.getBoundingClientRect().toJSON()
});
```

The truth ID must remain `login-submit` for every URL. Reading it in an audit or
a post-decision click listener is different from reading it during selection.
The scorer/candidate extractor is tested with truth-attribute reads forced to
throw. Attribute mutation should also preserve label associations and script
behavior; structural mutation should keep the slotted button visible on
`shadow-dom.html`.

For the complete corpus audit:

```bash
node docs/verification-runs/weeks-10-12-review-2026-11-10/corpus-audit.mjs
```

Expected: **8 fixtures, 16 labeling states, 112 condition/page checks,
177 source truth declarations, 2,478 preserved anchor comparisons, 0 changed**.
177 counts source declarations, including templates/srcdoc; it is not a claim
that 177 controls are simultaneously visible. Dynamic templates may generate
multiple live elements from one declaration.

## 4. Show actual autonomous repair and safe refusal

This executable review demo uses the same compiled action/healing modules as the
application and the fresh benchmark's frozen canonical capture:

```bash
node docs/verification-runs/weeks-10-12-review-2026-11-10/demo-self-healing.mjs --headed --pause-ms 2000
```

It automatically opens its own local fixture server/browser and closes them
when finished. It prints exact scores, top-three feature breakdowns, chosen
identity and actual trusted-click evidence. It writes representative-cases.json
and six PNG screenshots next to this guide. The six cases are:

1. **forms.html / attribute mutation / testContract family / login-submit**:
   original test ID fails; healer selects Sign in. Expect S1=1,
   S2=0.43675, delta=0.56325, autonomous_repair, and one trusted click on
   login-submit. This demonstrates target recovery; native required-field form
   validation is separate from clicking the correct button.
2. **ambiguous.html / Delete Alpha**: S1=1, S2=0.9846,
   delta=0.01539999999999997; needs_manual_intervention; zero clicks.
3. **Delete Beta**: same best/second scores and margin; zero clicks.
4. **Delete Gamma**: same best/second scores and margin; zero clicks.
5. **Layout-shifted Delete Beta with deliberately missing locator, greedy
   top-1**: S1=0.9936, S2=0.9782000000000001,
   delta=0.01539999999999997; it actually clicks **delete-alpha**, a wrong
   trusted click. It is deliberately demonstrated only on the local fixture.
6. **Same layout-shifted Beta, default gates**: same scores, manual
   intervention, no click. The margin prevents the wrong-target action.

Do not say the three real fixture candidates have delta=0: position distinguishes
them slightly. Their margin is about .0154, which is far below .15.
`needs_manual_intervention` is a telemetry/API outcome with top-three candidates
and a safe halt; a new interactive candidate-confirmation dialog was not added.

Normal replay keeps healing disabled unless the run request contains
`"healingEnabled": true`. Also, a healthy primary/fallback chain should execute
without healing. To force a controlled repair, the demo restricts one family
or deliberately breaks its locator. It never uses truth labels to decide that
a unique-but-wrong original locator should be replaced.

## 5. Verify migration 005 and telemetry

The DB test command above uses isolated in-memory test databases, checks all
seven columns, upgrades existing v4 history, verifies defaults and idempotence,
and round-trips the JSON/real-valued telemetry.

For an actual application run with a snapshot and healing enabled, inspect:

```bash
sqlite3 -readonly "$HOME/.waypoint/app.db" "SELECT id,name FROM migrations WHERE id=5;"
sqlite3 -readonly "$HOME/.waypoint/app.db" "PRAGMA table_info(run_steps);"
sqlite3 -readonly "$HOME/.waypoint/app.db" "SELECT step_id,status,healing_attempted,healing_outcome,healed_score,ambiguity_margin,healing_latency_ms FROM run_steps WHERE healing_attempted=1 ORDER BY started_at DESC LIMIT 5;"
```

Expected migration row: `5|005_self_healing_telemetry`. Recovery rows should carry
healing_attempted=1 and their outcome/score/margin/latency; manual steps persist
status needs_manual_intervention and halt the workflow. The benchmark harness
writes JSON/CSV directly and does not populate your application DB, so an empty
live healing query does not contradict the benchmark or the DB round-trip tests.

## 6. Reproduce the empirical matrix and check integrity

Full default run, preserving the previously published data:

```bash
pnpm benchmark:run --output-dir docs/verification-runs/weeks-10-12-review-2026-11-10/benchmark-results
node scripts/verify-benchmark.mjs docs/verification-runs/weeks-10-12-review-2026-11-10/benchmark-results
```

On macOS, prevent idle sleep during a long measurement with the optional
process-scoped prefix `caffeinate -i` before pnpm. Keep other browser jobs stopped
for the measurement. The defaults are **N=5, 4 workers, 1280×1000**. Expect:

- 16 workflows / 120 target actions captured.
- 2,240 workflow cells / 16,800 actions in each main pass.
- 28 family/condition cells, 600 evaluations each, in each summary table.
- 840 actual threshold trials: 210 per policy.
- **34,440 total evaluations**.
- Audit confirmation of counts, grading, all failed Pass B actions entering
  healing, gate constraints, latency aggregation, frozen-suite hash and hashes
  for every generated result file.

For a shorter rehearsal, use N=1 and a separate output folder:

```bash
pnpm benchmark:run --repetitions 1 --output-dir /tmp/waypoint-video-rehearsal
node scripts/verify-benchmark.mjs /tmp/waypoint-video-rehearsal
```

That is **6,720 main + 168 threshold = 6,888 evaluations**; do not label an N=1
screenshot as the final N=5 experiment. Latencies vary across runs and machines.
A fixture setup/navigation failure aborts a run. Exclude an aborted run from
empirical tables and rerun it; never count a setup timeout as a locator TN.

## Suggested 3–5 minute video sequence

1. Show git log, Node/pnpm versions and the metric/test summary (15–25 seconds).
2. Run a focused truth-isolation or ambiguity test; point out the pass and the
   tested safety claim (20–30 seconds).
3. Compare original, layout, content, semantic and unlabeled fixture URLs using
   DevTools; show the unchanged truth ID (45–60 seconds).
4. Run the six-case headed demo; show successful recovery, ambiguous refusal,
   the greedy wrong trusted click, and the default no-click result (60–90 seconds).
5. Open TECHNICAL-REPORT.md and the three empirical tables. State the sample
   sizes, denominator definitions and measured latency from this review run
   (40–60 seconds). The full matrix runs longer than this video; show its saved
   progress/output rather than claiming a filtered rehearsal is the full run.
6. Close with the independent artifact audit and the limits: fixed synthetic
   corpus, action-level trials, no truth-driven repair trigger, and no proof
   that the balanced thresholds are uniquely optimal on unseen sites (15–25 seconds).

Exact command outputs and run metadata are stored beside this guide. The original
published benchmark under docs/benchmark-results remains unchanged by this review.
