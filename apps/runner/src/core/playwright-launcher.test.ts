import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowStepSchema, type AttachedTarget } from '@waypoint/shared-types';

const chromiumMock = vi.hoisted(() => ({ launch: vi.fn(), connectOverCDP: vi.fn() }));
vi.mock('playwright', () => ({ chromium: chromiumMock }));
import { createPlaywrightLauncher } from './playwright-launcher.js';

const target: AttachedTarget = { tabId: 2, windowId: 3, url: 'https://example.com/app', token: '00000000-0000-4000-8000-000000000001' };
const ctx = { runId: 'run_test', stepIndex: 0, attempt: 1, signal: new AbortController().signal };
function fixture() {
  let url = target.url;
  const page = { url: () => url, isClosed: () => false, context: () => context,
    evaluate: vi.fn(async (_fn, arg) => typeof arg === 'string' ? target.token : true),
    goto: vi.fn(async (next: string) => { url = next; }), reload: vi.fn(), close: vi.fn() };
  const session = { send: vi.fn(async () => ({ targetInfo: { targetId: 'exact-cdp-target' } })), detach: vi.fn() };
  const context = { pages: () => [page], newPage: vi.fn(async () => page), close: vi.fn(), newCDPSession: vi.fn(async () => session) };
  const browser = { contexts: () => [context], newContext: vi.fn(async () => context), close: vi.fn() };
  chromiumMock.connectOverCDP.mockResolvedValue(browser);
  chromiumMock.launch.mockResolvedValue(browser);
  return { page, context, browser };
}
const attached = () => createPlaywrightLauncher({ mode: 'attached', cdpEndpoint: 'http://127.0.0.1:9222', keepOpenMs: 0 });
const goto = (url: string) => WorkflowStepSchema.parse({ id: 'goto', type: 'goto', url });

beforeEach(() => vi.clearAllMocks());
describe('strict attached launcher', () => {
  it('refuses a missing connection without launching or creating a replacement', async () => {
    const { context, browser } = fixture();
    chromiumMock.connectOverCDP.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(attached().resetForRun!({ attachedTarget: target })).rejects.toMatchObject({ code: 'attached_browser_unavailable' });
    expect(chromiumMock.launch).not.toHaveBeenCalled();
    expect(browser.newContext).not.toHaveBeenCalled();
    expect(context.newPage).not.toHaveBeenCalled();
  });
  it('refuses missing exact identity even when a CDP endpoint is configured', async () => {
    await expect(attached().resetForRun!()).rejects.toMatchObject({ code: 'attached_target_required' });
    expect(chromiumMock.launch).not.toHaveBeenCalled();
    expect(chromiumMock.connectOverCDP).not.toHaveBeenCalled();
  });
  it('refuses an empty connected browser without creating a context or tab', async () => {
    const { browser, context } = fixture();
    browser.contexts = () => [];
    await expect(attached().resetForRun!({ attachedTarget: target })).rejects.toMatchObject({ code: 'attached_target_not_found' });
    expect(browser.newContext).not.toHaveBeenCalled();
    expect(context.newPage).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce(); // Disconnect CDP only.
  });
  it('reuses the exact Page, preserves matching URL, and disconnects without closing tabs', async () => {
    const { page, browser, context } = fixture();
    const launcher = attached();
    await launcher.resetForRun!({ attachedTarget: target, recordedUrl: target.url });
    await launcher.executeStep(goto(target.url), ctx);
    expect(page.goto).not.toHaveBeenCalled();
    expect(page.reload).not.toHaveBeenCalled();
    expect(launcher.getExecutionConditions!()).toMatchObject({ contextIsolation: 'attached', researchEligible: false, selectedTabId: 2, selectedWindowId: 3, selectedTargetId: 'exact-cdp-target' });
    await launcher.dispose!();
    expect(page.close).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
    expect(browser.newContext).not.toHaveBeenCalled();
    expect(context.newPage).not.toHaveBeenCalled();
    expect(chromiumMock.connectOverCDP).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ noDefaults: true }));
  });
  it('navigates the selected page once when the starting URL differs, even if reload is requested', async () => {
    const { page, context } = fixture();
    const launcher = attached();
    const destination = 'https://example.com/recorded';
    await launcher.resetForRun!({ attachedTarget: target, recordedUrl: destination, reloadBeforeRun: true });
    await launcher.executeStep(goto(destination), ctx);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith(destination, expect.any(Object));
    expect(page.reload).not.toHaveBeenCalled();
    expect(context.newPage).not.toHaveBeenCalled();
  });
  it('reloads a matching tab only when explicitly requested, once before replay', async () => {
    const { page } = fixture();
    const launcher = attached();
    await launcher.resetForRun!({ attachedTarget: target, recordedUrl: target.url, reloadBeforeRun: true });
    await launcher.executeStep(goto(target.url), ctx);
    expect(page.reload).toHaveBeenCalledOnce();
    expect(page.goto).not.toHaveBeenCalled();
  });
  it('blocks unsafe initial URLs before connecting to a browser', async () => {
    fixture();
    await expect(attached().resetForRun!({ attachedTarget: target, recordedUrl: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'unsafe_navigation' });
    expect(chromiumMock.connectOverCDP).not.toHaveBeenCalled();
  });
  it('does not fall back to a browser launch when attached mode lacks an endpoint', async () => {
    fixture();
    await expect(createPlaywrightLauncher({ mode: 'attached' }).resetForRun!({ attachedTarget: target })).rejects.toMatchObject({ code: 'attached_browser_unavailable' });
    expect(chromiumMock.launch).not.toHaveBeenCalled();
  });
});

describe('isolated launcher', () => {
  it('creates its own context even when a CDP endpoint happens to be configured', async () => {
    const { context, browser } = fixture();
    const launcher = createPlaywrightLauncher({ mode: 'isolated', headless: true, cdpEndpoint: 'http://127.0.0.1:9222', keepOpenMs: 0 });
    await launcher.resetForRun!();
    await launcher.executeStep(goto('https://example.com/start'), ctx);
    expect(chromiumMock.launch).toHaveBeenCalledOnce();
    expect(browser.newContext).toHaveBeenCalledOnce();
    expect(context.newPage).toHaveBeenCalledOnce();
    expect(chromiumMock.connectOverCDP).not.toHaveBeenCalled();
    await launcher.dispose!();
    expect(context.close).toHaveBeenCalledOnce();
  });
});
