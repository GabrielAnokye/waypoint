import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAttachedTarget } from './attached-target.js';

const url = 'https://example.com/app';
const tab = { id: 12, windowId: 34, url, active: true };
const query = vi.fn();
const get = vi.fn();
const executeScript = vi.fn();
beforeEach(() => {
  query.mockResolvedValue([tab]); get.mockResolvedValue(tab);
  executeScript.mockResolvedValue([{ frameId: 0, documentId: 'document-identity', result: { url } }]);
  vi.stubGlobal('chrome', { tabs: { query, get }, scripting: { executeScript } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('capture exact tab from the side panel window', () => {
  it('captures tab, window, URL, document ID, and a fresh token in the top frame', async () => {
    const result = await captureAttachedTarget(34);
    expect(query).toHaveBeenCalledWith({ active: true, windowId: 34 });
    expect(result).toMatchObject({ tabId: 12, windowId: 34, url, documentId: 'document-identity' });
    expect(result.token).toMatch(/^[\da-f-]{36}$/);
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 12, frameIds: [0] } }));
  });
  it('does not substitute a tab from another window', async () => {
    query.mockResolvedValue([{ ...tab, windowId: 99 }]);
    await expect(captureAttachedTarget(34)).rejects.toThrow('side panel window');
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('rejects extension and browser-internal tabs', async () => {
    query.mockResolvedValue([{ ...tab, url: 'chrome://settings' }]);
    await expect(captureAttachedTarget(34)).rejects.toThrow('Select a loaded');
  });
  it('rejects navigation or active-tab changes while capturing', async () => {
    get.mockResolvedValue({ ...tab, active: false });
    await expect(captureAttachedTarget(34)).rejects.toThrow('changed');
  });
  it('explains missing site or file permission instead of omitting the target', async () => {
    executeScript.mockRejectedValue(new Error('permission denied'));
    await expect(captureAttachedTarget(34)).rejects.toThrow('Grant Waypoint site access');
  });
});
