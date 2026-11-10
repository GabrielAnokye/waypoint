import { expect, it } from 'vitest';
import { summarizeBaseline, summarizeHealing, type Observation } from './runner.js';
const observation = (extra: Partial<Observation>): Observation => ({
  pass: 'B',
  workflow: 'w',
  stepId: 's',
  fixture: 'f',
  variant: 'labeled',
  condition: 'none',
  family: 'intent',
  repetition: 1,
  expectedTruthId: 'expected',
  classification: 'true_negative',
  ...extra,
});
it('keeps recovery denominators separate from surviving baseline actions and residual wrong targets', () => {
  const rows = [
    observation({ classification: 'true_positive' }),
    observation({ classification: 'false_positive' }),
    observation({
      healingAttempted: true,
      healingOutcome: 'autonomous_repair',
      classification: 'true_positive',
      healingLatencyMs: 1,
    }),
    observation({
      healingAttempted: true,
      healingOutcome: 'autonomous_repair',
      classification: 'false_positive',
      healingLatencyMs: 2,
    }),
    observation({
      healingAttempted: true,
      healingOutcome: 'needs_manual_intervention',
      healingLatencyMs: 3,
    }),
    observation({
      healingAttempted: true,
      healingOutcome: 'unrecoverable_failure',
      healingLatencyMs: 4,
    }),
  ];
  expect(summarizeBaseline(rows, 'intent', 'none')).toMatchObject({
    n: 6,
    truePositive: 2,
    falsePositive: 2,
    trueNegative: 2,
  });
  expect(summarizeHealing(rows, 'intent', 'none')).toMatchObject({
    n: 6,
    attempted: 4,
    correct: 1,
    wrong: 1,
    manual: 1,
    unrecovered: 1,
    recoveryPct: 25,
    wrongPct: 25,
    manualPct: 25,
    unrecoveredPct: 25,
    meanMs: 2.5,
    p95Ms: 4,
  });
});
it('handles a matrix cell with no broken locators without NaN', () => {
  expect(
    summarizeHealing(
      [observation({ classification: 'true_positive' })],
      'intent',
      'none'
    )
  ).toMatchObject({
    attempted: 0,
    recoveryPct: 0,
    meanMs: 0,
    p95Ms: 0,
    finalTpPct: 100,
  });
});
