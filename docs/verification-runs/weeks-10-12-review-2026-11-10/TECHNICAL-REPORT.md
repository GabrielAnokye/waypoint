# Weeks 10–12 technical verification report

Fresh verification of checkout `86d9c7b72f6f1a2fb3170f7146d9ae743aad33dc` on November 10, 2026.
Benchmark: **2026-11-10T18:43:11.267Z → 2026-11-10T18:55:32.235Z UTC**,
Chromium **153.0.8010.12**, Node **v25.9.0**,
pnpm **9.0.0**, viewport **1280×1000**, **4 workers**, **N=5**.
The measured source diff is empty. Review helpers/logs are new local artifacts;
tracked project source and the original published benchmark were preserved.

Start with [TEST-AND-VIDEO-GUIDE.md](TEST-AND-VIDEO-GUIDE.md) for exact commands,
expected results, fixture inspection, a six-case headed demo and video sequence.
This document contains the seven requested technical sections and the complete
captured outputs in section 7.

## 1. Commit log and repository scale

Chronological phase commits, from `git log --oneline --reverse ce8a4ef..HEAD`:

```text
9febe73 Complete six mutation classes and audit the 16-state corpus
b4aaa9a Add capture snapshots, weighted self-healing, and reproducible benchmark matrix
0ab0002 Recover incompatible targets and preserve candidate and slot identity
86d9c7b Publish verified N=5 benchmark data and Progress Report 4 handoff
```

- **9febe73 — Phase 2 completion.** Added layout/content/semantic mutations,
  unlabeled fixture mode and the full truth-declaration preservation audit.
  Purpose: complete six controlled perturbation classes without rewriting the
  grading oracle, and introduce weakly labeled page states.
- **b4aaa9a — Phases 3/4 and verification.** Added shared capture features and
  accessible-name computation, snapshot propagation through recording/compiler,
  the 16-workflow/120-action suite, weighted scorer and confidence gates,
  opt-in production healing, migration 005, event/run-graph/SQLite telemetry,
  both matrix passes, executed threshold sweep, reports and regression tests.
  Added dom-accessibility-api/esbuild and lockfile changes. Purpose: measure
  isolated families and actual repair outcomes on frozen baseline recordings.
- **0ab0002 — Empirical validation fixes.** Added action compatibility checks,
  preserved slots on structural wrappers, bound feature extraction to stable
  element handles and added independent artifact validation. Purpose: ensure
  unsupported fill/select hits do not bypass recovery, slotted controls remain
  rendered, and DOM insertion cannot redirect a lazy ordinal candidate locator.
- **86d9c7b — Empirical artifacts and handoff.** Published N=5 raw observations,
  canonical capture, 56 main summary cells, threshold results, hashes and the
  Progress Report 4 handoff. Purpose: make the measured claims inspectable.

| Metric | Exact value |
| --- | --- |
| Commits reachable from HEAD | 38 |
| Tracked files (`git ls-files -z`) | 170 |
| Tracked TS/TSX files | 89 |
| Non-test TS/TSX files | 60 |
| Non-test TS/TSX source lines, repository-wide | 13592 |
| Non-test TS/TSX lines in apps/ + packages/ | 13493 |
| Root TS configuration lines | 99 |
| Test TS/TSX lines | 5361 |
| Total tracked test files | 29 |
| Vitest files | 24 |
| Playwright specs | 5 |
| Passing Vitest tests | 253 |
| Passing API smoke tests (no-op launcher) | 7 |
| Passing real-browser tests | 13 |
| Distinct passing tests in this review | 273 |

Line counts are **physical lines, including comments and blank lines**, counted
with Python splitlines over git-tracked `.ts`/`.tsx` files. Tests are `.test.*`,
`.spec.*` or TS/TSX files under tests/. Generated dist/node_modules and untracked
review artifacts are excluded. The five Playwright specs are four API smoke
files (7 cases) plus one real-browser file (13 cases). **253**, not 273, is the
output of `pnpm test`; 273 combines the three separate suites. Benchmark
observations are not counted as passing unit tests. See repository-metrics.json
for the exact paths and metric snapshot.

## 2. Six-class mutation engine and 16-page corpus

The server parses comma-separated `mutation`/`mutations` parameters against
MUTATION_TYPES, applies `variant=unlabeled` **before** the requested mutations,
uses the supplied deterministic seed, and returns x-mutations-applied and
x-fixture-variant response headers. Eight base fixtures × two labeling variants
make 16 states; six mutations plus none make 112 condition/page states.

| Class/mode | Exact implementation and intended perturbation |
| --- | --- |
| cosmetic | Seeded SHA-256 class hashing; coordinated CSS selectors and fixture script class references |
| attribute | Seeded ID/test-ID renaming, label/ARIA reference updates, script ID lookups including computed IDs |
| structural | Div wrappers around button/input/select/textarea/fieldset/form; valid table ancestry retained; slot assignment copied to wrapper |
| layout | Injects body position:relative and top:Npx !important; N=80+(first 8 hex digits of SHA-256(layout:seed) modulo 171). Only the outer document is translated so iframe content does not receive a second shift. |
| content | Deterministic copy dictionary applied to text nodes outside script/style, placeholders, aria-label, title, and button/submit input values. Examples: Sign in → Log in to Account; Submit → Continue; Delete → Remove Item; Search → Filter records; Save → Apply Changes. |
| semantic | Strips aria-label, aria-labelledby and explicit role; converts label to span and removes for; converts button to div.btn-lookalike with tabindex=0; remaps CSS and supplies low-priority native-button defaults; retains click handlers and explicit submit behavior. |
| variant=unlabeled | Removes data-testid, aria-label and aria-labelledby from processed markup/templates; native labels/implicit roles remain. It does not add artificial contracts derived from truth. |

The parse5 pipeline reaches srcdoc recursively and fixture-owned HTML template
strings, including shadow-root/dynamic markup. `${...}` expressions are protected
while serializing HTML so conditional attributes remain executable JavaScript.
This is a fixture-specific transformer, not a general JavaScript parser.

Ground-truth audit results:

| Fixture | Source truth declarations |
| --- | --- |
| ambiguous.html | 23 |
| delayed.html | 36 |
| dropdowns.html | 12 |
| forms.html | 19 |
| iframe.html | 19 |
| shadow-dom.html | 19 |
| spa.html | 32 |
| tables.html | 17 |
| Total | 177 |

**112 transformed document checks**, including
both labeling variants and all seven conditions, preserved **2478
of 2478 compared anchor occurrences (100%)**, with
**0 changed**. The six-mutation cases account for 2,124 of these
comparisons; the two no-mutation variant cases account for 354.

177 is the number of source declarations, including templates and srcdoc. Some
expand into several runtime elements; this is not a claim that 177 interactive
controls are simultaneously visible. The canonical suite excludes closed-shadow
controls and evaluates 120 actions (60 per labeling variant). Mutation unit
suite: 25 passed. The live audit output is in corpus-audit-output.txt/json.

For the five benchmark seeds, layout offsets are **109, 133, 159, 101 and 135px**
respectively; `seed=demo` produces 231px. These are CSS translations, not changes
to interactive-element tag ancestry or names.

## 3. Self-healing architecture, migration and exact representative scores

`healer.ts` enumerates the recorded frame with:

```css
button,input:not([type="hidden"]),select,textarea,a[href],[role],[tabindex],[onclick]
```

Playwright pierces open shadow roots. Candidates must have nonzero bounding-box
width/height and computed display/visibility other than none/hidden; they need
not lie inside the viewport. Features are extracted from fixed ElementHandles,
which are released after the decision. A detached selected candidate fails
rather than reassigning its ordinal to another element. Ordinary action
compatibility checks reject unsupported fill types/values, missing select
options, disabled/read-only or invisible targets before acting.

Accessible names/roles use dom-accessibility-api. Feature extraction allowlists
type, name, href pathname and non-utility/non-hashed classes, plus tag/text/
geometry/structure. It does not scan arbitrary attributes or read data-truth-id.
Capture-only code appends expectedTruthId; pure scoring never reads that field.
Tests poison truth getters and make DOM truth reads throw during enumeration.

The exact function is:

$$S(e,s)=0.35\,\mathrm{sim}_{sem}+0.25\,\mathrm{sim}_{text}+0.20\,\mathrm{sim}_{attr}+0.10\,\mathrm{sim}_{struct}+0.10\,\mathrm{sim}_{pos}.$$

| Feature | Exact sub-score |
| --- | --- |
| Semantic | .43 × nonempty exact role match + .57 × normalized token-level Levenshtein on accessibleName, or labelText fallback |
| Text | Maximum normalized character Levenshtein or token Jaccard across trimmed innerText/textContent fallback, buttonValue and placeholder |
| Attributes | Jaccard over tagName, type, name, href pathname and stable class tokens; unknown keys and truth IDs cannot contribute |
| Structure | .5 × ancestor-tag-set Jaccard (nearest four tags) + .5/(1+absolute sibling-index difference) |
| Position | max(0,1−Euclidean center distance/500) |

Capture follows parentElement for the ancestor chain and parentElement.children
for sibling index; it stops at a shadow boundary and uses index 0 when no
parentElement exists. Bounding-box x/y store the viewport center.

Two absent semantic/text strings score zero. The exact role/name total weights
are .1505 and .1995 because the implemented semantic split is .43/.57; .15/.20
are rounded descriptions. Scores are capped at 1, sorted descending and then by
DOM candidate index. The regenerated selector is a unique run-local
`[data-waypoint-healed="UUID"]` marker assigned **after** ranking/gating. It is
persisted for diagnostics, not written back as a permanent workflow locator.
Truth is read only after committing to a target for grading; actual click-event
listeners in the review demo independently record the target and isTrusted.

| Tier | Exact gate | Effect |
| --- | --- | --- |
| autonomous_repair | At least one candidate, S1 ≥ .75 and S1−S2 ≥ .15 | Synthesize locator and execute original action |
| needs_manual_intervention | S1 ≥ .50 and autonomous conditions fail | Return top three score breakdowns, halt without action or retry |
| unrecoverable_failure | S1 < .50 (including no candidates) | LOCATOR_NOT_FOUND; existing API failure code is locator_not_found |

With one candidate S2=0. A low margin alone does not override the .50 floor:
S1<.50 remains unrecoverable. Manual intervention is an API/telemetry outcome and
persisted step status; no new interactive confirmation dialog was implemented.
Normal replay requires `healingEnabled:true` to opt in. Healthy chains do not
need healing. A unique wrong original locator is graded as wrong, not repaired
using oracle knowledge.

Migration **005_self_healing_telemetry** adds:

| SQLite column | Type/default |
| --- | --- |
| healing_attempted | INTEGER NOT NULL DEFAULT 0, CHECK 0/1 |
| healing_outcome | Nullable TEXT, CHECK autonomous_repair/needs_manual_intervention/unrecoverable_failure |
| healed_score | Nullable REAL |
| ambiguity_margin | Nullable REAL |
| regenerated_locator | Nullable TEXT containing locator JSON |
| top_candidates | Nullable TEXT containing top-three JSON |
| healing_latency_ms | Nullable REAL |

Results/errors flow through run events, buildRunGraph and repository mapping.
The 9 DB tests include v4 history upgrade, idempotence and telemetry round trips;
the executor test checks a manual halt executes once even with three retries.
The matrix writes JSON/CSV directly rather than inserting benchmark observations
into the application DB.

### Exact representative cases, measured live

| Fixture / expected target | Mutation / family | S1 | S2 | delta (raw IEEE-754) | Decision | Actual clicks |
| --- | --- | --- | --- | --- | --- | --- |
| forms.html / login-submit | attribute / testContract | 1 | 0.43675 | 0.56325 | autonomous_repair | 1 |
| ambiguous.html / delete-alpha | none / intent | 1 | 0.9846 | 0.01539999999999997 | needs_manual_intervention | 0 |
| ambiguous.html / delete-beta | none / intent | 1 | 0.9846 | 0.01539999999999997 | needs_manual_intervention | 0 |
| ambiguous.html / delete-gamma | none / intent | 1 | 0.9846 | 0.01539999999999997 | needs_manual_intervention | 0 |

For forms.html, the attribute mutation breaks the recorded test ID. Sign in
(index 3) scores **1** with all five feature scores equal to 1. Runner-up Register
(index 12) has semantic=.43, text=.125, attributes=1, structure=.55, position=0,
so S2=.1505+.03125+.20+.055 = **.43675**. Delta is **.56325**. A real trusted
click reached login-submit. This tests target selection, not successful form
submission past required-field validation.

For each original Delete target, its candidate scores 1; the nearest other
Delete is .9846 and delta is **.01539999999999997** (about .0154). The buttons
are 77px apart, so the next candidate's positional score is .846; all other
features are 1. Their margins are not zero. For Alpha/Gamma the far candidate
scores .9692000000000001; for Beta the other two tie at .9846. All three cases
return needs_manual_intervention with **zero actual clicks**.

Additional live video contrast: layout-shifted Beta with a deliberately missing
locator has S1=.9936, S2=.9782000000000001, delta=.01539999999999997. Greedy
executes a **trusted wrong click on delete-alpha**. The default uses the same
scores and refuses without a click. Complete feature breakdowns and actual
click evidence are in representative-cases.json; six screenshots accompany it.

## 4. Empirical table 1 — Pass A baseline survival and false positives

**120 actions × 4 families × 7 conditions × 5 repetitions = 16,800
evaluations**. Every row has 600 actions (120×5). Each family executes alone;
there is no cross-family fallback rescue and healing is disabled.

**Definition correction:** the implemented true_negative label means safe
non-execution/honest failure. It includes missing locators, ambiguous locators,
and missing/incompatible/invisible targets; it is **not restricted to count=0**.
Coordinate replay does not have a meaningful element-locator count. The table
below faithfully reports the harness labels rather than renaming them as a
zero-match-only measurement.

| Family | Condition | n | TP | FP | TN | TP % | FP % | TN % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| coordinate | none | 600 | 600 | 0 | 0 | 100.00 | 0.00 | 0.00 |
| coordinate | cosmetic | 600 | 600 | 0 | 0 | 100.00 | 0.00 | 0.00 |
| coordinate | attribute | 600 | 600 | 0 | 0 | 100.00 | 0.00 | 0.00 |
| coordinate | structural | 600 | 380 | 40 | 180 | 63.33 | 6.67 | 30.00 |
| coordinate | layout | 600 | 0 | 86 | 514 | 0.00 | 14.33 | 85.67 |
| coordinate | content | 600 | 600 | 0 | 0 | 100.00 | 0.00 | 0.00 |
| coordinate | semantic | 600 | 600 | 0 | 0 | 100.00 | 0.00 | 0.00 |
| structural | none | 600 | 600 | 0 | 0 | 100.00 | 0.00 | 0.00 |
| structural | cosmetic | 600 | 600 | 0 | 0 | 100.00 | 0.00 | 0.00 |
| structural | attribute | 600 | 600 | 0 | 0 | 100.00 | 0.00 | 0.00 |
| structural | structural | 600 | 30 | 10 | 560 | 5.00 | 1.67 | 93.33 |
| structural | layout | 600 | 600 | 0 | 0 | 100.00 | 0.00 | 0.00 |
| structural | content | 600 | 600 | 0 | 0 | 100.00 | 0.00 | 0.00 |
| structural | semantic | 600 | 270 | 0 | 330 | 45.00 | 0.00 | 55.00 |
| intent | none | 600 | 490 | 0 | 110 | 81.67 | 0.00 | 18.33 |
| intent | cosmetic | 600 | 490 | 0 | 110 | 81.67 | 0.00 | 18.33 |
| intent | attribute | 600 | 490 | 0 | 110 | 81.67 | 0.00 | 18.33 |
| intent | structural | 600 | 490 | 0 | 110 | 81.67 | 0.00 | 18.33 |
| intent | layout | 600 | 490 | 0 | 110 | 81.67 | 0.00 | 18.33 |
| intent | content | 600 | 340 | 0 | 260 | 56.67 | 0.00 | 43.33 |
| intent | semantic | 600 | 110 | 0 | 490 | 18.33 | 0.00 | 81.67 |
| testContract | none | 600 | 260 | 0 | 340 | 43.33 | 0.00 | 56.67 |
| testContract | cosmetic | 600 | 260 | 0 | 340 | 43.33 | 0.00 | 56.67 |
| testContract | attribute | 600 | 0 | 0 | 600 | 0.00 | 0.00 | 100.00 |
| testContract | structural | 600 | 260 | 0 | 340 | 43.33 | 0.00 | 56.67 |
| testContract | layout | 600 | 260 | 0 | 340 | 43.33 | 0.00 | 56.67 |
| testContract | content | 600 | 260 | 0 | 340 | 43.33 | 0.00 | 56.67 |
| testContract | semantic | 600 | 260 | 0 | 340 | 43.33 | 0.00 | 56.67 |

Overall: **11,140 TP (66.31%)**,
**136 FP (0.81%)**,
**5,524 TN (32.88%)**.

| Raw diagnostic category within TN | Count |
| --- | --- |
| Explicit ambiguous locator failure | 410 |
| Explicit zero-match locator-chain failure | 4420 |
| No visible/action-compatible target (includes coordinate misses) | 694 |

The raw format does not retain separate match counts for every coordinate/
compatibility failure, so a count=0-only rate cannot be reconstructed for those
cases. Intent's no-mutation failures include deliberately ambiguous controls;
contract failures include missing test IDs on poorly labeled variants. The
structural family uses tag/nth-of-type paths, so cosmetic class hashing does not
necessarily break it. These are measured properties of this corpus, not universal
rankings of locator families.

## 5. Empirical table 2 — Pass B recovery and safety

Pass B executes **16,800 actions** under the same conditions. "Broken"
is the number entering healing after observable resolution/action-compatibility
failure, not the entire cell and not a truth-driven label. Each rate below uses
that attempted-recovery count as denominator. Zero-attempt rows store zeros in
the implementation; they are not measurements of a failure to recover.

| Family | Condition | Broken | True recovery % | Wrong repair % | Manual % | Unrecovered % | Mean ms | P95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| coordinate | none | 0 | 0.00 | 0.00 | 0.00 | 0.00 | 0.000 | 0.000 |
| coordinate | cosmetic | 0 | 0.00 | 0.00 | 0.00 | 0.00 | 0.000 | 0.000 |
| coordinate | attribute | 0 | 0.00 | 0.00 | 0.00 | 0.00 | 0.000 | 0.000 |
| coordinate | structural | 180 | 44.44 | 0.00 | 55.56 | 0.00 | 44.678 | 54.730 |
| coordinate | layout | 514 | 70.82 | 0.00 | 29.18 | 0.00 | 48.168 | 67.903 |
| coordinate | content | 0 | 0.00 | 0.00 | 0.00 | 0.00 | 0.000 | 0.000 |
| coordinate | semantic | 0 | 0.00 | 0.00 | 0.00 | 0.00 | 0.000 | 0.000 |
| structural | none | 0 | 0.00 | 0.00 | 0.00 | 0.00 | 0.000 | 0.000 |
| structural | cosmetic | 0 | 0.00 | 0.00 | 0.00 | 0.00 | 0.000 | 0.000 |
| structural | attribute | 0 | 0.00 | 0.00 | 0.00 | 0.00 | 0.000 | 0.000 |
| structural | structural | 560 | 62.50 | 0.00 | 37.50 | 0.00 | 37.004 | 55.234 |
| structural | layout | 0 | 0.00 | 0.00 | 0.00 | 0.00 | 0.000 | 0.000 |
| structural | content | 0 | 0.00 | 0.00 | 0.00 | 0.00 | 0.000 | 0.000 |
| structural | semantic | 330 | 6.06 | 0.00 | 30.30 | 63.64 | 33.999 | 51.186 |
| intent | none | 110 | 0.00 | 0.00 | 100.00 | 0.00 | 36.490 | 46.937 |
| intent | cosmetic | 110 | 0.00 | 0.00 | 100.00 | 0.00 | 36.747 | 46.683 |
| intent | attribute | 110 | 0.00 | 0.00 | 100.00 | 0.00 | 37.529 | 47.082 |
| intent | structural | 110 | 0.00 | 0.00 | 100.00 | 0.00 | 36.642 | 48.014 |
| intent | layout | 110 | 0.00 | 0.00 | 100.00 | 0.00 | 36.595 | 47.925 |
| intent | content | 260 | 30.77 | 0.00 | 69.23 | 0.00 | 36.803 | 54.205 |
| intent | semantic | 490 | 20.41 | 0.00 | 36.73 | 42.86 | 38.213 | 57.323 |
| testContract | none | 340 | 69.12 | 0.00 | 30.88 | 0.00 | 36.387 | 52.035 |
| testContract | cosmetic | 340 | 66.18 | 0.00 | 33.82 | 0.00 | 37.093 | 55.161 |
| testContract | attribute | 600 | 75.00 | 0.00 | 25.00 | 0.00 | 37.205 | 54.306 |
| testContract | structural | 340 | 57.35 | 0.00 | 42.65 | 0.00 | 37.532 | 54.341 |
| testContract | layout | 340 | 61.76 | 0.00 | 38.24 | 0.00 | 36.649 | 54.548 |
| testContract | content | 340 | 58.82 | 0.00 | 41.18 | 0.00 | 36.875 | 57.086 |
| testContract | semantic | 340 | 29.41 | 0.00 | 39.71 | 30.88 | 37.367 | 54.428 |

Across **5,524 broken steps**:

| Outcome | Count | % of broken steps |
| --- | --- | --- |
| Correct autonomous recovery | 2609 | 47.23 |
| Wrong autonomous repair | 0 | 0.00 |
| Safe manual intervention | 2390 | 43.27 |
| Unrecovered | 525 | 9.50 |

Mean = **38.205ms**; P95 = **56.184ms**. These are computed directly
from all 5,524 raw attempted-recovery latencies, not by averaging cell
percentiles. P95 uses nearest rank ceil(.95×n). Timing starts inside heal(),
includes enumeration, extraction, ranking, locator synthesis and handle disposal,
and excludes page setup, compatibility preflight and action execution. It
reflects four-worker contention and is specific to this run.

The summarizer can classify an execution error after a proposed autonomous repair
as unrecovered. In this run, **0** unrecovered observations
fall outside the strict S1<.50 / unrecoverable_failure tier; this distinction was
checked from raw data rather than assumed.

| Final action metric | Pass A | Pass B |
| --- | --- | --- |
| Correct actions | 11,140 (66.31%) | 13,749 (81.84%) |
| Wrong-target actions | 136 (0.81%) | 136 (0.81%) |
| Failures/refusals | 5,524 (32.88%) | 2,915 (17.35%) |

Correct-action rate improves **15.53
percentage points**. Zero wrong repairs does **not** mean zero wrong actions:
136 unique wrong original locators still execute. Using their
grading labels to trigger healing would violate oracle isolation.

## 6. Empirical table 3 — threshold sensitivity sweep

The sweep forces a missing locator on Delete Alpha/Beta/Gamma on both labeling
variants under all seven conditions and five repetitions. It executes actual
autonomous actions: **3×2×7×5=210 trials per policy**, 840 total. It does not sweep
every possible broken action across the complete corpus.

| Policy | theta | min delta | n | Correct | Wrong | Recovery % | Wrong-target % | Manual % | Unrecovered % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Greedy Top-1 | 0.00 | 0.00 | 210 | 190 | 20 | 90.48 | 9.52 | 0.00 | 0.00 |
| Permissive | 0.60 | 0.05 | 210 | 0 | 0 | 0.00 | 0.00 | 100.00 | 0.00 |
| Balanced / Waypoint default | 0.75 | 0.15 | 210 | 0 | 0 | 0.00 | 0.00 | 100.00 | 0.00 |
| Strict / conservative | 0.85 | 0.20 | 210 | 0 | 0 | 0.00 | 0.00 | 100.00 | 0.00 |

Greedy's 20 wrong clicks show the cost of selecting a top candidate despite a
small margin. All three gated policies refused all ambiguous trials safely,
including some greedy choices that would have been correct. This supports the
safety/coverage tradeoff on these fixtures. It **does not establish .75/.15 as
uniquely optimal**, because .60/.05 also produced zero wrong repairs here.
Identical label text does not imply delta=0 when position is a scoring feature.

## 7. Real code excerpts, implementation challenges and verification outputs

### Three short source excerpts

From apps/runner/src/core/healer.ts (weighted score):

```typescript
    score: Math.min(
      1,
      0.35 * semantic +
        0.25 * text +
        0.2 * attributes +
        0.1 * structural +
        0.1 * position
    ),
```

From healer.ts (the actual tier policy):

```typescript
  const best = ranked[0]?.score ?? 0;
  const margin = Math.max(0, best - (ranked[1]?.score ?? 0));
  return {
    healingAttempted: true,
    healedScore: best,
    ambiguityMargin: margin,
    healingOutcome:
      ranked.length && best >= thresholds.score && margin >= thresholds.margin
        ? 'autonomous_repair'
        : best >= 0.5
          ? 'needs_manual_intervention'
          : 'unrecoverable_failure',
```

From apps/runner/src/core/mutation/mutators.ts (CSS-only layout shift):

```typescript
export function mutateLayout(html: string, options: MutatorOptions = {}): string {
  const offset = 80 + (parseInt(hashValue('layout', options.seed), 16) % 171);
  return html.replace(
    /<head[^>]*>/i,
    (match) =>
      `${match}<style data-mutation="layout">body { position: relative; top: ${offset}px !important; } </style>`
  );
}
```

### Three actual implementation challenges

1. **Nested and generated markup could escape mutation or become invalid.**
   Fixtures put targets in srcdoc, shadow-root template strings and dynamic table
   markup. Parsing an unprotected `${...}` conditional attribute corrupts the
   template; renaming IDs without fixing `getElementById('step'+i)` breaks the
   fixture rather than only its locator. The solution recursively processes
   markup, protects interpolation expressions, and updates controlled script
   references with the same ID/class maps. The 177-declaration audit and live
   page-state checks verify the result.
2. **A resolved coordinate hit might not support the action; wrapping could hide
   a slotted button.** Initial validation found unsupported fill/select hits
   that never entered healing and a wrapper that removed content from its named
   slot. The solution checks action type/value/options before execution and
   copies slot assignment onto structural wrappers. Regression tests cover both;
   the final artifact audit rejects a failed Pass B action that bypassed healing.
3. **High similarity is not uniqueness, and an ordinal candidate can move.**
   Three Delete controls can all score highly; greedy selection produced wrong
   trusted clicks after layout shift. Margin gating halts safely, truth IDs are
   excluded with allowlisted features and poisoned-read tests, and fixed element
   handles prevent insertion before a candidate from changing its identity.
   The manual-halt executor test also prevents retries or later actions.

### Verification command results

| Command | Observed result | Meaning |
| --- | --- | --- |
| pnpm test | 253 | 24 Vitest files; real Chromium integration included |
| pnpm typecheck | exit 0 | No diagnostics |
| pnpm lint | exit 0 | No diagnostics after review-helper import correction |
| pnpm build | exit 0 | Packages, extension and runner built |
| pnpm exec playwright test --config <review API config> | 7 passed | In-memory SQLite; no-op launcher; 4 files |
| pnpm exec playwright test --config playwright.browser.config.ts --headed | 13 passed | Real browser; 0 skipped; 49.3s |
| pnpm benchmark:run --output-dir <review>/benchmark-results | 34440 | N=5; 33,600 main + 840 threshold observations |
| node scripts/verify-benchmark.mjs <review>/benchmark-results | exit 0 | Independent counts, grading, coverage, gates, statistics and hashes |

The run used a separate output directory to preserve the original published
benchmark. The successful long benchmark invocation was wrapped with macOS
`caffeinate -i` to keep the host awake; N=5, workers=4 and all scoring/mutation
settings were unchanged. The exact argv, UTC start/end, exit status and process
duration are in execution.json.

Two diagnostic failures are retained rather than hidden:

- The first lint attempt saw a missing explicit process import in this review's
  new API-server helper. The helper was corrected and full lint rerun successfully;
  no tracked project source was changed. See pnpm-lint-initial-helper-error.txt.
- The first matrix attempt aborted at a local fixture navigation timeout before
  completing Pass A. Its output was excluded from all empirical tables. The full
  retry completed and passed the independent audit. See
  pnpm-benchmark-run-attempt1-timeout.txt.

### Exact captured terminal outputs

The following four transcripts are the complete saved stdout/stderr, not
reconstructed summaries. The corresponding .txt files are the authoritative
unmodified captures (including any terminal escape bytes). Only the benchmark's
output-directory flag and the process-scoped awake wrapper differ from the bare
command; the benchmark algorithm and default matrix are identical.

#### pnpm test

Raw log: [pnpm-test.txt](pnpm-test.txt)

```text

> waypoint@ test /Users/gabrielanokye/Senior Seminar/waypoint
> corepack pnpm build:packages && vitest run


> waypoint@ build:packages /Users/gabrielanokye/Senior Seminar/waypoint
> corepack pnpm -r --filter "./packages/*" build

Scope: 6 of 10 workspace projects
packages/shared-types build$ tsc -b
packages/logger build$ tsc -b
packages/ui build$ tsc -b
packages/shared-types build: Done
packages/ui build: Done
packages/logger build: Done
packages/bridge-protocol build$ tsc -b
packages/db build$ tsc -b
packages/compiler build$ tsc -b
packages/db build: Done
packages/compiler build: Done
packages/bridge-protocol build: Done

 RUN  v2.1.9 /Users/gabrielanokye/Senior Seminar/waypoint

 ✓ apps/extension/src/hooks/useUndoRedo.test.ts (11 tests) 4ms
 ✓ apps/runner/src/core/locate.test.ts (24 tests) 8ms
 ✓ packages/shared-types/src/index.test.ts (24 tests) 9ms
 ✓ packages/compiler/src/index.test.ts (17 tests) 10ms
 ✓ apps/runner/src/core/executor.test.ts (15 tests) 8ms
 ✓ apps/runner/src/core/playwright-launcher.test.ts (9 tests) 14ms
 ✓ packages/db/src/index.test.ts (9 tests) 72ms
 ✓ apps/runner/src/core/debug-browser.test.ts (16 tests) 15ms
 ✓ apps/extension/src/recorder/event-buffer.test.ts (4 tests) 15ms
 ✓ apps/bridge-host/src/framing.test.ts (7 tests) 5ms
 ✓ apps/runner/src/core/mutation/mutators.test.ts (25 tests) 477ms
 ✓ apps/extension/src/attached-target.test.ts (5 tests) 9ms
 ✓ apps/bridge-host/src/dispatcher.test.ts (5 tests) 55ms
 ✓ apps/extension/src/scheduler.test.ts (5 tests) 41ms
 ✓ packages/bridge-protocol/src/index.test.ts (9 tests) 6ms
 ✓ apps/runner/src/app.test.ts (30 tests) 462ms
 ✓ apps/extension/src/recorder/selector.test.ts (5 tests) 3ms
 ✓ apps/extension/src/recordable-url.test.ts (4 tests) 3ms
 ✓ packages/logger/src/index.test.ts (1 test) 4ms
 ✓ apps/extension/src/env.test.ts (1 test) 3ms
 ✓ packages/ui/src/index.test.tsx (1 test) 7ms
 ✓ apps/extension/src/recorder/redact.test.ts (5 tests) 2ms
 ✓ apps/runner/src/core/benchmark/runner.test.ts (2 tests) 3ms
 ✓ apps/runner/src/core/healer.test.ts (19 tests) 12949ms
   ✓ real Chromium healing integration > records 16 workflows / 120 steps with all four families and complete snapshots 8175ms
   ✓ real Chromium healing integration > keeps generated table controls, iframe controls and open shadow controls present in all 16×7 states 3443ms

 Test Files  24 passed (24)
      Tests  253 passed (253)
   Start at  11:30:45
   Duration  13.80s (transform 993ms, setup 0ms, collect 3.10s, tests 14.19s, environment 4ms, prepare 2.09s)
```

#### pnpm typecheck

Raw log: [pnpm-typecheck.txt](pnpm-typecheck.txt)

```text

> waypoint@ typecheck /Users/gabrielanokye/Senior Seminar/waypoint
> tsc -b --pretty false
```

#### pnpm lint

Raw log: [pnpm-lint.txt](pnpm-lint.txt)

```text

> waypoint@ lint /Users/gabrielanokye/Senior Seminar/waypoint
> eslint .
```

#### pnpm benchmark:run --output-dir docs/verification-runs/weeks-10-12-review-2026-11-10/benchmark-results

Raw log: [pnpm-benchmark-run.txt](pnpm-benchmark-run.txt)

````text

> waypoint@ benchmark:run /Users/gabrielanokye/Senior Seminar/waypoint
> corepack pnpm build:packages && tsx apps/runner/src/core/benchmark/runner.ts "--output-dir" "docs/verification-runs/weeks-10-12-review-2026-11-10/benchmark-results"


> waypoint@ build:packages /Users/gabrielanokye/Senior Seminar/waypoint
> corepack pnpm -r --filter "./packages/*" build

Scope: 6 of 10 workspace projects
packages/logger build$ tsc -b
packages/shared-types build$ tsc -b
packages/ui build$ tsc -b
packages/ui build: Done
packages/shared-types build: Done
packages/logger build: Done
packages/compiler build$ tsc -b
packages/db build$ tsc -b
packages/bridge-protocol build$ tsc -b
packages/db build: Done
packages/compiler build: Done
packages/bridge-protocol build: Done
Capturing 16 workflows / 120 steps at 1280×1000; 5 repetitions, 4 workers.
Capture verified. Starting baseline and healing passes.
Pass A: 112/2240 workflow cells; 840 step evaluations
Pass A: 224/2240 workflow cells; 1680 step evaluations
Pass A: 336/2240 workflow cells; 2520 step evaluations
Pass A: 448/2240 workflow cells; 3360 step evaluations
Pass A: 560/2240 workflow cells; 4200 step evaluations
Pass A: 672/2240 workflow cells; 5040 step evaluations
Pass A: 784/2240 workflow cells; 5880 step evaluations
Pass A: 896/2240 workflow cells; 6720 step evaluations
Pass A: 1008/2240 workflow cells; 7560 step evaluations
Pass A: 1120/2240 workflow cells; 8400 step evaluations
Pass A: 1232/2240 workflow cells; 9240 step evaluations
Pass A: 1344/2240 workflow cells; 10080 step evaluations
Pass A: 1456/2240 workflow cells; 10920 step evaluations
Pass A: 1568/2240 workflow cells; 11760 step evaluations
Pass A: 1680/2240 workflow cells; 12600 step evaluations
Pass A: 1792/2240 workflow cells; 13440 step evaluations
Pass A: 1904/2240 workflow cells; 14280 step evaluations
Pass A: 2016/2240 workflow cells; 15120 step evaluations
Pass A: 2128/2240 workflow cells; 15960 step evaluations
Pass A: 2240/2240 workflow cells; 16800 step evaluations
Pass B: 112/2240 workflow cells; 840 step evaluations
Pass B: 224/2240 workflow cells; 1680 step evaluations
Pass B: 336/2240 workflow cells; 2520 step evaluations
Pass B: 448/2240 workflow cells; 3360 step evaluations
Pass B: 560/2240 workflow cells; 4200 step evaluations
Pass B: 672/2240 workflow cells; 5040 step evaluations
Pass B: 784/2240 workflow cells; 5880 step evaluations
Pass B: 896/2240 workflow cells; 6720 step evaluations
Pass B: 1008/2240 workflow cells; 7560 step evaluations
Pass B: 1120/2240 workflow cells; 8400 step evaluations
Pass B: 1232/2240 workflow cells; 9240 step evaluations
Pass B: 1344/2240 workflow cells; 10080 step evaluations
Pass B: 1456/2240 workflow cells; 10920 step evaluations
Pass B: 1568/2240 workflow cells; 11760 step evaluations
Pass B: 1680/2240 workflow cells; 12600 step evaluations
Pass B: 1792/2240 workflow cells; 13440 step evaluations
Pass B: 1904/2240 workflow cells; 14280 step evaluations
Pass B: 2016/2240 workflow cells; 15120 step evaluations
Pass B: 2128/2240 workflow cells; 15960 step evaluations
Pass B: 2240/2240 workflow cells; 16800 step evaluations
Running actual action threshold sweep on the three ambiguous Delete targets.
# Waypoint empirical benchmark — Weeks 10–12

Measured 2026-11-10T18:55:32.235Z. 16,800 evaluations per pass; 33,600 main evaluations. N=5. Chromium 153.0.8010.12, Node v25.9.0, viewport 1280×1000, 4 workers.

## Method and denominators

Independent action trials: fresh navigation and fixed prerequisite state per recorded step; fresh context per workflow/family/condition/repetition/pass. No truth-based healing trigger. Threshold sweep forces missing locators on three Delete targets and executes autonomous decisions.

The 120 recorded target actions span 16 page/label states. They are independent action trials, not end-to-end workflow success claims. Navigation and deterministic prerequisite setup are excluded from the 120 target actions. Baseline capture uses truth IDs for annotation only; playback/scoring never selects by truth. All four families are captured on each step, with a deliberately missing test contract when the page has none. This prevents inventing labels on poorly labeled pages. Structural paths use tag/nth-of-type and shadow-host paths; coordinates are absolute viewport positions recorded before mutation with recorded scroll restored. Candidate positions are frame-local viewport centers. Closed shadow roots are excluded from the canonical actions because ordinary Playwright cannot inspect them.

Each repetition uses its own deterministic mutation seed shared across A/B and all families. Repetitions are repeated trials on a fixed synthetic corpus, not independent websites. Timing includes candidate enumeration, feature extraction, ranking and locator synthesis, excludes action execution, and is measured under 4-worker contention.

Baseline TP/FP/TN percentages use all evaluations as denominator. Healing percentages use only attempted recoveries (missing or ambiguous locators); raw wrong-target baseline actions do not trigger healing because doing so would leak grading information. An action error after a proposed repair counts as unrecovered. Safe refusals are TN, never FP. Final TP/FP percentages include surviving baseline actions. Threshold sweep uses the three Delete targets, both variants, all seven conditions and repetitions, forcing missing locators; every autonomous decision executes a real action. No claim that thresholds eliminate wrong targets on arbitrary websites follows from this corpus.

## Baseline degradation: all 28 cells

| Family | Mutation | n | TP | FP | TN | TP % | FP % | TN % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| coordinate | none | 600 | 600 | 0 | 0 | 100 | 0 | 0 |
| coordinate | cosmetic | 600 | 600 | 0 | 0 | 100 | 0 | 0 |
| coordinate | attribute | 600 | 600 | 0 | 0 | 100 | 0 | 0 |
| coordinate | structural | 600 | 380 | 40 | 180 | 63.33 | 6.67 | 30 |
| coordinate | layout | 600 | 0 | 86 | 514 | 0 | 14.33 | 85.67 |
| coordinate | content | 600 | 600 | 0 | 0 | 100 | 0 | 0 |
| coordinate | semantic | 600 | 600 | 0 | 0 | 100 | 0 | 0 |
| structural | none | 600 | 600 | 0 | 0 | 100 | 0 | 0 |
| structural | cosmetic | 600 | 600 | 0 | 0 | 100 | 0 | 0 |
| structural | attribute | 600 | 600 | 0 | 0 | 100 | 0 | 0 |
| structural | structural | 600 | 30 | 10 | 560 | 5 | 1.67 | 93.33 |
| structural | layout | 600 | 600 | 0 | 0 | 100 | 0 | 0 |
| structural | content | 600 | 600 | 0 | 0 | 100 | 0 | 0 |
| structural | semantic | 600 | 270 | 0 | 330 | 45 | 0 | 55 |
| intent | none | 600 | 490 | 0 | 110 | 81.67 | 0 | 18.33 |
| intent | cosmetic | 600 | 490 | 0 | 110 | 81.67 | 0 | 18.33 |
| intent | attribute | 600 | 490 | 0 | 110 | 81.67 | 0 | 18.33 |
| intent | structural | 600 | 490 | 0 | 110 | 81.67 | 0 | 18.33 |
| intent | layout | 600 | 490 | 0 | 110 | 81.67 | 0 | 18.33 |
| intent | content | 600 | 340 | 0 | 260 | 56.67 | 0 | 43.33 |
| intent | semantic | 600 | 110 | 0 | 490 | 18.33 | 0 | 81.67 |
| testContract | none | 600 | 260 | 0 | 340 | 43.33 | 0 | 56.67 |
| testContract | cosmetic | 600 | 260 | 0 | 340 | 43.33 | 0 | 56.67 |
| testContract | attribute | 600 | 0 | 0 | 600 | 0 | 0 | 100 |
| testContract | structural | 600 | 260 | 0 | 340 | 43.33 | 0 | 56.67 |
| testContract | layout | 600 | 260 | 0 | 340 | 43.33 | 0 | 56.67 |
| testContract | content | 600 | 260 | 0 | 340 | 43.33 | 0 | 56.67 |
| testContract | semantic | 600 | 260 | 0 | 340 | 43.33 | 0 | 56.67 |

Overall: TP 11140 (66.31%), FP 136 (0.81%), TN 5524 (32.88%).

## Labeling stratification (all conditions)

| Variant | Family | n | TP % | FP % | TN % |
| --- | --- | --- | --- | --- | --- |
| labeled | coordinate | 2100 | 80.48 | 3 | 16.52 |
| labeled | structural | 2100 | 78.57 | 0.24 | 21.19 |
| labeled | intent | 2100 | 69.05 | 0 | 30.95 |
| labeled | testContract | 2100 | 74.29 | 0 | 25.71 |
| unlabeled | coordinate | 2100 | 80.48 | 3 | 16.52 |
| unlabeled | structural | 2100 | 78.57 | 0.24 | 21.19 |
| unlabeled | intent | 2100 | 69.05 | 0 | 30.95 |
| unlabeled | testContract | 2100 | 0 | 0 | 100 |

## Self-healing: all 28 cells

| Family | Mutation | Attempted | Correct | Wrong | Manual | Unrecovered | Recovery % | Wrong % | Manual % | Unrecovered % | Mean ms | P95 ms | Final TP % | Final FP % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| coordinate | none | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| coordinate | cosmetic | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| coordinate | attribute | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| coordinate | structural | 180 | 80 | 0 | 100 | 0 | 44.44 | 0 | 55.56 | 0 | 44.678 | 54.73 | 76.67 | 6.67 |
| coordinate | layout | 514 | 364 | 0 | 150 | 0 | 70.82 | 0 | 29.18 | 0 | 48.168 | 67.903 | 60.67 | 14.33 |
| coordinate | content | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| coordinate | semantic | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| structural | none | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| structural | cosmetic | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| structural | attribute | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| structural | structural | 560 | 350 | 0 | 210 | 0 | 62.5 | 0 | 37.5 | 0 | 37.004 | 55.234 | 63.33 | 1.67 |
| structural | layout | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| structural | content | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| structural | semantic | 330 | 20 | 0 | 100 | 210 | 6.06 | 0 | 30.3 | 63.64 | 33.999 | 51.186 | 48.33 | 0 |
| intent | none | 110 | 0 | 0 | 110 | 0 | 0 | 0 | 100 | 0 | 36.49 | 46.937 | 81.67 | 0 |
| intent | cosmetic | 110 | 0 | 0 | 110 | 0 | 0 | 0 | 100 | 0 | 36.747 | 46.683 | 81.67 | 0 |
| intent | attribute | 110 | 0 | 0 | 110 | 0 | 0 | 0 | 100 | 0 | 37.529 | 47.082 | 81.67 | 0 |
| intent | structural | 110 | 0 | 0 | 110 | 0 | 0 | 0 | 100 | 0 | 36.642 | 48.014 | 81.67 | 0 |
| intent | layout | 110 | 0 | 0 | 110 | 0 | 0 | 0 | 100 | 0 | 36.595 | 47.925 | 81.67 | 0 |
| intent | content | 260 | 80 | 0 | 180 | 0 | 30.77 | 0 | 69.23 | 0 | 36.803 | 54.205 | 70 | 0 |
| intent | semantic | 490 | 100 | 0 | 180 | 210 | 20.41 | 0 | 36.73 | 42.86 | 38.213 | 57.323 | 35 | 0 |
| testContract | none | 340 | 235 | 0 | 105 | 0 | 69.12 | 0 | 30.88 | 0 | 36.387 | 52.035 | 82.5 | 0 |
| testContract | cosmetic | 340 | 225 | 0 | 115 | 0 | 66.18 | 0 | 33.82 | 0 | 37.093 | 55.161 | 80.83 | 0 |
| testContract | attribute | 600 | 450 | 0 | 150 | 0 | 75 | 0 | 25 | 0 | 37.205 | 54.306 | 75 | 0 |
| testContract | structural | 340 | 195 | 0 | 145 | 0 | 57.35 | 0 | 42.65 | 0 | 37.532 | 54.341 | 75.83 | 0 |
| testContract | layout | 340 | 210 | 0 | 130 | 0 | 61.76 | 0 | 38.24 | 0 | 36.649 | 54.548 | 78.33 | 0 |
| testContract | content | 340 | 200 | 0 | 140 | 0 | 58.82 | 0 | 41.18 | 0 | 36.875 | 57.086 | 76.67 | 0 |
| testContract | semantic | 340 | 100 | 0 | 135 | 105 | 29.41 | 0 | 39.71 | 30.88 | 37.367 | 54.428 | 60 | 0 |

Overall: 5524 healing attempts; 2609 correct, 0 wrong, 2390 manual, 525 unrecovered. Mean 38.205 ms; P95 56.184 ms. Final TP 81.84%; final FP 0.81%.

## Recovery by mutation (all families)

| Mutation | Attempted | Recovery % | Wrong % | Manual % | Unrecovered % | Mean ms | P95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| none | 450 | 52.22 | 0 | 47.78 | 0 | 36.412 | 51.893 |
| cosmetic | 450 | 50 | 0 | 50 | 0 | 37.008 | 53.258 |
| attribute | 710 | 63.38 | 0 | 36.62 | 0 | 37.255 | 54.012 |
| structural | 1190 | 52.52 | 0 | 47.48 | 0 | 38.282 | 54.452 |
| layout | 964 | 59.54 | 0 | 40.46 | 0 | 42.784 | 65.085 |
| content | 600 | 46.67 | 0 | 53.33 | 0 | 36.844 | 55.72 |
| semantic | 1160 | 18.97 | 0 | 35.78 | 45.26 | 36.766 | 55.119 |

## Threshold sensitivity: executed ambiguous Delete trials

| Policy | n | Correct | Wrong | Manual | Unrecovered | Recovery % | Wrong % | Manual % | Mean ms | P95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| greedy_top1 | 210 | 190 | 20 | 0 | 0 | 90.48 | 9.52 | 0 | 41.749 | 55.301 |
| permissive_060_005 | 210 | 0 | 0 | 210 | 0 | 0 | 0 | 100 | 46.264 | 63.125 |
| chosen_075_015 | 210 | 0 | 0 | 210 | 0 | 0 | 0 | 100 | 45.741 | 62.326 |
| conservative_085_020 | 210 | 0 | 0 | 210 | 0 | 0 | 0 | 100 | 45.509 | 62.294 |

Identical text does not imply a mathematically zero margin: the specified position and structural terms may separate otherwise identical buttons. The observed margins, scores, outcomes, and grading labels are retained in threshold-raw.json.

## Baseline survival chart

```text
coordinate    ########################################           80.48%
structural    #######################################            78.57%
intent        ###################################                69.05%
testContract  ###################                                37.14%
```

## Audit artifacts

- canonical-workflows.json: frozen baseline features, four locator families, grading annotations and fixed setup.
- baseline-raw.json / self-healing-raw.json: all 16800 observations per pass, including errors and telemetry.
- threshold-raw.json: all 840 actual threshold-sweep observations.
- baseline-degradation.json/csv and self-healing-results.json/csv: all 28 cells.
- threshold-sensitivity.csv: all four policies.
- manifest.json: provenance and SHA-256 hashes.
````

#### Independent artifact audit

```text
Verified 33600 main observations, 840 threshold trials, 56 summary cells, 16 workflows, 120 capture snapshots, gate constraints, grading, latency statistics, and all file hashes.
```

### Reproduction and interpretation boundaries

- The unit is a target action, with fresh navigation and deterministic
  prerequisites, not an end-to-end workflow. Navigation/setup are outside the
  120 target actions. There are 16 workflows/label states, not 16×120 steps.
- Each repetition uses a distinct deterministic mutation seed shared across
  passes/families; content/semantic transformations can still be identical
  across seeds. Five repetitions of a fixed synthetic corpus are not five
  independently sampled websites.
- Poorly labeled variants intentionally lack some locator-family coverage;
  absent contracts are not invented from truth metadata. Closed roots remain
  in fixtures but are excluded from canonical actions.
- Correct repair, manual refusal and unrecoverable failure have separate
  denominators from final action rates. An unmodified but unique wrong locator
  cannot be detected using a hidden grading oracle.
- Timing is run-specific. Raw latency samples, rounded summary statistics,
  browser/Node versions, source commit, seeds, suite hash and artifact hashes
  are all saved under benchmark-results/manifest.json and the raw JSON files.
- The matrix validates target identity. A correct Sign in click is not evidence
  that form validation or an external login business process completed.

For the recording sequence and all expected pass/fail checks, use
[TEST-AND-VIDEO-GUIDE.md](TEST-AND-VIDEO-GUIDE.md). Full CSV/JSON tables,
raw observations, screenshots, representative scores and terminal transcripts
are stored in this review directory. The original docs/benchmark-results run
remains the previously published empirical artifact.

### Published run versus this fresh verification

All 28 baseline rows and all 28 healing rows match the previously published
categorical counts/rates exactly. Timings are fresh measurements: the original
run reported mean **30.901ms**, P95 **45.752ms**; this review reports mean
**38.205ms**, P95 **56.184ms**. Use one identified run consistently in the written
report rather than mixing its rates with unlabeled latency measurements. The
original published data remain under docs/benchmark-results; this review's
manifest identifies checkout 86d9c7b and its own start/end times and hashes.
