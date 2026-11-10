import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import type { AttachedTarget } from '@waypoint/shared-types';
import { assertSafeAttachedNavigation, explainAttachFailure, isNoWindowError, isReplayableUrl, samePageUrl, selectTargetPage } from './debug-browser.js';

const ENDPOINT = 'http://localhost:9222';
const target: AttachedTarget = { tabId: 2, windowId: 3, url: 'https://example.com/app', token: '00000000-0000-4000-8000-000000000001' };
const page = (url: string, token: string | null = null, closed = false) => ({
  url: () => url, isClosed: () => closed, evaluate: async () => token
}) as unknown as Page;

describe('attachment errors', () => {
  it('reports refused connections without the generic Playwright call log hiding the cause', () => {
    expect(explainAttachFailure(ENDPOINT, new Error('connect ECONNREFUSED\nretrieving websocket url'))).toContain('No debuggable Chrome');
  });
  it('never offers an automatic replacement for a browser without a window', () => {
    const error = new Error('Browser context management is not supported\nretrieving websocket url');
    expect(isNoWindowError(error)).toBe(true);
    expect(explainAttachFailure(ENDPOINT, error)).toContain('No window or tab was created');
    expect(explainAttachFailure(ENDPOINT, error)).not.toContain('No debuggable Chrome');
  });
  it('passes through the first line of an unknown connection error', () => {
    expect(explainAttachFailure(ENDPOINT, new Error('unexpected\nCall log'))).toBe(`Could not attach to Chrome at ${ENDPOINT}: unexpected`);
  });
});

describe('exact existing tab selection', () => {
  it('uses the token to select the second of two identical URLs', async () => {
    const wrong = page(target.url);
    const right = page(target.url, target.token);
    expect(await selectTargetPage([wrong, right], target)).toBe(right);
  });
  it('refuses a same-URL tab in another browser or document', async () => {
    await expect(selectTargetPage([page(target.url, 'another-token')], target)).rejects.toMatchObject({ code: 'attached_target_not_found' });
  });
  it('refuses when there are no existing pages', async () => {
    await expect(selectTargetPage([], target)).rejects.toMatchObject({ code: 'attached_target_not_found' });
  });
  it('refuses duplicate tokens instead of selecting the first', async () => {
    await expect(selectTargetPage([page(target.url, target.token), page(target.url, target.token)], target)).rejects.toMatchObject({ code: 'attached_target_not_found' });
  });
  it('refuses stale URL snapshots including fragment changes', async () => {
    await expect(selectTargetPage([page(`${target.url}#changed`, target.token)], target)).rejects.toMatchObject({ code: 'attached_target_changed' });
  });
  it('never selects internal, extension, or closed pages', async () => {
    await expect(selectTargetPage([
      page('chrome-extension://abc/sidepanel.html', target.token), page('chrome://newtab', target.token), page(target.url, target.token, true)
    ], target)).rejects.toMatchObject({ code: 'attached_target_not_found' });
  });
});

describe('attached URL safety', () => {
  it.each(['javascript:alert(1)', 'data:text/html,x', 'about:blank', 'chrome://settings', 'https://user:password@example.com'])('rejects %s', url => {
    expect(isReplayableUrl(url)).toBe(false);
    expect(() => assertSafeAttachedNavigation(target.url, url)).toThrow();
  });
  it('allows ordinary recorded web navigation and local-to-local fixture navigation', () => {
    expect(() => assertSafeAttachedNavigation(target.url, 'http://localhost:8080/forms.html')).not.toThrow();
    expect(() => assertSafeAttachedNavigation('file:///fixture.html', 'file:///other.html')).not.toThrow();
    expect(() => assertSafeAttachedNavigation(target.url, 'file:///fixture.html')).toThrow();
  });
  it('does not discard application fragments or query strings when comparing URLs', () => {
    expect(samePageUrl('https://example.com', 'https://example.com/')).toBe(true);
    expect(samePageUrl(`${target.url}#one`, `${target.url}#two`)).toBe(false);
    expect(samePageUrl(`${target.url}?mutation=structural`, target.url)).toBe(false);
  });
});
