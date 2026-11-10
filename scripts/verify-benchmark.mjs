import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Independent artifact audit: deliberately does not import the benchmark scorer,
// runner, summarizers, fixture server or grading implementation.
const directory = path.resolve(process.argv[2] ?? 'docs/benchmark-results');
const readJson = async (name) =>
  JSON.parse(await readFile(path.join(directory, name), 'utf8'));
const manifest = await readJson('manifest.json');
for (const [name, expected] of Object.entries(manifest.hashes)) {
  const actual = createHash('sha256')
    .update(await readFile(path.join(directory, name)))
    .digest('hex');
  assert.equal(actual, expected, `SHA-256 mismatch: ${name}`);
}
const suite = await readJson('canonical-workflows.json');
assert.equal(suite.length, 16);
assert.equal(
  suite.reduce((n, workflow) => n + workflow.steps.length, 0),
  120
);
const captured = new Map();
for (const workflow of suite)
  for (const action of workflow.steps) {
    assert.equal(action.snapshot.expectedTruthId, action.spec.truth);
    assert.equal(Object.keys(action.families).length, 4);
    assert(!JSON.stringify(action.families).includes('data-truth-id'));
    assert(
      Object.keys(action.snapshot.attributes).every((key) =>
        ['type', 'name', 'href', 'class'].includes(key)
      )
    );
    captured.set(action.step.id, action);
  }
const baseline = await readJson('baseline-raw.json');
const healing = await readJson('self-healing-raw.json');
const thresholds = await readJson('threshold-raw.json');
const repetitions = manifest.repetitions;
assert.equal(baseline.length, 120 * 4 * 7 * repetitions);
assert.equal(healing.length, baseline.length);
assert.equal(thresholds.length, 3 * 2 * 7 * repetitions * 4);
const suiteHash = createHash('sha256').update(JSON.stringify(suite)).digest('hex');
assert.equal(suiteHash, manifest.suiteHash);
const pct = (n, d) => (d ? Number(((n / d) * 100).toFixed(2)) : 0);
for (const [pass, rows] of [
  ['A', baseline],
  ['B', healing],
  ['sensitivity', thresholds],
]) {
  const keys = new Set();
  for (const row of rows) {
    assert.equal(row.pass, pass);
    const key = [
      row.repetition,
      row.workflow,
      row.stepId,
      row.family,
      row.condition,
      row.policy,
    ].join('/');
    assert(!keys.has(key), `Duplicate observation: ${key}`);
    keys.add(key);
    assert.equal(
      row.expectedTruthId,
      captured.get(row.stepId).snapshot.expectedTruthId
    );
    if (row.classification === 'true_positive')
      assert.equal(row.resolvedTruthId, row.expectedTruthId);
    if (row.classification === 'false_positive')
      assert.notEqual(row.resolvedTruthId, row.expectedTruthId);
    if (pass === 'A') assert.equal(row.healingAttempted, false);
    if (pass === 'B' && row.classification === 'true_negative')
      assert.equal(row.healingAttempted, true, 'Failed Pass B action bypassed healing');
    if (row.healingAttempted) {
      assert(row.healingLatencyMs >= 0);
      assert(row.healedScore >= 0 && row.healedScore <= 1);
      assert(row.ambiguityMargin >= 0 && row.ambiguityMargin <= 1);
      assert(row.topCandidates.length <= 3);
      assert(!JSON.stringify(row.topCandidates).includes('expectedTruthId'));
      assert(!JSON.stringify(row.topCandidates).includes('data-truth-id'));
      for (const candidate of row.topCandidates) {
        const f = candidate.features;
        const weighted =
          0.35 * f.semantic +
          0.25 * f.text +
          0.2 * f.attributes +
          0.1 * f.structural +
          0.1 * f.position;
        assert(Math.abs(candidate.score - weighted) < 1e-10);
      }
      if (pass === 'B' && row.healingOutcome === 'autonomous_repair') {
        assert(row.healedScore >= 0.75 && row.ambiguityMargin >= 0.15);
        assert(!JSON.stringify(row.regeneratedLocator).includes('data-truth-id'));
      }
      if (row.healingOutcome === 'needs_manual_intervention')
        assert.equal(row.classification, 'true_negative');
      if (row.healingOutcome === 'unrecoverable_failure')
        assert.equal(row.classification, 'true_negative');
    }
  }
}
const baselineSummary = await readJson('baseline-degradation.json');
const healingSummary = await readJson('self-healing-results.json');
assert.equal(baselineSummary.rows.length, 28);
assert.equal(healingSummary.rows.length, 28);
for (const summary of baselineSummary.rows) {
  const rows = baseline.filter(
    (row) => row.family === summary.family && row.condition === summary.condition
  );
  assert.equal(rows.length, 120 * repetitions);
  assert.equal(summary.n, rows.length);
  const tp = rows.filter((r) => r.classification === 'true_positive').length;
  const fp = rows.filter((r) => r.classification === 'false_positive').length;
  assert.equal(summary.truePositive, tp);
  assert.equal(summary.falsePositive, fp);
  assert.equal(summary.trueNegative, rows.length - tp - fp);
  assert.equal(summary.tpPct, pct(tp, rows.length));
  assert.equal(summary.fpPct, pct(fp, rows.length));
}
for (const summary of healingSummary.rows) {
  const rows = healing.filter(
    (row) => row.family === summary.family && row.condition === summary.condition
  );
  const attempts = rows.filter((row) => row.healingAttempted);
  const autonomous = attempts.filter(
    (row) => row.healingOutcome === 'autonomous_repair'
  );
  const correct = autonomous.filter(
    (row) => row.classification === 'true_positive'
  ).length;
  const wrong = autonomous.filter(
    (row) => row.classification === 'false_positive'
  ).length;
  const manual = attempts.filter(
    (row) => row.healingOutcome === 'needs_manual_intervention'
  ).length;
  assert.equal(summary.attempted, attempts.length);
  assert.equal(summary.correct, correct);
  assert.equal(summary.wrong, wrong);
  assert.equal(summary.manual, manual);
  assert.equal(summary.unrecovered, attempts.length - correct - wrong - manual);
  assert.equal(summary.recoveryPct, pct(correct, attempts.length));
  assert.equal(summary.wrongPct, pct(wrong, attempts.length));
  assert.equal(summary.manualPct, pct(manual, attempts.length));
  const times = attempts.map((row) => row.healingLatencyMs).sort((a, b) => a - b);
  assert.equal(
    summary.meanMs,
    Number((times.reduce((a, b) => a + b, 0) / (times.length || 1)).toFixed(3))
  );
  assert.equal(
    summary.p95Ms,
    Number((times[Math.max(0, Math.ceil(times.length * 0.95) - 1)] ?? 0).toFixed(3))
  );
}
console.log(
  `Verified ${baseline.length + healing.length} main observations, ${thresholds.length} threshold trials, 56 summary cells, 16 workflows, 120 capture snapshots, gate constraints, grading, latency statistics, and all file hashes.`
);
