/**
 * Locator resolution with fallback chain, ambiguity detection, and
 * frame-aware targeting. Used by the executor to translate workflow
 * locators into Playwright locator handles.
 *
 * Rules:
 * - Never silently click a random similar element.
 * - Try safe fallback resolution once.
 * - If repair confidence is low, stop and produce a repair record.
 * - Record enough diagnostics to support manual rebinding.
 */

import type {
  FailureCode,
  Locator,
  RepairRecord,
  WorkflowStep
} from '@waypoint/shared-types';

// ---- Types for pluggable page interface ----

/** Minimal page/frame interface the locator resolver operates on. */
export interface LocatablePage {
  getByRole(role: string, options?: { name?: string }): LocatableHandle;
  getByLabel(label: string): LocatableHandle;
  getByText(text: string, options?: { exact?: boolean }): LocatableHandle;
  getByTestId(testId: string): LocatableHandle;
  getByPlaceholder(placeholder: string): LocatableHandle;
  locator(selector: string): LocatableHandle;
  frameLocator(selector: string): LocatablePage;
}

export interface LocatableHandle {
  count(): Promise<number>;
  first(): LocatableHandle;
}

export interface ResolveResult {
  handle: LocatableHandle;
  resolvedLocator: Locator;
  usedFallback: boolean;
  confidence: number;
}

export interface ResolveFailure {
  failureCode: FailureCode;
  attemptedLocators: Locator[];
  repairRecord: RepairRecord;
}

// ---- Locator confidence scores ----

const LOCATOR_CONFIDENCE: Record<Locator['kind'], number> = {
  role: 0.95,
  testId: 0.93,
  label: 0.85,
  placeholder: 0.82,
  text: 0.78,
  css: 0.6,
  xpath: 0.4,
  coordinates: 0.2
};

// ---- Core resolution ----

function toPlaywrightLocator(page: LocatablePage, loc: Locator): LocatableHandle {
  switch (loc.kind) {
    case 'role':
      return page.getByRole(loc.role, { name: loc.name });
    case 'label':
      return page.getByLabel(loc.label);
    case 'text':
      return page.getByText(loc.text, { exact: loc.exact });
    case 'testId':
      return page.getByTestId(loc.testId);
    case 'placeholder':
      return page.getByPlaceholder(loc.placeholder);
    case 'css':
      return page.locator(loc.selector);
    case 'xpath':
      return page.locator(`xpath=${loc.selector}`);
    case 'coordinates':
      // Coordinates are a last resort — we create a locator at that point
      return page.locator(`html`);
  }
}

/**
 * Navigate into the correct frame context before resolving locators.
 */
function resolveFrameContext(
  page: LocatablePage,
  framePath?: Array<{ index: number; name?: string; url?: string }>
): { page: LocatablePage; frameMismatchRisk: boolean } {
  if (!framePath || framePath.length === 0) {
    return { page, frameMismatchRisk: false };
  }
  let current = page;
  let mismatchRisk = false;
  for (const frame of framePath) {
    // Prefer name-based selector, then index-based
    if (frame.name) {
      current = current.frameLocator(`iframe[name="${frame.name}"], frame[name="${frame.name}"]`);
    } else {
      current = current.frameLocator(`iframe:nth-of-type(${frame.index + 1}), frame:nth-of-type(${frame.index + 1})`);
      mismatchRisk = true; // Index-based is fragile
    }
  }
  return { page: current, frameMismatchRisk: mismatchRisk };
}

/**
 * Resolve a step's locator chain against a page.
 *
 * 1. Try primary locator
 * 2. If not found or ambiguous, try each fallback in order
 * 3. If nothing works, return a structured failure with repair record
 */
export async function resolveLocator(
  page: LocatablePage,
  step: WorkflowStep,
  options: {
    timestamp?: string;
    screenshotPath?: string;
  } = {}
): Promise<ResolveResult | ResolveFailure> {
  // Steps without locators don't need resolution
  if (!('primaryLocator' in step) || !step.primaryLocator) {
    return {
      handle: page.locator('html'),
      resolvedLocator: { kind: 'css', selector: 'html' },
      usedFallback: false,
      confidence: 1
    };
  }

  const framePath = 'framePath' in step ? step.framePath : undefined;
  const { page: frameCtx, frameMismatchRisk } = resolveFrameContext(
    page,
    framePath as Array<{ index: number; name?: string; url?: string }> | undefined
  );

  const primary = step.primaryLocator;
  const fallbacks: Locator[] = 'fallbackLocators' in step ? (step.fallbackLocators ?? []) : [];
  const allLocators = [primary, ...fallbacks];
  const attempted: Locator[] = [];

  for (let i = 0; i < allLocators.length; i++) {
    const loc = allLocators[i]!;
    attempted.push(loc);

    const handle = toPlaywrightLocator(frameCtx, loc);
    const count = await handle.count();

    if (count === 1) {
      return {
        handle: handle.first(),
        resolvedLocator: loc,
        usedFallback: i > 0,
        confidence: LOCATOR_CONFIDENCE[loc.kind] * (frameMismatchRisk ? 0.8 : 1)
      };
    }

    if (count > 1) {
      // Ambiguous — if this is a semantic locator, take the first match
      // but flag it. For non-semantic locators, skip to next fallback.
      const isSemantic = ['role', 'testId', 'label', 'text'].includes(loc.kind);
      if (isSemantic && count <= 3) {
        // Accept first match but reduce confidence
        return {
          handle: handle.first(),
          resolvedLocator: loc,
          usedFallback: i > 0,
          confidence: LOCATOR_CONFIDENCE[loc.kind] * 0.5
        };
      }
      // Too many matches or non-semantic — try next fallback
      continue;
    }
    // count === 0 — not found, try next
  }

  // Frame mismatch check — if we have a frame path and nothing resolved,
  // the frame structure may have changed
  const failureCode: FailureCode = frameMismatchRisk
    ? 'frame_mismatch'
    : 'locator_not_found';

  return {
    failureCode,
    attemptedLocators: attempted,
    repairRecord: {
      stepId: step.id,
      stepType: step.type,
      failureCode,
      attemptedLocators: attempted,
      confidence: 0,
      suggestion: `None of the ${attempted.length} locator(s) matched any element. ` +
        `Consider rebinding this step to a new element.`,
      timestamp: options.timestamp ?? new Date().toISOString(),
      ...(options.screenshotPath ? { screenshot: options.screenshotPath } : {})
    }
  };
}

export function isResolveFailure(
  result: ResolveResult | ResolveFailure
): result is ResolveFailure {
  return 'failureCode' in result;
}

/**
 * Classify a step execution error into a structured failure code.
 */
export function classifyError(error: unknown, _step: WorkflowStep): FailureCode {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  if (lower.includes('timeout') || lower.includes('exceeded')) return 'timeout';
  if (lower.includes('frame') && lower.includes('detach')) return 'frame_mismatch';
  if (lower.includes('navigation') || lower.includes('net::err_')) return 'navigation_mismatch';
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('login')) return 'auth_expired';
  if (lower.includes('blocked') || lower.includes('captcha') || lower.includes('access denied')) return 'blocked_page';
  if (lower.includes('strict mode') || lower.includes('resolved to') && lower.includes('elements')) return 'ambiguous_locator';
  if (lower.includes('not found') || lower.includes('no element')) return 'locator_not_found';

  return 'step_failed';
}

/**
 * Compute retry delay with capped exponential backoff.
 * Cap at 30 seconds regardless of attempt count.
 */
export function computeRetryDelay(
  attempt: number,
  backoffMs: number,
  strategy: 'fixed' | 'exponential'
): number {
  const MAX_DELAY_MS = 30_000;
  if (strategy === 'fixed') return Math.min(backoffMs, MAX_DELAY_MS);
  return Math.min(backoffMs * 2 ** (attempt - 1), MAX_DELAY_MS);
}

/**
 * Check if a URL matches an expected URL, accounting for redirects.
 * Strips trailing slashes and compares origins + pathnames.
 */
export function urlMatchesExpected(actual: string, expected: string): boolean {
  try {
    const a = new URL(actual);
    const e = new URL(expected);
    const norm = (u: URL) => `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    return norm(a) === norm(e);
  } catch {
    return actual === expected;
  }
}

/**
 * Check for common modal/dialog elements that may block interaction.
 * Returns the type of blocking element detected, or null.
 */
export function detectBlockingModal(selectors: string[]): string | null {
  // These are common modal patterns to check for
  const MODAL_SELECTORS = [
    '[role="dialog"]',
    '[role="alertdialog"]',
    '.modal',
    '.dialog',
    '[data-testid*="modal"]',
    '[data-testid*="dialog"]',
    '[aria-modal="true"]'
  ];
  for (const sel of selectors) {
    for (const modal of MODAL_SELECTORS) {
      if (sel.includes(modal.replace(/[[\]"']/g, ''))) return sel;
    }
  }
  return null;
}

/** Modal dismissal strategies. */
export const MODAL_DISMISS_STRATEGIES = [
  { selector: '[role="dialog"] button[aria-label*="close" i]', description: 'Close button via aria-label' },
  { selector: '[role="dialog"] button[aria-label*="dismiss" i]', description: 'Dismiss button via aria-label' },
  { selector: '[aria-modal="true"] [data-testid*="close"]', description: 'Close via testId' },
  { selector: '.modal-close, .dialog-close, [class*="close-button"]', description: 'Close via class name' }
] as const;
