/**
 * Decides whether a tab's URL can anchor a recorded workflow.
 *
 * A recording has to begin with a navigable starting point, because playback
 * runs in a fresh browser that opens on about:blank. Without a goto step every
 * locator in the workflow resolves against an empty page and fails.
 *
 * The test is which protocols Playwright can actually navigate to, not which
 * ones look web-like. `file:` is navigable and matters here: the study's
 * fixture pages are local HTML, so a recording made by opening one directly
 * must still produce a usable starting point. Browser-internal protocols are
 * excluded because Playwright cannot open them at all.
 */
const NAVIGABLE_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

export function isRecordableUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    return NAVIGABLE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    // Not a parseable URL (e.g. the empty string on a blank tab).
    return false;
  }
}
