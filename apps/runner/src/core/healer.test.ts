import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {
  WorkflowStepSchema,
  type ElementSnapshot,
  type HealingCandidate,
} from '@waypoint/shared-types';
import {
  enumerateCandidates,
  gateCandidates,
  heal,
  normalizedSimilarity,
  scoreCandidate,
} from './healer.js';
import { installFeatures, snapshotElement } from './dom-features.js';
import {
  applyMutations,
  applyFixtureVariant,
  type MutationType,
} from './mutation/mutators.js';
import { executeElementAction } from './element-action.js';
import { startMutationServer, type MutationServer } from './mutation/server.js';
import { captureWorkflows, CONDITIONS, preparePage } from './benchmark/workflows.js';

const snapshot: ElementSnapshot = {
  tagName: 'button',
  role: 'button',
  accessibleName: 'Approve invoice',
  innerText: 'Approve',
  attributes: { type: 'button', class: 'primary' },
  ancestorTags: ['form', 'body', 'html'],
  siblingIndex: 0,
  boundingBox: { x: 100, y: 100, width: 80, height: 30 },
};
const ranked = (scores: number[]): HealingCandidate[] =>
  scores.map((score, index) => ({
    index,
    score,
    features: { semantic: 0, text: 0, attributes: 0, structural: 0, position: 0 },
    tagName: 'button',
  }));
describe('feature-weighted similarity', () => {
  it('computes all five perfect features and exact weighted total', () => {
    expect(scoreCandidate(snapshot, snapshot)).toEqual({
      score: 1,
      features: { semantic: 1, text: 1, attributes: 1, structural: 1, position: 1 },
    });
  });
  it('computes role/name, edit/token text, allowlisted attributes, ancestor/sibling, and distance terms', () => {
    const candidate: ElementSnapshot = {
      ...snapshot,
      accessibleName: 'Approve invoice today',
      innerText: 'Approve now',
      attributes: { type: 'submit', class: 'secondary' },
      ancestorTags: ['form', 'div'],
      siblingIndex: 2,
      boundingBox: { x: 400, y: 100, width: 80, height: 30 },
    };
    const result = scoreCandidate(candidate, snapshot);
    const expected = {
      semantic: 0.43 + 0.57 * (2 / 3),
      text: 7 / 11,
      attributes: 1 / 5,
      structural: 0.5 * (1 / 4) + 0.5 / 3,
      position: 0.4,
    };
    for (const key of Object.keys(expected) as Array<keyof typeof expected>)
      expect(result.features[key]).toBeCloseTo(expected[key], 10);
    expect(result.score).toBeCloseTo(
      0.35 * expected.semantic +
        0.25 * expected.text +
        0.2 * expected.attributes +
        0.1 * expected.structural +
        0.1 * expected.position,
      10
    );
    expect(normalizedSimilarity('alpha beta', 'alpha gamma', true)).toBe(0.5);
  });
  it('never rewards two absent text/semantic features', () => {
    const empty: ElementSnapshot = { tagName: 'div', attributes: {} };
    expect(scoreCandidate(empty, empty).features.semantic).toBe(0);
    expect(scoreCandidate(empty, empty).features.text).toBe(0);
  });
  it('does not access truth annotations or arbitrary attributes, even through getters', () => {
    const poisoned = { ...snapshot, attributes: { ...snapshot.attributes } };
    Object.defineProperty(poisoned, 'expectedTruthId', {
      get() {
        throw new Error('grading metadata read');
      },
    });
    Object.defineProperty(poisoned.attributes, 'data-truth-id', {
      enumerable: true,
      get() {
        throw new Error('truth attribute read');
      },
    });
    expect(() => scoreCandidate(poisoned, poisoned)).not.toThrow();
    expect(scoreCandidate(poisoned, poisoned).score).toBe(1);
  });
  it('applies all gate boundaries and stable ambiguity refusal', () => {
    expect(gateCandidates(ranked([0.75, 0.6])).healingOutcome).toBe(
      'autonomous_repair'
    );
    expect(gateCandidates(ranked([0.9, 0.9])).healingOutcome).toBe(
      'needs_manual_intervention'
    );
    expect(gateCandidates(ranked([0.749, 0.4])).healingOutcome).toBe(
      'needs_manual_intervention'
    );
    expect(gateCandidates(ranked([0.5, 0.1])).healingOutcome).toBe(
      'needs_manual_intervention'
    );
    expect(gateCandidates(ranked([0.499, 0.1])).healingOutcome).toBe(
      'unrecoverable_failure'
    );
    expect(gateCandidates([]).healingOutcome).toBe('unrecoverable_failure');
    expect(gateCandidates(ranked([0.8])).ambiguityMargin).toBe(0.8);
  });
});

let browser: Browser;
let page: Page;
let server: MutationServer;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  server = await startMutationServer();
});
afterAll(async () => {
  await browser?.close();
  await server?.stop();
});
const sample =
  '<!doctype html><html><head></head><body><form><button type="button" class="primary" aria-label="Approve invoice 42" data-truth-id="target">Submit</button></form><a href="/other" style="position:absolute;left:900px;top:700px">Documentation</a></body></html>';
describe('real Chromium healing integration', () => {
  for (const mutation of [
    'cosmetic',
    'attribute',
    'structural',
    'layout',
    'content',
  ] as MutationType[])
    it(`repairs a broken locator after ${mutation} changes`, async () => {
      await page.setContent(sample);
      await installFeatures(page.mainFrame());
      const recorded = await snapshotElement(page.locator('button'), true);
      await page.setContent(
        applyMutations(sample, [mutation], { seed: 'integration' })
      );
      const result = await heal(page.mainFrame(), recorded);
      expect(result.telemetry.healingOutcome).toBe('autonomous_repair');
      expect(result.telemetry.healedScore).toBeGreaterThanOrEqual(0.75);
      expect(await result.selected!.getAttribute('data-truth-id')).toBe('target');
      expect(JSON.stringify(result.telemetry)).not.toContain('target');
      await result.selected!.click();
    });
  it('refuses all three indistinguishable Delete controls without clicking', async () => {
    await page.setContent(
      '<button onclick="window.clicked=1" data-truth-id="delete-alpha">Delete</button><button onclick="window.clicked=1" data-truth-id="delete-beta">Delete</button><button onclick="window.clicked=1" data-truth-id="delete-gamma">Delete</button>'
    );
    await installFeatures(page.mainFrame());
    const recorded = await snapshotElement(page.locator('button').nth(1), true);
    const step = WorkflowStepSchema.parse({
      id: 'ambiguous',
      type: 'click',
      primaryLocator: { kind: 'role', role: 'button', name: 'Delete' },
      snapshot: recorded,
    });
    await expect(
      executeElementAction(page, step, { healingEnabled: true })
    ).rejects.toMatchObject({
      telemetry: {
        healingOutcome: 'needs_manual_intervention',
        topCandidates: expect.any(Array),
      },
    });
    expect(await page.evaluate('window.clicked')).toBeUndefined();
    const result = await heal(page.mainFrame(), recorded);
    expect(result.telemetry.ambiguityMargin).toBeLessThan(0.15);
    expect(result.telemetry.topCandidates).toHaveLength(3);
  });
  it('never uses grading metadata to trigger a repair of an otherwise unique locator', async () => {
    await page.setContent(
      '<button id="wrong" data-truth-id="wrong">Click</button><button data-truth-id="expected">Click</button>'
    );
    const step = WorkflowStepSchema.parse({
      id: 'wrong-direct',
      type: 'click',
      primaryLocator: { kind: 'css', selector: '#wrong' },
      snapshot: { tagName: 'button', expectedTruthId: 'expected', attributes: {} },
    });
    const result = await executeElementAction(page, step, { healingEnabled: true });
    expect(result.resolvedTruthId).toBe('wrong');
    expect(result.healingAttempted).toBe(false);
  });
  it('fails unrecoverably when the target is removed and only dissimilar controls remain', async () => {
    await page.setContent(sample);
    await installFeatures(page.mainFrame());
    const recorded = await snapshotElement(page.locator('button'), true);
    await page.locator('button').evaluate((el) => el.remove());
    const result = await heal(page.mainFrame(), recorded);
    expect(result.telemetry.healingOutcome).toBe('unrecoverable_failure');
    expect(result.telemetry.healedScore).toBeLessThan(0.5);
    expect(result.selected).toBeUndefined();
  });
  it('extracts and scores candidates while any truth-attribute read throws', async () => {
    await page.setContent(sample);
    await page.evaluate(() => {
      const original = Element.prototype.getAttribute;
      Element.prototype.getAttribute = function (name: string) {
        if (name === 'data-truth-id') throw new Error('forbidden truth read');
        return original.call(this, name);
      };
    });
    const candidates = await enumerateCandidates(page.mainFrame());
    expect(candidates.length).toBe(2);
    expect(candidates.every((c) => !('expectedTruthId' in c.snapshot))).toBe(true);
    expect(() =>
      candidates.map((c) => scoreCandidate(c.snapshot, snapshot))
    ).not.toThrow();
    // Reload restores the native prototype for subsequent tests.
    await page.goto('about:blank');
  });
  it('records 16 workflows / 120 steps with all four families and complete snapshots', async () => {
    const workflows = await captureWorkflows(browser, server.url);
    expect(workflows).toHaveLength(16);
    expect(workflows.reduce((n, w) => n + w.steps.length, 0)).toBe(120);
    for (const workflow of workflows)
      for (const recorded of workflow.steps) {
        expect(Object.keys(recorded.families)).toHaveLength(4);
        expect(JSON.stringify(recorded.families)).not.toContain('data-truth-id');
        expect(recorded.snapshot.expectedTruthId).toBe(recorded.spec.truth);
        expect(recorded.snapshot.attributes).not.toHaveProperty('data-truth-id');
        expect(recorded.snapshot.ancestorTags!.length).toBeLessThanOrEqual(4);
        expect(recorded.snapshot.boundingBox).toBeDefined();
      }
  }, 30000);
  it('keeps generated table controls, iframe controls and open shadow controls present in all 16×7 states', async () => {
    const specs = [
      { name: 'forms', spec: { truth: 'login-email' } },
      { name: 'delayed', spec: { truth: 'step1-input', setup: 'revealStep(1)' } },
      { name: 'ambiguous', spec: { truth: 'delete-beta' } },
      { name: 'tables', spec: { truth: 'delete-1' } },
      { name: 'iframe', spec: { truth: 'iframe-btn-approve', frame: 'actions-frame' } },
      { name: 'shadow-dom', spec: { truth: 'shadow-button' } },
      {
        name: 'spa',
        spec: { truth: 'save-settings', setup: "renderPage('/settings')" },
      },
      { name: 'dropdowns', spec: { truth: 'opt-low', setup: 'toggleCustom()' } },
    ];
    for (const variant of ['labeled', 'unlabeled'])
      for (const condition of CONDITIONS)
        for (const { name, spec } of specs) {
          const frame = await preparePage(
            page,
            `${server.url}/${name}.html?variant=${variant}&mutation=${condition === 'none' ? '' : condition}&seed=test`,
            spec
          );
          const target = frame.locator(`[data-truth-id="${spec.truth}"]`);
          expect(await target.count(), `${name}/${variant}/${condition}`).toBe(1);
          expect(await target.isVisible(), `${name}/${variant}/${condition}`).toBe(
            true
          );
        }
  }, 60000);
  it('moves viewport centers 80–250px using layout CSS alone and preserves names', async () => {
    await page.setContent(sample);
    await installFeatures(page.mainFrame());
    const original = await snapshotElement(page.locator('button'));
    await page.setContent(applyMutations(sample, ['layout'], { seed: 'layout' }));
    await installFeatures(page.mainFrame());
    const changed = await snapshotElement(page.locator('button'));
    const delta = changed.boundingBox!.y - original.boundingBox!.y;
    expect(delta).toBeGreaterThanOrEqual(80);
    expect(delta).toBeLessThanOrEqual(250);
    expect(changed.accessibleName).toBe(original.accessibleName);
    expect(changed.ancestorTags).toEqual(original.ancestorTags);
    expect(applyFixtureVariant(sample, 'unlabeled')).not.toContain('aria-label');
  });
});
