import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ensureDebugPage,
  explainAttachFailure,
  isNoWindowError,
  isReplayableUrl,
  selectTargetPage
} from './debug-browser.js';

const ENDPOINT = 'http://localhost:9222';

/**
 * The message Playwright actually throws when Chrome is up but has no window.
 * The call log is appended to every Playwright error, including the line that
 * the old classifier keyed on.
 */
const NO_WINDOW_ERROR = new Error(
  'browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): ' +
    'Browser context management is not supported.\n' +
    'Call log:\n' +
    `  - <ws preparing> retrieving websocket url from ${ENDPOINT}\n` +
    '  - <ws connecting> ws://localhost:9222/devtools/browser/abc\n' +
    '  - <ws connected> ws://localhost:9222/devtools/browser/abc\n'
);

const REFUSED_ERROR = new Error(
  'browserType.connectOverCDP: connect ECONNREFUSED 127.0.0.1:9222\n' +
    'Call log:\n' +
    `  - <ws preparing> retrieving websocket url from ${ENDPOINT}\n`
);

describe('explainAttachFailure', () => {
  it('reports a connection refusal as nothing listening', () => {
    expect(explainAttachFailure(ENDPOINT, REFUSED_ERROR)).toMatch(
      /No debuggable Chrome is listening/
    );
  });

  it('does not mistake a running Chrome with no window for nothing listening', () => {
    // Playwright's call log contains "retrieving websocket url" on every
    // failure, so matching on it reported every attach error as "nothing is
    // listening" — including this one, where Chrome answered and refused.
    const message = explainAttachFailure(ENDPOINT, NO_WINDOW_ERROR);
    expect(message).not.toMatch(/No debuggable Chrome is listening/);
    expect(message).toMatch(/no open window/);
  });

  it('passes through the first line of an unrecognised error', () => {
    const message = explainAttachFailure(
      ENDPOINT,
      new Error('something else entirely\nCall log:\n  - retrieving websocket url')
    );
    expect(message).toBe(
      `Could not attach to Chrome at ${ENDPOINT}: something else entirely`
    );
  });
});

describe('isNoWindowError', () => {
  it('recognises the Chrome no-window rejection', () => {
    expect(isNoWindowError(NO_WINDOW_ERROR)).toBe(true);
    expect(isNoWindowError(REFUSED_ERROR)).toBe(false);
  });
});

describe('ensureDebugPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCdp(initialPages: number, extraPageUrls: string[] = []) {
    let pages = initialPages;
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
      if (url.includes('/json/list')) {
        const targets = Array.from({ length: pages }, (_, i) => ({
          id: `t${i}`,
          type: 'page',
          url: 'about:blank'
        }));
        // Chrome also lists its own UI surfaces; those are not pages.
        targets.push({ id: 'ui', type: 'browser_ui', url: 'chrome://toolbar' } as never);
        extraPageUrls.forEach((url, i) => targets.push({ id: `x${i}`, type: 'page', url }));
        return new Response(JSON.stringify(targets), { status: 200 });
      }
      if (url.includes('/json/new')) {
        if (init?.method !== 'PUT') return new Response('', { status: 405 });
        pages += 1;
        return new Response(JSON.stringify({ id: 'new', type: 'page' }), { status: 200 });
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return { calls };
  }

  it('leaves a browser that already has a page alone', async () => {
    const { calls } = stubCdp(1);
    await expect(ensureDebugPage(ENDPOINT)).resolves.toBe(false);
    expect(calls).toEqual(['GET /json/list']);
  });

  it('opens a tab with PUT /json/new when the browser has no page', async () => {
    const { calls } = stubCdp(0);
    await expect(ensureDebugPage(ENDPOINT)).resolves.toBe(true);
    expect(calls).toContain('PUT /json/new');
  });

  it('does not count the side panel or other extension pages as tabs', async () => {
    const { calls } = stubCdp(0, ['chrome-extension://abc/sidepanel.html']);
    await expect(ensureDebugPage(ENDPOINT)).resolves.toBe(true);
    expect(calls).toContain('PUT /json/new');
  });
});

describe('selectTargetPage', () => {
  const page = (url: string) => ({ url: () => url });
  const FIXTURE = 'file:///Users/me/waypoint/tests/fixtures/demo-pages/ambiguous.html';
  const SIDE_PANEL = 'chrome-extension://abc/sidepanel.html';

  it('never picks the side panel, DevTools or a chrome:// page', () => {
    expect(isReplayableUrl(SIDE_PANEL)).toBe(false);
    expect(isReplayableUrl('devtools://devtools/bundled/x.html')).toBe(false);
    expect(isReplayableUrl('chrome://newtab/')).toBe(false);
    expect(isReplayableUrl(FIXTURE)).toBe(true);
    expect(isReplayableUrl('https://example.com/')).toBe(true);
    expect(selectTargetPage([page(SIDE_PANEL)], {})).toBeNull();
  });

  it('picks the tab the side panel reported as active, not pages()[0]', () => {
    const active = page(FIXTURE);
    const pages = [page(SIDE_PANEL), page('about:blank'), active];
    expect(selectTargetPage(pages, { targetUrl: FIXTURE })).toBe(active);
  });

  it('ignores a trailing slash and fragment when matching', () => {
    const tab = page('https://example.com/app#section');
    expect(selectTargetPage([tab], { targetUrl: 'https://example.com/app/' })).toBe(tab);
  });

  it('falls back to the recorded URL, then to any real tab', () => {
    const recorded = page('https://example.com/recorded');
    const other = page('https://example.com/other');
    expect(
      selectTargetPage([page(SIDE_PANEL), other, recorded], { recordedUrl: 'https://example.com/recorded' })
    ).toBe(recorded);
    expect(
      selectTargetPage([page(SIDE_PANEL), other], { targetUrl: 'https://nowhere.test/' })
    ).toBe(other);
  });
});
