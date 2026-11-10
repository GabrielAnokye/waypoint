import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import type {
  HealingTelemetry,
  LocatorFamily,
  TruthClassification,
} from '@waypoint/shared-types';
import { executeElementAction } from '../element-action.js';
import { HealingError } from '../healer.js';
import { startMutationServer } from '../mutation/server.js';
import {
  captureWorkflows,
  CONDITIONS,
  FAMILIES,
  preparePage,
  type BenchmarkWorkflow,
  type Condition,
} from './workflows.js';

export interface Observation extends HealingTelemetry {
  pass: 'A' | 'B' | 'sensitivity';
  workflow: string;
  stepId: string;
  fixture: string;
  variant: string;
  condition: Condition;
  family: LocatorFamily;
  repetition: number;
  expectedTruthId: string;
  resolvedTruthId?: string;
  classification: TruthClassification;
  error?: string;
  policy?: string;
}
export interface BaselineRow {
  family: string;
  condition: string;
  n: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  tpPct: number;
  fpPct: number;
  tnPct: number;
}
export interface HealingRow {
  family: string;
  condition: string;
  n: number;
  attempted: number;
  correct: number;
  wrong: number;
  manual: number;
  unrecovered: number;
  recoveryPct: number;
  wrongPct: number;
  manualPct: number;
  unrecoveredPct: number;
  meanMs: number;
  p95Ms: number;
  finalTpPct: number;
  finalFpPct: number;
}
const pct = (n: number, d: number): number =>
  d ? Number(((n / d) * 100).toFixed(2)) : 0;
export function summarizeBaseline(
  rows: Observation[],
  family: string,
  condition: string
): BaselineRow {
  const tp = rows.filter((r) => r.classification === 'true_positive').length;
  const fp = rows.filter((r) => r.classification === 'false_positive').length;
  const tn = rows.filter((r) => r.classification === 'true_negative').length;
  return {
    family,
    condition,
    n: rows.length,
    truePositive: tp,
    falsePositive: fp,
    trueNegative: tn,
    tpPct: pct(tp, rows.length),
    fpPct: pct(fp, rows.length),
    tnPct: pct(tn, rows.length),
  };
}
export function summarizeHealing(
  rows: Observation[],
  family: string,
  condition: string
): HealingRow {
  const attempts = rows.filter((r) => r.healingAttempted);
  const correct = attempts.filter(
    (r) =>
      r.healingOutcome === 'autonomous_repair' && r.classification === 'true_positive'
  ).length;
  const wrong = attempts.filter(
    (r) =>
      r.healingOutcome === 'autonomous_repair' && r.classification === 'false_positive'
  ).length;
  const manual = attempts.filter(
    (r) => r.healingOutcome === 'needs_manual_intervention'
  ).length;
  const unrecovered = attempts.length - correct - wrong - manual;
  const latencies = attempts.map((r) => r.healingLatencyMs ?? 0).sort((a, b) => a - b);
  return {
    family,
    condition,
    n: rows.length,
    attempted: attempts.length,
    correct,
    wrong,
    manual,
    unrecovered,
    recoveryPct: pct(correct, attempts.length),
    wrongPct: pct(wrong, attempts.length),
    manualPct: pct(manual, attempts.length),
    unrecoveredPct: pct(unrecovered, attempts.length),
    meanMs: Number(
      (latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)).toFixed(3)
    ),
    p95Ms: Number(
      (latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0).toFixed(3)
    ),
    finalTpPct: pct(
      rows.filter((r) => r.classification === 'true_positive').length,
      rows.length
    ),
    finalFpPct: pct(
      rows.filter((r) => r.classification === 'false_positive').length,
      rows.length
    ),
  };
}
function csv(rows: object[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]!);
  const escape = (v: unknown): string =>
    '"' + String(v ?? '').replaceAll('"', '""') + '"';
  return (
    [
      keys.map(escape).join(','),
      ...rows.map((row) =>
        keys.map((k) => escape((row as Record<string, unknown>)[k])).join(',')
      ),
    ].join('\n') + '\n'
  );
}
function table(headers: string[], rows: Array<Array<string | number>>): string {
  return (
    '| ' +
    headers.join(' | ') +
    ' |\n| ' +
    headers.map(() => '---').join(' | ') +
    ' |\n' +
    rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n')
  );
}
const policies = [
  { name: 'greedy_top1', score: 0, margin: 0 },
  { name: 'permissive_060_005', score: 0.6, margin: 0.05 },
  { name: 'chosen_075_015', score: 0.75, margin: 0.15 },
  { name: 'conservative_085_020', score: 0.85, margin: 0.2 },
];
export interface BenchmarkOptions {
  repetitions?: number;
  workers?: number;
  outputDir?: string;
  sensitivity?: boolean;
}
export async function runBenchmark(options: BenchmarkOptions = {}): Promise<void> {
  const repetitions = options.repetitions ?? 5;
  const workers = options.workers ?? 4;
  const outputDir = path.resolve(options.outputDir ?? 'docs/benchmark-results');
  await fs.mkdir(outputDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const server = await startMutationServer();
  const browser = await chromium.launch({ headless: true });
  const baseline: Observation[] = [],
    healing: Observation[] = [],
    sensitivity: Observation[] = [];
  try {
    console.log(
      `Capturing 16 workflows / 120 steps at 1280×1000; ${repetitions} repetitions, ${workers} workers.`
    );
    const suite = await captureWorkflows(browser, server.url);
    await fs.writeFile(
      path.join(outputDir, 'canonical-workflows.json'),
      JSON.stringify(suite, null, 2) + '\n'
    );
    const suiteHash = createHash('sha256').update(JSON.stringify(suite)).digest('hex');
    console.log('Capture verified. Starting baseline and healing passes.');
    for (const pass of ['A', 'B'] as const) {
      let completed = 0;
      const jobs: Array<() => Promise<void>> = [];
      for (let repetition = 1; repetition <= repetitions; repetition++)
        for (const condition of CONDITIONS)
          for (const family of FAMILIES)
            for (const workflow of suite) {
              jobs.push(async () => {
                const rows = await evaluateWorkflow(
                  browser,
                  server.url,
                  workflow,
                  pass,
                  family,
                  condition,
                  repetition
                );
                (pass === 'A' ? baseline : healing).push(...rows);
                completed++;
                if (completed % 112 === 0 || completed === jobs.length)
                  console.log(
                    `Pass ${pass}: ${completed}/${jobs.length} workflow cells; ${(pass === 'A' ? baseline : healing).length} step evaluations`
                  );
              });
            }
      await pool(jobs, workers);
      const rows = pass === 'A' ? baseline : healing;
      rows.sort(compareRows);
      await fs.writeFile(
        path.join(
          outputDir,
          pass === 'A' ? 'baseline-raw.json' : 'self-healing-raw.json'
        ),
        JSON.stringify(rows) + '\n'
      );
    }
    if (options.sensitivity !== false) {
      console.log(
        'Running actual action threshold sweep on the three ambiguous Delete targets.'
      );
      const jobs: Array<() => Promise<void>> = [];
      for (const policy of policies)
        for (let repetition = 1; repetition <= repetitions; repetition++)
          for (const condition of CONDITIONS)
            for (const workflow of suite.filter((w) => w.page === 'ambiguous.html')) {
              const subset = {
                ...workflow,
                steps: workflow.steps.filter((s) => s.spec.truth.startsWith('delete-')),
              };
              jobs.push(async () => {
                sensitivity.push(
                  ...(await evaluateWorkflow(
                    browser,
                    server.url,
                    subset,
                    'sensitivity',
                    'structural',
                    condition,
                    repetition,
                    policy
                  ))
                );
              });
            }
      await pool(jobs, workers);
      sensitivity.sort(compareRows);
      await fs.writeFile(
        path.join(outputDir, 'threshold-raw.json'),
        JSON.stringify(sensitivity) + '\n'
      );
    }
    const expected = 120 * 4 * 7 * repetitions;
    if (baseline.length !== expected || healing.length !== expected)
      throw new Error('Incomplete benchmark matrix');
    const baselineTable: BaselineRow[] = [],
      healingTable: HealingRow[] = [];
    for (const family of FAMILIES)
      for (const condition of CONDITIONS) {
        const a = baseline.filter(
          (r) => r.family === family && r.condition === condition
        );
        const b = healing.filter(
          (r) => r.family === family && r.condition === condition
        );
        if (a.length !== 120 * repetitions || b.length !== a.length)
          throw new Error('Incomplete cell');
        baselineTable.push(summarizeBaseline(a, family, condition));
        healingTable.push(summarizeHealing(b, family, condition));
      }
    const thresholdTable = policies.map((p) => ({
      policy: p.name,
      scoreThreshold: p.score,
      marginThreshold: p.margin,
      ...summarizeHealing(
        sensitivity.filter((r) => r.policy === p.name),
        'forced-broken-delete',
        'all'
      ),
    }));
    const byVariant = ['labeled', 'unlabeled'].flatMap((variant) =>
      FAMILIES.map((family) => ({
        variant,
        ...summarizeBaseline(
          baseline.filter((r) => r.variant === variant && r.family === family),
          family,
          'all'
        ),
      }))
    );
    const metadata = {
      startedAt,
      finishedAt: new Date().toISOString(),
      repetitions,
      workers,
      stepsPerPass: expected,
      totalMainEvaluations: 2 * expected,
      sensitivityEvaluations: sensitivity.length,
      browserVersion: browser.version(),
      nodeVersion: process.version,
      viewport: { width: 1280, height: 1000 },
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      workingTreeDiffSha256: createHash('sha256')
        .update(execFileSync('git', ['diff', 'HEAD']))
        .digest('hex'),
      suiteHash,
      mutationSeeds: Array.from(
        { length: repetitions },
        (_, i) => `waypoint-repetition-${i + 1}`
      ),
      methodology:
        'Independent action trials: fresh navigation and fixed prerequisite state per recorded step; fresh context per workflow/family/condition/repetition/pass. No truth-based healing trigger. Threshold sweep forces missing locators on three Delete targets and executes autonomous decisions.',
    };
    for (const [name, rows] of [
      ['baseline-degradation', baselineTable],
      ['self-healing-results', healingTable],
    ] as const) {
      await fs.writeFile(
        path.join(outputDir, name + '.json'),
        JSON.stringify({ metadata, rows }, null, 2) + '\n'
      );
      await fs.writeFile(path.join(outputDir, name + '.csv'), csv([...rows]));
    }
    await fs.writeFile(
      path.join(outputDir, 'threshold-sensitivity.csv'),
      csv(thresholdTable)
    );
    const aggregateA = summarizeBaseline(baseline, 'all', 'all'),
      aggregateB = summarizeHealing(healing, 'all', 'all');
    const byCondition = CONDITIONS.map((c) =>
      summarizeHealing(
        healing.filter((r) => r.condition === c),
        'all',
        c
      )
    );
    const report = `# Waypoint empirical benchmark — Weeks 10–12\n\nMeasured ${metadata.finishedAt}. ${expected.toLocaleString()} evaluations per pass; ${(expected * 2).toLocaleString()} main evaluations. N=${repetitions}. Chromium ${metadata.browserVersion}, Node ${metadata.nodeVersion}, viewport 1280×1000, ${workers} workers.\n\n## Method and denominators\n\n${metadata.methodology}\n\nThe 120 recorded target actions span 16 page/label states. They are independent action trials, not end-to-end workflow success claims. Navigation and deterministic prerequisite setup are excluded from the 120 target actions. Baseline capture uses truth IDs for annotation only; playback/scoring never selects by truth. All four families are captured on each step, with a deliberately missing test contract when the page has none. This prevents inventing labels on poorly labeled pages. Structural paths use tag/nth-of-type and shadow-host paths; coordinates are absolute viewport positions recorded before mutation with recorded scroll restored. Candidate positions are frame-local viewport centers. Closed shadow roots are excluded from the canonical actions because ordinary Playwright cannot inspect them.\n\nEach repetition uses its own deterministic mutation seed shared across A/B and all families. Repetitions are repeated trials on a fixed synthetic corpus, not independent websites. Timing includes candidate enumeration, feature extraction, ranking and locator synthesis, excludes action execution, and is measured under ${workers}-worker contention.\n\nBaseline TP/FP/TN percentages use all evaluations as denominator. Healing percentages use only attempted recoveries (missing or ambiguous locators); raw wrong-target baseline actions do not trigger healing because doing so would leak grading information. An action error after a proposed repair counts as unrecovered. Safe refusals are TN, never FP. Final TP/FP percentages include surviving baseline actions. Threshold sweep uses the three Delete targets, both variants, all seven conditions and repetitions, forcing missing locators; every autonomous decision executes a real action. No claim that thresholds eliminate wrong targets on arbitrary websites follows from this corpus.\n\n## Baseline degradation: all 28 cells\n\n${table(
      ['Family', 'Mutation', 'n', 'TP', 'FP', 'TN', 'TP %', 'FP %', 'TN %'],
      baselineTable.map((r) => [
        r.family,
        r.condition,
        r.n,
        r.truePositive,
        r.falsePositive,
        r.trueNegative,
        r.tpPct,
        r.fpPct,
        r.tnPct,
      ])
    )}\n\nOverall: TP ${aggregateA.truePositive} (${aggregateA.tpPct}%), FP ${aggregateA.falsePositive} (${aggregateA.fpPct}%), TN ${aggregateA.trueNegative} (${aggregateA.tnPct}%).\n\n## Labeling stratification (all conditions)\n\n${table(
      ['Variant', 'Family', 'n', 'TP %', 'FP %', 'TN %'],
      byVariant.map((r) => [r.variant, r.family, r.n, r.tpPct, r.fpPct, r.tnPct])
    )}\n\n## Self-healing: all 28 cells\n\n${table(
      [
        'Family',
        'Mutation',
        'Attempted',
        'Correct',
        'Wrong',
        'Manual',
        'Unrecovered',
        'Recovery %',
        'Wrong %',
        'Manual %',
        'Unrecovered %',
        'Mean ms',
        'P95 ms',
        'Final TP %',
        'Final FP %',
      ],
      healingTable.map((r) => [
        r.family,
        r.condition,
        r.attempted,
        r.correct,
        r.wrong,
        r.manual,
        r.unrecovered,
        r.recoveryPct,
        r.wrongPct,
        r.manualPct,
        r.unrecoveredPct,
        r.meanMs,
        r.p95Ms,
        r.finalTpPct,
        r.finalFpPct,
      ])
    )}\n\nOverall: ${aggregateB.attempted} healing attempts; ${aggregateB.correct} correct, ${aggregateB.wrong} wrong, ${aggregateB.manual} manual, ${aggregateB.unrecovered} unrecovered. Mean ${aggregateB.meanMs} ms; P95 ${aggregateB.p95Ms} ms. Final TP ${aggregateB.finalTpPct}%; final FP ${aggregateB.finalFpPct}%.\n\n## Recovery by mutation (all families)\n\n${table(
      [
        'Mutation',
        'Attempted',
        'Recovery %',
        'Wrong %',
        'Manual %',
        'Unrecovered %',
        'Mean ms',
        'P95 ms',
      ],
      byCondition.map((r) => [
        r.condition,
        r.attempted,
        r.recoveryPct,
        r.wrongPct,
        r.manualPct,
        r.unrecoveredPct,
        r.meanMs,
        r.p95Ms,
      ])
    )}\n\n## Threshold sensitivity: executed ambiguous Delete trials\n\n${table(
      [
        'Policy',
        'n',
        'Correct',
        'Wrong',
        'Manual',
        'Unrecovered',
        'Recovery %',
        'Wrong %',
        'Manual %',
        'Mean ms',
        'P95 ms',
      ],
      thresholdTable.map((r) => [
        r.policy,
        r.n,
        r.correct,
        r.wrong,
        r.manual,
        r.unrecovered,
        r.recoveryPct,
        r.wrongPct,
        r.manualPct,
        r.meanMs,
        r.p95Ms,
      ])
    )}\n\nIdentical text does not imply a mathematically zero margin: the specified position and structural terms may separate otherwise identical buttons. The observed margins, scores, outcomes, and grading labels are retained in threshold-raw.json.\n\n## Baseline survival chart\n\n\`\`\`text\n${FAMILIES.map(
      (f) => {
        const r = summarizeBaseline(
          baseline.filter((x) => x.family === f),
          f,
          'all'
        );
        return (
          f.padEnd(13) +
          ' ' +
          '#'.repeat(Math.round(r.tpPct / 2)).padEnd(50) +
          ' ' +
          r.tpPct +
          '%'
        );
      }
    ).join(
      '\n'
    )}\n\`\`\`\n\n## Audit artifacts\n\n- canonical-workflows.json: frozen baseline features, four locator families, grading annotations and fixed setup.\n- baseline-raw.json / self-healing-raw.json: all ${expected} observations per pass, including errors and telemetry.\n- threshold-raw.json: all ${sensitivity.length} actual threshold-sweep observations.\n- baseline-degradation.json/csv and self-healing-results.json/csv: all 28 cells.\n- threshold-sensitivity.csv: all four policies.\n- manifest.json: provenance and SHA-256 hashes.\n`;
    await fs.writeFile(path.join(outputDir, 'BENCHMARK-REPORT.md'), report);
    const hashes: Record<string, string> = {};
    for (const filename of (await fs.readdir(outputDir)).filter(
      (f) => f !== 'manifest.json'
    ))
      hashes[filename] = createHash('sha256')
        .update(await fs.readFile(path.join(outputDir, filename)))
        .digest('hex');
    await fs.writeFile(
      path.join(outputDir, 'manifest.json'),
      JSON.stringify({ ...metadata, hashes }, null, 2) + '\n'
    );
    console.log(report);
  } finally {
    await browser.close();
    await server.stop();
  }
}
async function pool(
  jobs: Array<() => Promise<void>>,
  concurrency: number
): Promise<void> {
  let index = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (index < jobs.length) {
        const job = jobs[index++];
        await job!();
      }
    })
  );
}
function compareRows(a: Observation, b: Observation): number {
  return `${a.policy ?? ''}/${a.repetition}/${a.condition}/${a.family}/${a.workflow}/${a.stepId}`.localeCompare(
    `${b.policy ?? ''}/${b.repetition}/${b.condition}/${b.family}/${b.workflow}/${b.stepId}`
  );
}
async function evaluateWorkflow(
  browser: Browser,
  baseUrl: string,
  workflow: BenchmarkWorkflow,
  pass: Observation['pass'],
  family: LocatorFamily,
  condition: Condition,
  repetition: number,
  policy?: (typeof policies)[number]
): Promise<Observation[]> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.dismiss());
  const rows: Observation[] = [];
  try {
    for (const recorded of workflow.steps) {
      const row: Observation = {
        pass,
        family,
        condition,
        repetition,
        workflow: workflow.id,
        stepId: recorded.step.id,
        fixture: workflow.page,
        variant: workflow.variant,
        expectedTruthId: recorded.snapshot.expectedTruthId!,
        classification: 'true_negative',
        healingAttempted: false,
        ...(policy ? { policy: policy.name } : {}),
      };
      const url = new URL(`${baseUrl}/${workflow.page}`);
      url.searchParams.set('variant', workflow.variant);
      url.searchParams.set('seed', `waypoint-repetition-${repetition}`);
      if (condition !== 'none') url.searchParams.set('mutation', condition);
      // Setup errors are harness errors, not counted as honest locator failures.
      await preparePage(page, url.href, recorded.spec);
      await page.evaluate(({ x, y }) => window.scrollTo(x, y), recorded.scroll);
      const step = {
        ...recorded.step,
        timeoutMs: 750,
        primaryLocator:
          pass === 'sensitivity'
            ? { kind: 'css' as const, selector: '[data-waypoint-deliberately-missing]' }
            : recorded.families[family],
        fallbackLocators: [],
      };
      try {
        const result = await executeElementAction(page, step, {
          allowedFamily: family,
          healingEnabled: pass !== 'A',
          ...(policy ? { thresholds: policy } : {}),
        });
        Object.assign(row, result);
        row.classification =
          result.resolvedTruthId === row.expectedTruthId
            ? 'true_positive'
            : 'false_positive';
      } catch (error) {
        if (error instanceof HealingError) Object.assign(row, error.telemetry);
        else if (error instanceof Error && 'telemetry' in error)
          Object.assign(row, error.telemetry);
        row.error =
          error instanceof Error
            ? error.message.split('\n').slice(0, 2).join(' ')
            : String(error);
      }
      rows.push(row);
    }
  } finally {
    await context.close();
  }
  return rows;
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const flag = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const repetitions = Number(flag('--repetitions') ?? 5),
    workers = Number(flag('--workers') ?? 4);
  if (
    !Number.isInteger(repetitions) ||
    repetitions < 1 ||
    !Number.isInteger(workers) ||
    workers < 1
  )
    throw new Error('Positive integer repetitions/workers required');
  await runBenchmark({
    repetitions,
    workers,
    ...(flag('--output-dir') ? { outputDir: flag('--output-dir')! } : {}),
    sensitivity: !process.argv.includes('--skip-sensitivity'),
  });
}
