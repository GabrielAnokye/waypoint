# Research Plan

## Research Question

How robust are different browser locator strategies to realistic webpage
changes, and can self-healing techniques improve the reliability of browser
automation?

## Independent Variable: Locator Strategy

Each workflow is executed once per strategy family, with the recorded step
restricted to locators from that family only:

- **Coordinate** — `coordinates`, resolved by hit-testing a viewport point.
- **Structural** — `css`, `xpath`, resolved against DOM shape and attributes.
- **Intent-based** — `role`, `label`, `text`, `testId`, `placeholder`, resolved
  against accessibility semantics and visible meaning.

Restricting to one family per run is what makes the comparison clean. A step
allowed to fall back across families would mask which family actually held up.

## Independent Variable: Mutation Class

Baseline fixture pages are mutated programmatically to simulate ordinary
front-end maintenance. Each mutation class is applied independently so its
effect can be attributed:

| Class | Example |
| --- | --- |
| Cosmetic | Rewrite CSS class names; restyle without moving anything |
| Attribute | Drop or rename `id`, `data-testid`, `name` |
| Structural | Insert wrapper `div`s; reorder siblings; change tag |
| Layout | Reflow so elements move position but keep identity |
| Content | Reword visible text and labels |
| Semantic | Remove or alter ARIA `role` / `aria-label` |

Note that the last class is adversarial to the intent-based family specifically.
Including it guards against a study that only tests mutations its favored
strategy is immune to.

## Dependent Variables

- **Step success rate** — step resolved to the correct element, unaided.
- **Workflow completion rate** — all steps succeeded end to end.
- **Recovery rate** — of steps that failed, the share repaired automatically.
- **Incorrect repair rate** — repairs that resolved to the *wrong* element.
  This is the critical safety metric: a confidently wrong repair is worse than
  an honest failure, because it silently corrupts the workflow.
- **Resolution latency** — added wall-clock cost per step, and per repair.

## Ground Truth

Measuring incorrect repairs requires knowing which element was *intended*. Each
interactive fixture element carries a stable identity attribute that the
mutation engine never rewrites and that no locator strategy is permitted to
read. After a step resolves, the resolved element's identity is compared against
the identity recorded at capture time:

- identities match → correct
- identities differ → incorrect repair
- nothing resolved → honest failure

Without this, "recovery rate" is unfalsifiable — a repair algorithm could score
100% by clicking any element it finds.

## Method

1. Author baseline fixture pages and workflows over them.
2. Record each workflow, capturing all locator families for every step.
3. For each (workflow x strategy family x mutation class), execute against the
   mutated page and log the outcome.
4. Repeat with self-healing enabled.
5. Report degradation curves per family, and the recovery / incorrect-repair
   tradeoff of the repair algorithm.

## Threats to Validity

- **Fixture realism.** Synthetic pages may not mutate the way production sites
  do. Mutation classes are drawn from observable real-world change patterns,
  but this remains the main limitation.
- **Ground-truth leakage.** If a locator strategy could read the identity
  attribute, results would be meaningless. Enforced by construction.
- **Selection effect in fixtures.** Pages authored by the same person building
  the intent-based resolver may be unusually well-labeled with ARIA, flattering
  that family. Fixtures therefore include poorly-labeled pages.
