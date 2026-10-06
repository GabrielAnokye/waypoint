import { describe, expect, it } from 'vitest';

import { isRecordableUrl } from './recordable-url.js';

describe('isRecordableUrl', () => {
  it('accepts http and https pages', () => {
    expect(isRecordableUrl('http://localhost:8080/ambiguous.html')).toBe(true);
    expect(isRecordableUrl('https://example.com/login')).toBe(true);
  });

  it('accepts file URLs, which Playwright can navigate', () => {
    // Fixture pages are local HTML; opening one directly must still record a
    // starting point, otherwise the workflow replays against about:blank.
    expect(isRecordableUrl('file:///Users/x/demo-pages/ambiguous.html')).toBe(true);
  });

  it('rejects browser-internal pages Playwright cannot open', () => {
    expect(isRecordableUrl('chrome://extensions')).toBe(false);
    expect(isRecordableUrl('chrome-extension://abcdef/sidepanel.html')).toBe(false);
    expect(isRecordableUrl('about:blank')).toBe(false);
    expect(isRecordableUrl('devtools://devtools/bundled/inspector.html')).toBe(false);
  });

  it('rejects missing or unparseable URLs', () => {
    expect(isRecordableUrl(undefined)).toBe(false);
    expect(isRecordableUrl(null)).toBe(false);
    expect(isRecordableUrl('')).toBe(false);
    expect(isRecordableUrl('not a url')).toBe(false);
  });
});
