import { randomUUID } from 'node:crypto';
import type { Frame, Locator as PwLocator } from 'playwright';
import type {
  ElementSnapshot,
  FeatureScores,
  HealingCandidate,
  HealingTelemetry,
} from '@waypoint/shared-types';
import { installFeatures } from './dom-features.js';

export const INTERACTIVE_SELECTOR =
  'button,input:not([type="hidden"]),select,textarea,a[href],[role],[tabindex],[onclick]';
export const DEFAULT_THRESHOLDS = { score: 0.75, margin: 0.15 };
export interface Thresholds {
  score: number;
  margin: number;
}
export interface Candidate {
  index: number;
  snapshot: ElementSnapshot;
  handle: PwLocator;
}
export interface HealingDecision {
  telemetry: HealingTelemetry;
  selected?: PwLocator;
}
const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
export function levenshtein(a: readonly string[], b: readonly string[]): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(
        Math.min(next[j]! + 1, row[j + 1]! + 1, row[j]! + (a[i] === b[j] ? 0 : 1))
      );
    row = next;
  }
  return row[b.length]!;
}
export function normalizedSimilarity(a: string, b: string, tokenLevel = false): number {
  const aa = tokenLevel ? tokens(a) : [...a.trim().toLowerCase()];
  const bb = tokenLevel ? tokens(b) : [...b.trim().toLowerCase()];
  return !aa.length || !bb.length
    ? 0
    : 1 - levenshtein(aa, bb) / Math.max(aa.length, bb.length);
}
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const aa = new Set(a),
    bb = new Set(b);
  const union = new Set([...aa, ...bb]);
  return union.size ? [...aa].filter((t) => bb.has(t)).length / union.size : 0;
}
function attributeTokens(snapshot: ElementSnapshot): string[] {
  const result = [`tag:${snapshot.tagName.toLowerCase()}`];
  // Defense in depth: arbitrary keys in old recordings cannot influence scores.
  for (const key of ['type', 'name', 'href'])
    if (snapshot.attributes[key]) result.push(`${key}:${snapshot.attributes[key]}`);
  for (const cls of (snapshot.attributes.class ?? '').split(/\s+/).filter(Boolean)) {
    if (
      !/^(cls_|css-|sc-|jsx-|[a-f0-9]{6,}$)/i.test(cls) &&
      !/^(?:p[trblxy]?|m[trblxy]?|w|h|text|bg|flex|grid|gap|items|justify)-/.test(cls)
    )
      result.push(`class:${cls}`);
  }
  return result;
}
function texts(s: ElementSnapshot): string[] {
  return [
    s.innerText ?? s.textContent ?? '',
    s.buttonValue ?? '',
    s.placeholder ?? '',
  ].filter((t) => t.trim());
}
/** Pure scorer: accesses only declared features; never reads grading metadata. */
export function scoreCandidate(
  candidate: ElementSnapshot,
  recorded: ElementSnapshot
): { score: number; features: FeatureScores } {
  const semantic =
    0.43 * (candidate.role && candidate.role === recorded.role ? 1 : 0) +
    0.57 *
      normalizedSimilarity(
        candidate.accessibleName ?? candidate.labelText ?? '',
        recorded.accessibleName ?? recorded.labelText ?? '',
        true
      );
  const text = Math.max(
    0,
    ...texts(candidate).flatMap((a) =>
      texts(recorded).map((b) =>
        Math.max(normalizedSimilarity(a, b), jaccard(tokens(a), tokens(b)))
      )
    )
  );
  const attributes = jaccard(attributeTokens(candidate), attributeTokens(recorded));
  const structural =
    0.5 * jaccard(candidate.ancestorTags ?? [], recorded.ancestorTags ?? []) +
    0.5 / (1 + Math.abs((candidate.siblingIndex ?? 0) - (recorded.siblingIndex ?? 0)));
  const cb = candidate.boundingBox,
    rb = recorded.boundingBox;
  const position =
    cb && rb ? Math.max(0, 1 - Math.hypot(cb.x - rb.x, cb.y - rb.y) / 500) : 0;
  const features = { semantic, text, attributes, structural, position };
  return {
    features,
    score: Math.min(
      1,
      0.35 * semantic +
        0.25 * text +
        0.2 * attributes +
        0.1 * structural +
        0.1 * position
    ),
  };
}
export function rankCandidates(
  candidates: Array<{ index: number; snapshot: ElementSnapshot }>,
  snapshot: ElementSnapshot
): HealingCandidate[] {
  return candidates
    .map((c) => ({
      index: c.index,
      ...scoreCandidate(c.snapshot, snapshot),
      tagName: c.snapshot.tagName,
      accessibleName: c.snapshot.accessibleName,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}
export function gateCandidates(
  ranked: HealingCandidate[],
  thresholds = DEFAULT_THRESHOLDS
): HealingTelemetry {
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
    topCandidates: ranked.slice(0, 3),
    regeneratedLocator: null,
  };
}

/** Enumerate in the recorded frame; Playwright pierces open shadow roots. */
export async function enumerateCandidates(frame: Frame): Promise<Candidate[]> {
  await installFeatures(frame);
  const all = frame.locator(INTERACTIVE_SELECTOR);
  const rows = await all.evaluateAll((elements) => {
    const api = (
      window as unknown as {
        WaypointDOM: { captureFeatures(el: Element): ElementSnapshot };
      }
    ).WaypointDOM;
    return elements.flatMap((el, index) => {
      const rect = el.getBoundingClientRect();
      const style = el.ownerDocument.defaultView!.getComputedStyle(el);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
        ? [{ index, snapshot: api.captureFeatures(el) }]
        : [];
    });
  });
  return rows.map((row) => ({ ...row, handle: all.nth(row.index) }));
}

export async function heal(
  frame: Frame,
  snapshot: ElementSnapshot,
  thresholds = DEFAULT_THRESHOLDS
): Promise<HealingDecision> {
  const started = performance.now();
  const candidates = await enumerateCandidates(frame);
  const ranked = rankCandidates(candidates, snapshot);
  const telemetry = gateCandidates(ranked, thresholds);
  let selected: PwLocator | undefined;
  if (telemetry.healingOutcome === 'autonomous_repair') {
    const token = randomUUID();
    const candidate = candidates.find((c) => c.index === ranked[0]!.index)!;
    await candidate.handle.evaluate(
      (el, token) => el.setAttribute('data-waypoint-healed', token),
      token
    );
    telemetry.regeneratedLocator = {
      kind: 'css',
      selector: `[data-waypoint-healed="${token}"]`,
    };
    selected = frame.locator(telemetry.regeneratedLocator.selector);
  }
  telemetry.healingLatencyMs = performance.now() - started;
  return { telemetry, ...(selected ? { selected } : {}) };
}

export class HealingError extends Error {
  constructor(readonly telemetry: HealingTelemetry) {
    super(
      telemetry.healingOutcome === 'needs_manual_intervention'
        ? 'needs_manual_intervention: confirm one of the top ranked candidates'
        : 'LOCATOR_NOT_FOUND'
    );
    this.name = 'HealingError';
  }
}
