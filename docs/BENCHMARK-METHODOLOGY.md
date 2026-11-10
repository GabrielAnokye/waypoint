# Weeks 10–12 implementation and experimental protocol

## Phase 2: mutation engine and corpus

`apps/runner/src/core/mutation/mutators.ts` supports six deterministic conditions:
class hashing, ID/test-contract renaming, structural wrappers, CSS-only layout
translation, realistic copy changes, and accessibility degradation. Layout shifts
the outer document 80–250 pixels without changing interactive-element ancestry;
iframe content moves with its host rather than receiving a second translation.
Semantic mutation unlinks labels, strips explicit roles/names, and converts
buttons into focusable divs. Existing styles and click handlers are retained;
low-priority CSS supplies native-button defaults. These mutations are intended
for this fixture corpus, not as a general JavaScript source transformer.

Both mutations and unlabeled variants reach fixture-owned HTML template strings,
open shadow-root templates, and recursive iframe srcdoc documents. Template
interpolations are protected during AST serialization. ID lookups, including
computed IDs such as `step + i`, and class-based script references are rewritten
consistently with markup. Table elements keep valid ancestry; wrappers are
inserted around controls/containers rather than invalid wrappers around rows.

The immutability test audits all **177 source truth-ID declarations**, including
those in templates and srcdoc, across both variants and each mutation. Some
source declarations are templates that generate multiple runtime elements; 177
is not a claim that exactly 177 elements are simultaneously visible. Closed
shadow roots and dynamically hidden elements remain in the fixtures but are not
all part of the 120 evaluated actions.

## Phase 3: capture and canonical suite

`packages/shared-types/src/dom-snapshot.ts` is shared by extension capture and
browser candidate extraction. Accessible names and roles come from
`dom-accessibility-api`. Captured features include lowercase tag, role, name,
inner text, button value, placeholder, allowlisted stable attributes, up to four
nearest ancestor tags, element-sibling index, and viewport-center bounding box.
Legacy snapshot fields remain parseable. Attributes exclude truth IDs, test IDs,
IDs, event handlers and utility/hashed class tokens. A separate capture-only
function appends `expectedTruthId` for grading.

The compiler preserves snapshots, including inferred wait steps. The benchmark
captures each variant on its own unmutated page before any experimental trial.
The frozen suite is exported as `canonical-workflows.json`. Every action carries
four family-specific locators. An absent test contract is represented as missing,
not invented from the truth label. Intent uses role/name, then placeholder/text;
structural uses tag/nth-of-type paths, including direct shadow-host paths;
coordinates use recorded viewport centers. Capture validates structural
uniqueness. Ground truth is used during capture annotation, never playback
selection or candidate ranking.

| Fixture | Actions per variant | Both variants |
| --- | ---: | ---: |
| forms | 8 | 16 |
| tables | 8 | 16 |
| dropdowns | 8 | 16 |
| delayed | 7 | 14 |
| iframe | 7 | 14 |
| shadow-dom | 7 | 14 |
| spa | 8 | 16 |
| ambiguous | 7 | 14 |
| Total | 60 | 120 |

Actions include clicks, filling inputs/textareas, and selecting options. Repeated
native-select targets have different recorded values. Deterministic prerequisite
functions expose a menu, route, or disclosure state as necessary. Navigation and
prerequisites are not counted as target actions.

## Phase 4: scoring and confidence gates

`apps/runner/src/core/healer.ts` enumerates visible interactive candidates in the
recorded frame, with Playwright piercing open shadow roots. Feature extraction
has an explicit attribute allowlist; it never scans all HTML attributes. The
pure scorer does not access expected truth IDs or unknown attribute keys.

| Feature | Weight | Definition |
| --- | ---: | --- |
| Semantic | 0.35 | 0.43 × nonempty exact role match + 0.57 × normalized token Levenshtein of accessible name/label |
| Text | 0.25 | Maximum character Levenshtein/token Jaccard across inner text, button value, placeholder |
| Attributes | 0.20 | Jaccard of tag, type, name, href path, and stable class tokens |
| Structure | 0.10 | Half ancestor-tag-set Jaccard (nearest four), half `1/(1+abs(sibling difference))` |
| Position | 0.10 | `max(0,1-hypot(center delta)/500)` |

Two absent semantic/text strings score zero. Scores sort descending, then by DOM
candidate index for deterministic presentation. Index order never overrides the
ambiguity gate. With one candidate, S2 is zero; with none, recovery fails.

- Autonomous repair: S1 ≥ .75 and S1−S2 ≥ .15.
- Manual intervention: S1 ≥ .50 but either autonomous condition fails.
- Unrecoverable: S1 < .50.

A selected candidate receives a unique run-local locator marker only after the
ranking decision. This regenerated locator is persisted as JSON and used to
execute the original action; it does not rewrite the captured workflow.
Truth is read on the committed target for grading after selection. A unique
wrong original locator is still executed and graded as a false positive; its
truth label cannot trigger healing. Manual refusal never executes an action.

`element-action.ts` is the shared production/harness execution path. Missing and
ambiguous family-isolated locators use the same healer as normal playback.
Wait/assert steps can also heal when explicitly enabled. Manual refusals stop
retries, stop subsequent workflow actions, and persist step status
`needs_manual_intervention`; the enclosing run finishes failed with the
corresponding actionable error. Recovery is opt-in via the run request's
`healingEnabled` boolean (default false).

Migration **005_self_healing_telemetry** adds the seven requested SQLite columns.
Telemetry flows from launcher results/errors through run events and the run graph
to repository serialization. Defaults preserve pre-existing v4 history. Unit and
integration tests check migration upgrade/idempotence, round trips, gate bounds,
feature arithmetic, mutation recovery, safe refusal, removed targets, grading
isolation, and rate/latency denominators.

## Matrix protocol and reporting

The main matrix is **120 actions × 4 families × 7 conditions × 5 repetitions =
16,800 evaluations per pass**, or 33,600 for baseline and healing. Chromium is
headless with 1280×1000 viewport and zero deliberate slow motion. A new context
is created for each workflow/family/condition/repetition/pass; each action gets
fresh navigation and identical fixed prerequisite state. Recorded scroll is
restored, not re-aimed at a mutated target. There is no state carryover from a
failed preceding action. This measures independent action robustness, not
end-to-end workflow completion.

Each repetition uses a deterministic seed shared across families and passes.
The same fixed synthetic corpus is repeated; repetitions are not independent
websites and should not be treated as such in statistical claims. Four browser
workers are used by default. Timings include enumeration, extraction, ranking
and locator synthesis, exclude action execution, and reflect worker contention.
P95 is the nearest-rank percentile, and mean/P95 are computed from raw attempted
recovery latencies, not averages of rounded cell statistics.

Baseline TP/FP/TN rates divide by all evaluations. Healing recovery/wrong/manual/
unrecovered rates divide by attempted recoveries. Final TP/FP rates also include
original locators that survive. Incompatible coordinate targets are rejected
without action and may invoke healing. An execution error after an autonomous
proposal counts as unrecovered, retaining its error and telemetry in raw data.
Setup failures abort the experiment rather than being counted as locator TNs.

The threshold experiment adds **840 actual action trials**: three identical
Delete controls × two variants × seven conditions × five repetitions × four
policies. Locators are deliberately missing to isolate recovery. Policies are
greedy top-1, (.60,.05), (.75,.15), and (.85,.20). Repeated text does not guarantee
exactly zero margin because positional/structural terms can differ. The measured
results determine whether a policy produces wrong targets or safe refusals;
threshold superiority and general elimination of wrong clicks are not assumed.

## Reproduction

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm exec playwright test --config playwright.browser.config.ts --headed
pnpm benchmark:run
```

The browser regression suite includes trusted click-event grading, refusal,
family isolation, real recording/compilation, strict existing-tab selection, and
the native extension side-panel button. It is separate from the benchmark and
uses a dedicated test browser/runner.

The generated [benchmark report](benchmark-results/BENCHMARK-REPORT.md) contains
all 28 baseline cells, all 28 healing cells, labeling strata, mutation summaries,
and all threshold policies. Raw data and the frozen suite accompany the tables.
`manifest.json` records source commit, source-diff hash, suite hash, browser/Node
versions, timing, seeds, sample counts and SHA-256 hashes for every result file.
