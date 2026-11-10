/** Strict attachment helpers. This module never launches a browser or creates a tab. */
import type { Page } from 'playwright';
import { ATTACHED_TARGET_ATTRIBUTE, type AttachedTarget } from '@waypoint/shared-types';

export class AttachedBrowserError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AttachedBrowserError';
  }
}

export function isReplayableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'file:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

/** Never execute script/data/browser URLs or navigate a web tab into local files. */
export function assertSafeAttachedNavigation(current: string, destination: string): void {
  if (!isReplayableUrl(destination) ||
      (new URL(destination).protocol === 'file:' && new URL(current).protocol !== 'file:')) {
    throw new AttachedBrowserError('unsafe_navigation',
      'Attached playback refused this URL. Use HTTP/HTTPS, or select a local fixture tab before replaying a file URL. Script, data, internal, and credential-bearing URLs are blocked.');
  }
}

/** Exact URL comparison: query parameters and fragments may change application state. */
export function samePageUrl(a: string, b: string): boolean {
  return new URL(a).href === new URL(b).href;
}

/**
 * A URL is not an identity. Match the one-time token injected into the selected
 * document, across all existing contexts. Even identical URLs cannot substitute.
 * This marker correlates two APIs; it is not authentication or a target locator.
 */
export async function selectTargetPage(pages: Page[], target: AttachedTarget): Promise<Page> {
  if (!isReplayableUrl(target.url)) throw new AttachedBrowserError('unsafe_navigation', 'Select a normal webpage or local fixture tab.');
  const matches: Page[] = [];
  for (const page of pages) {
    if (page.isClosed() || !isReplayableUrl(page.url())) continue;
    const token = await page.evaluate(attribute => document.documentElement.getAttribute(attribute), ATTACHED_TARGET_ATTRIBUTE).catch(() => null);
    if (token === target.token) matches.push(page);
  }
  if (matches.length !== 1) {
    throw new AttachedBrowserError('attached_target_not_found',
      'The exact selected tab is not available in the connected browser. Open Waypoint in the browser exposing the configured CDP endpoint and select the webpage again. Ordinary Chrome without remote debugging cannot be used by this mode.');
  }
  const page = matches[0]!;
  if (!samePageUrl(page.url(), target.url)) {
    throw new AttachedBrowserError('attached_target_changed', 'The selected tab navigated after you clicked Run. Select the intended page and run again.');
  }
  return page;
}

export function isNoWindowError(error: unknown): boolean {
  return /Browser context management is not supported/i.test(error instanceof Error ? error.message : String(error));
}

export function explainAttachFailure(endpoint: string, error: unknown): string {
  const firstLine = (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|socket hang up|Timeout .* exceeded/i.test(firstLine)) {
    return `No debuggable Chrome is listening at ${endpoint}. Start a debugging browser explicitly with "pnpm chrome:debug", open Waypoint in that browser, select the webpage, and try again. Ordinary Chrome needs remote debugging enabled at launch. No replacement browser was opened.`;
  }
  if (isNoWindowError(firstLine)) {
    return `Chrome at ${endpoint} has no usable open window or rejected Playwright's attach handshake. Open the intended webpage in a compatible debugging browser and retry. No window or tab was created.`;
  }
  return `Could not attach to Chrome at ${endpoint}: ${firstLine}`;
}
