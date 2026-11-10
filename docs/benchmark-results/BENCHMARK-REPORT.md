# Waypoint empirical benchmark — Weeks 10–12

Measured 2026-11-10T14:37:13.958Z. 16,800 evaluations per pass; 33,600 main evaluations. N=5. Chromium 153.0.8010.12, Node v25.9.0, viewport 1280×1000, 4 workers.

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
| coordinate | structural | 180 | 80 | 0 | 100 | 0 | 44.44 | 0 | 55.56 | 0 | 37.745 | 49.633 | 76.67 | 6.67 |
| coordinate | layout | 514 | 364 | 0 | 150 | 0 | 70.82 | 0 | 29.18 | 0 | 39.897 | 55.073 | 60.67 | 14.33 |
| coordinate | content | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| coordinate | semantic | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| structural | none | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| structural | cosmetic | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| structural | attribute | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| structural | structural | 560 | 350 | 0 | 210 | 0 | 62.5 | 0 | 37.5 | 0 | 29.324 | 44.257 | 63.33 | 1.67 |
| structural | layout | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| structural | content | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 0 |
| structural | semantic | 330 | 20 | 0 | 100 | 210 | 6.06 | 0 | 30.3 | 63.64 | 28.105 | 42.426 | 48.33 | 0 |
| intent | none | 110 | 0 | 0 | 110 | 0 | 0 | 0 | 100 | 0 | 28.243 | 36.458 | 81.67 | 0 |
| intent | cosmetic | 110 | 0 | 0 | 110 | 0 | 0 | 0 | 100 | 0 | 30.161 | 41.342 | 81.67 | 0 |
| intent | attribute | 110 | 0 | 0 | 110 | 0 | 0 | 0 | 100 | 0 | 30.313 | 40.59 | 81.67 | 0 |
| intent | structural | 110 | 0 | 0 | 110 | 0 | 0 | 0 | 100 | 0 | 29.332 | 38.555 | 81.67 | 0 |
| intent | layout | 110 | 0 | 0 | 110 | 0 | 0 | 0 | 100 | 0 | 29.196 | 38.74 | 81.67 | 0 |
| intent | content | 260 | 80 | 0 | 180 | 0 | 30.77 | 0 | 69.23 | 0 | 28.505 | 39.958 | 70 | 0 |
| intent | semantic | 490 | 100 | 0 | 180 | 210 | 20.41 | 0 | 36.73 | 42.86 | 30.909 | 46.418 | 35 | 0 |
| testContract | none | 340 | 235 | 0 | 105 | 0 | 69.12 | 0 | 30.88 | 0 | 29.58 | 44.182 | 82.5 | 0 |
| testContract | cosmetic | 340 | 225 | 0 | 115 | 0 | 66.18 | 0 | 33.82 | 0 | 29.834 | 43.768 | 80.83 | 0 |
| testContract | attribute | 600 | 450 | 0 | 150 | 0 | 75 | 0 | 25 | 0 | 29.597 | 42.837 | 75 | 0 |
| testContract | structural | 340 | 195 | 0 | 145 | 0 | 57.35 | 0 | 42.65 | 0 | 30.175 | 43.155 | 75.83 | 0 |
| testContract | layout | 340 | 210 | 0 | 130 | 0 | 61.76 | 0 | 38.24 | 0 | 29.002 | 43.625 | 78.33 | 0 |
| testContract | content | 340 | 200 | 0 | 140 | 0 | 58.82 | 0 | 41.18 | 0 | 30.069 | 44.224 | 76.67 | 0 |
| testContract | semantic | 340 | 100 | 0 | 135 | 105 | 29.41 | 0 | 39.71 | 30.88 | 31.308 | 45.479 | 60 | 0 |

Overall: 5524 healing attempts; 2609 correct, 0 wrong, 2390 manual, 525 unrecovered. Mean 30.901 ms; P95 45.752 ms. Final TP 81.84%; final FP 0.81%.

## Recovery by mutation (all families)

| Mutation | Attempted | Recovery % | Wrong % | Manual % | Unrecovered % | Mean ms | P95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| none | 450 | 52.22 | 0 | 47.78 | 0 | 29.253 | 43.764 |
| cosmetic | 450 | 50 | 0 | 50 | 0 | 29.913 | 43.131 |
| attribute | 710 | 63.38 | 0 | 36.62 | 0 | 29.708 | 42.789 |
| structural | 1190 | 52.52 | 0 | 47.48 | 0 | 30.842 | 44.66 |
| layout | 964 | 59.54 | 0 | 40.46 | 0 | 34.833 | 52.776 |
| content | 600 | 46.67 | 0 | 53.33 | 0 | 29.391 | 43.141 |
| semantic | 1160 | 18.97 | 0 | 35.78 | 45.26 | 30.228 | 44.906 |

## Threshold sensitivity: executed ambiguous Delete trials

| Policy | n | Correct | Wrong | Manual | Unrecovered | Recovery % | Wrong % | Manual % | Mean ms | P95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| greedy_top1 | 210 | 190 | 20 | 0 | 0 | 90.48 | 9.52 | 0 | 36.888 | 51.247 |
| permissive_060_005 | 210 | 0 | 0 | 210 | 0 | 0 | 0 | 100 | 39.293 | 53.89 |
| chosen_075_015 | 210 | 0 | 0 | 210 | 0 | 0 | 0 | 100 | 40.054 | 55.066 |
| conservative_085_020 | 210 | 0 | 0 | 210 | 0 | 0 | 0 | 100 | 45.913 | 61.72 |

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
