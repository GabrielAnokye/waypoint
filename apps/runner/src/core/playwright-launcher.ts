/**
 * Real Playwright-based browser launcher that opens Chromium and replays
 * workflow steps visually. Implements the BrowserLauncher interface from
 * executor.ts so it can be injected into executeWorkflow().
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type FrameLocator,
  type Locator as PwLocator,
  type Page,
} from 'playwright';

import {
  ATTACHED_TARGET_ATTRIBUTE,
  type HealingTelemetry,
  type Locator,
  type LocatorFamily,
  type RunEngine,
  type WorkflowStep,
} from '@waypoint/shared-types';

import { heal, HealingError } from './healer.js';
import { executeElementAction, stepFrame } from './element-action.js';

import {
  AttachedBrowserError,
  assertSafeAttachedNavigation,
  samePageUrl,
  explainAttachFailure,
  selectTargetPage,
} from './debug-browser.js';
import type {
  BrowserLauncher,
  ExecuteStepContext,
  ExecutionConditions,
  RunTargetOptions,
  StepExecutionResult,
} from './executor.js';
import {
  resolveLocator,
  LocatorResolutionError,
  isResolveFailure,
  type LocatablePage,
  type LocatableHandle,
} from './locate.js';

// ---- Adapter: wrap Playwright Page to satisfy LocatablePage ----

function adaptPage(page: Page): LocatablePage {
  return {
    getByRole: (role: string, options?: { name?: string }) =>
      adaptHandle(page.getByRole(role as Parameters<Page['getByRole']>[0], options)),
    getByLabel: (label: string) => adaptHandle(page.getByLabel(label)),
    getByText: (text: string, options?: { exact?: boolean }) =>
      adaptHandle(page.getByText(text, options)),
    getByTestId: (testId: string) => adaptHandle(page.getByTestId(testId)),
    getByPlaceholder: (placeholder: string) =>
      adaptHandle(page.getByPlaceholder(placeholder)),
    locator: (selector: string) => adaptHandle(page.locator(selector)),
    frameLocator: (selector: string) => adaptFrameLocator(page.frameLocator(selector)),
  };
}

function adaptHandle(loc: PwLocator): LocatableHandle {
  return {
    count: () => loc.count(),
    // Expose the underlying Playwright locator for action methods
    _pw: loc,
  } as LocatableHandle & { _pw: PwLocator };
}

function adaptFrameLocator(fl: FrameLocator): LocatablePage {
  return {
    getByRole: (role: string, options?: { name?: string }) =>
      adaptHandle(fl.getByRole(role as Parameters<Page['getByRole']>[0], options)),
    getByLabel: (label: string) => adaptHandle(fl.getByLabel(label)),
    getByText: (text: string, options?: { exact?: boolean }) =>
      adaptHandle(fl.getByText(text, options)),
    getByTestId: (testId: string) => adaptHandle(fl.getByTestId(testId)),
    getByPlaceholder: (placeholder: string) =>
      adaptHandle(fl.getByPlaceholder(placeholder)),
    locator: (selector: string) => adaptHandle(fl.locator(selector)),
    frameLocator: (selector: string) => adaptFrameLocator(fl.frameLocator(selector)),
  };
}

/** Extract the underlying Playwright Locator from an adapted handle. */
function getPwLocator(handle: LocatableHandle): PwLocator {
  return (handle as LocatableHandle & { _pw: PwLocator })._pw;
}

// ---- PlaywrightBrowserLauncher ----

export interface PlaywrightLauncherOptions {
  /** Attached mode may only connect to the exact selected existing tab. */
  mode?: RunEngine;
  /** Launch browser in headless mode. Default: false (visible). */
  headless?: boolean;
  /** Restrict benchmark execution to one family; omit for normal replay. */
  allowedFamily?: LocatorFamily;
  /** Explicit opt-in; raw baseline replay remains unchanged. */
  healingEnabled?: boolean;
  /** Slow down actions by this many ms for visibility. Default: 0. */
  slowMo?: number;
  /** Auth profile storage state path (for pre-authenticated sessions). */
  storageStatePath?: string;
  /** Custom browser profile directory. */
  profileDirectory?: string;
  /** How many ms to keep the browser open after the run finishes. Default: 5000. */
  keepOpenMs?: number;
  /**
   * CDP endpoint of an already-running Chrome to attach to, e.g.
   * `http://localhost:9222`. Used only with mode='attached'. The exact
   * selected tab must already exist in that browser.
   *
   * Demo and debugging only. Attaching inherits whatever state that browser
   * already has — cookies, storage, scroll position, other extensions
   * mutating the DOM — so runs are not reproducible and must not be used to
   * collect experiment data. See docs/EXPERIMENT-INTEGRITY.md.
   */
  cdpEndpoint?: string;
}

export class PlaywrightBrowserLauncher implements BrowserLauncher {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Map<string, Page> = new Map();
  private activePage: Page | null = null;
  private options: PlaywrightLauncherOptions;
  private tabAliasCounter = 0;
  /**
   * True when we attached to a browser someone else started. Ownership
   * matters on teardown: closing a browser we did not launch would close the
   * user's real Chrome out from under them.
   */
  private attached = false;
  /** Which tab the current attached run should replay in. Set per run. */
  private runTarget: RunTargetOptions = {};
  private attachedTargetId: string | undefined;
  private initialPageUrl: string | undefined;

  constructor(options: PlaywrightLauncherOptions = {}) {
    this.options = {
      mode: 'isolated',
      headless: false,
      slowMo: 50,
      ...options,
    };
  }

  private async ensureBrowser(): Promise<BrowserContext> {
    if (this.context) return this.context;

    if (this.options.mode === 'attached') {
      if (!this.options.cdpEndpoint)
        throw new AttachedBrowserError(
          'attached_browser_unavailable',
          'No CDP endpoint is configured. Configure BROWSER_CDP_ENDPOINT for the browser containing the selected tab.'
        );
      return this.attachOverCdp(this.options.cdpEndpoint);
    }

    const launchOptions: Parameters<typeof chromium.launch>[0] = {};
    if (this.options.headless !== undefined)
      launchOptions.headless = this.options.headless;
    if (this.options.slowMo !== undefined) launchOptions.slowMo = this.options.slowMo;

    this.browser = await chromium.launch(launchOptions);

    const contextOptions: Parameters<Browser['newContext']>[0] = {
      viewport: { width: 1280, height: 800 },
    };

    if (this.options.storageStatePath) {
      try {
        contextOptions.storageState = this.options.storageStatePath;
      } catch {
        // Storage state file may not exist yet — proceed without it
      }
    }

    this.context = await this.browser.newContext(contextOptions);
    const page = await this.context.newPage();
    const alias = `tab_${this.tabAliasCounter++}`;
    this.pages.set(alias, page);
    this.activePage = page;

    return this.context;
  }

  /**
   * Attach to a Chrome already running with --remote-debugging-port and take
   * over its current tab, rather than launching a browser of our own.
   *
   * Unlike the launch path this reuses the existing context and page, so the
   * run acts on the window the user is already looking at. That is the point
   * of the mode, and also exactly why it is unfit for data collection: the
   * page carries whatever state the previous run or the user left behind.
   */
  private async attachOverCdp(endpoint: string): Promise<BrowserContext> {
    const target = this.runTarget.attachedTarget;
    if (!target)
      throw new AttachedBrowserError(
        'attached_target_required',
        'Attached playback requires exact tab identity from the Waypoint side panel.'
      );
    try {
      this.browser = await chromium.connectOverCDP(endpoint, {
        timeout: 5000,
        slowMo: this.options.slowMo ?? 0,
        noDefaults: true,
      });
    } catch (error) {
      throw new AttachedBrowserError(
        'attached_browser_unavailable',
        explainAttachFailure(endpoint, error)
      );
    }
    this.attached = true; // Every subsequent cleanup must disconnect, not close tabs.
    try {
      const page = await selectTargetPage(
        this.browser.contexts().flatMap((context) => context.pages()),
        target
      );
      this.context = page.context();
      const session = await this.context.newCDPSession(page);
      try {
        const { targetInfo } = await session.send('Target.getTargetInfo');
        this.attachedTargetId = targetInfo.targetId;
      } finally {
        await session.detach();
      }
      // Consume the proof only after exact selection. Never use it as an action locator.
      const consumed = await page.evaluate(
        ({ attribute, token, url }) => {
          if (
            location.href !== url ||
            document.documentElement.getAttribute(attribute) !== token
          )
            return false;
          document.documentElement.removeAttribute(attribute);
          return true;
        },
        { attribute: ATTACHED_TARGET_ATTRIBUTE, token: target.token, url: target.url }
      );
      if (!consumed)
        throw new AttachedBrowserError(
          'attached_target_changed',
          'The selected document changed during attachment. Select the page and try again.'
        );
      this.pages.set(`tab_${this.tabAliasCounter++}`, page);
      this.activePage = page;
      this.initialPageUrl = page.url();
      return this.context;
    } catch (error) {
      await this.dispose();
      if (error instanceof AttachedBrowserError) throw error;
      throw new AttachedBrowserError(
        'attached_target_unavailable',
        `Could not prepare the selected tab. Keep it open and retry: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
      );
    }
  }

  private async getActivePage(): Promise<Page> {
    await this.ensureBrowser();
    if (!this.activePage) {
      throw new Error('No active page available.');
    }
    return this.activePage;
  }

  async executeStep(
    step: WorkflowStep,
    ctx: ExecuteStepContext
  ): Promise<StepExecutionResult | void> {
    const page = await this.getActivePage();
    const timeout = step.timeoutMs ?? 30_000;
    if (this.initialPageUrl !== undefined) {
      if (!samePageUrl(page.url(), this.initialPageUrl))
        throw new AttachedBrowserError(
          'attached_target_changed',
          'The selected page navigated before playback began. Run again from the intended tab.'
        );
      this.initialPageUrl = undefined;
    }

    switch (step.type) {
      case 'goto':
        return this.executeGoto(page, step, timeout);

      case 'click':
      case 'type':
      case 'select':
      case 'press':
        return executeElementAction(page, step, {
          ...(this.options.allowedFamily
            ? { allowedFamily: this.options.allowedFamily }
            : {}),
          healingEnabled: ctx.healingEnabled ?? this.options.healingEnabled ?? false,
          beforeAction: (locator) => this.highlightElement(page, locator),
        });

      case 'waitFor':
        return this.executeWaitFor(
          page,
          step,
          timeout,
          ctx.healingEnabled ?? this.options.healingEnabled ?? false
        );

      case 'assert':
        return this.executeAssert(
          page,
          step,
          timeout,
          ctx.healingEnabled ?? this.options.healingEnabled ?? false
        );

      case 'newTab':
        return this.executeNewTab(step);

      case 'closeTab':
        return this.executeCloseTab();

      // if/loop/subworkflow/httpRequest are handled by executeWorkflow() in executor.ts
      default:
        return;
    }
  }

  // ---- Step implementations ----

  private async executeGoto(
    page: Page,
    step: Extract<WorkflowStep, { type: 'goto' }>,
    timeout: number
  ): Promise<void> {
    // Skip navigation if already on the target URL
    const currentUrl = page.url();
    if (this.attached) assertSafeAttachedNavigation(currentUrl, step.url);
    if (samePageUrl(currentUrl, step.url)) {
      return;
    }
    await page.goto(step.url, {
      waitUntil: step.waitUntil,
      timeout,
    });
  }

  /**
   * Highlights an element during playback so the user can clearly see which
   * button or input is being pressed.
   *
   * 1. Calls locator.focus() so native focus rings and :focus-visible activate.
   * 2. Sets a high-visibility outline + glow ring (2px solid #0066cc with soft shadow)
   *    directly on the target element so it highlights reliably even if page styles
   *    have "outline: none".
   * 3. Remembers original styles to restore them when cleared.
   */
  private async highlightElement(page: Page, pwLocator: PwLocator): Promise<void> {
    await this.clearHighlight(page);

    try {
      await pwLocator.focus({ timeout: 1000 }).catch(() => {});

      await pwLocator
        .evaluate((el) => {
          el.setAttribute('data-waypoint-highlighted', 'true');
          const htmlEl = el as HTMLElement;
          if (!htmlEl.hasAttribute('data-waypoint-prev-outline')) {
            htmlEl.setAttribute(
              'data-waypoint-prev-outline',
              htmlEl.style.outline || ''
            );
            htmlEl.setAttribute(
              'data-waypoint-prev-offset',
              htmlEl.style.outlineOffset || ''
            );
            htmlEl.setAttribute(
              'data-waypoint-prev-shadow',
              htmlEl.style.boxShadow || ''
            );
          }
          htmlEl.style.setProperty('outline', '3px solid #1a73e8', 'important');
          htmlEl.style.setProperty('outline-offset', '2px', 'important');
          htmlEl.style.setProperty(
            'box-shadow',
            '0 0 0 4px rgba(26, 115, 232, 0.4)',
            'important'
          );
          htmlEl.style.setProperty(
            'transition',
            'outline 0.15s ease, box-shadow 0.15s ease',
            'important'
          );
        })
        .catch(() => {});
    } catch {
      // Best-effort visual feedback; never fail a playback step if highlight fails
    }
  }

  /**
   * Clears any active highlight from the page.
   */
  private async clearHighlight(page: Page): Promise<void> {
    try {
      await page
        .evaluate(() => {
          const highlighted = document.querySelectorAll(
            '[data-waypoint-highlighted="true"]'
          );
          highlighted.forEach((el) => {
            const htmlEl = el as HTMLElement;
            const prevOutline = htmlEl.getAttribute('data-waypoint-prev-outline') ?? '';
            const prevOffset = htmlEl.getAttribute('data-waypoint-prev-offset') ?? '';
            const prevShadow = htmlEl.getAttribute('data-waypoint-prev-shadow') ?? '';
            htmlEl.style.removeProperty('outline');
            htmlEl.style.removeProperty('outline-offset');
            htmlEl.style.removeProperty('box-shadow');
            htmlEl.style.removeProperty('transition');
            if (prevOutline) htmlEl.style.outline = prevOutline;
            if (prevOffset) htmlEl.style.outlineOffset = prevOffset;
            if (prevShadow) htmlEl.style.boxShadow = prevShadow;
            htmlEl.removeAttribute('data-waypoint-highlighted');
            htmlEl.removeAttribute('data-waypoint-prev-outline');
            htmlEl.removeAttribute('data-waypoint-prev-offset');
            htmlEl.removeAttribute('data-waypoint-prev-shadow');
          });
        })
        .catch(() => {});
    } catch {
      // Best-effort
    }
  }

  private async resolveCheck(
    page: Page,
    step: WorkflowStep,
    enabled: boolean
  ): Promise<
    HealingTelemetry & {
      pwLocator: PwLocator;
      resolvedLocator: Locator;
      usedFallback: boolean;
    }
  > {
    const result = await resolveLocator(
      adaptPage(page),
      step,
      this.options.allowedFamily ? { allowedFamily: this.options.allowedFamily } : {}
    );
    if (!isResolveFailure(result))
      return {
        pwLocator: getPwLocator(result.handle),
        resolvedLocator: result.resolvedLocator,
        usedFallback: result.usedFallback,
        healingAttempted: false,
      };
    if (!enabled || !step.snapshot) throw new LocatorResolutionError(result);
    const decision = await heal(stepFrame(page, step), step.snapshot);
    if (!decision.selected) throw new HealingError(decision.telemetry);
    return {
      pwLocator: decision.selected,
      resolvedLocator: decision.telemetry.regeneratedLocator!,
      usedFallback: true,
      ...decision.telemetry,
    };
  }

  private async executeWaitFor(
    page: Page,
    step: Extract<WorkflowStep, { type: 'waitFor' }>,
    timeout: number,
    healingEnabled: boolean
  ): Promise<StepExecutionResult> {
    const { pwLocator, ...result } = await this.resolveCheck(
      page,
      step,
      healingEnabled
    );

    // Map our condition to Playwright's waitFor state
    const stateMap: Record<string, 'attached' | 'detached' | 'visible' | 'hidden'> = {
      attached: 'attached',
      detached: 'detached',
      visible: 'visible',
      hidden: 'hidden',
      enabled: 'visible', // Playwright doesn't have 'enabled' state — use visible + isEnabled check
      disabled: 'visible',
    };

    const state = stateMap[step.condition] ?? 'visible';
    await pwLocator.waitFor({ state, timeout });

    const resolvedTruthId =
      (await pwLocator.getAttribute('data-truth-id').catch(() => null)) ?? undefined;

    // Extra check for enabled/disabled conditions
    if (step.condition === 'enabled') {
      const isEnabled = await pwLocator.isEnabled({ timeout });
      if (!isEnabled) throw new Error('Element is not enabled.');
    } else if (step.condition === 'disabled') {
      const isEnabled = await pwLocator.isEnabled({ timeout });
      if (isEnabled) throw new Error('Element is not disabled.');
    }

    return {
      ...result,
      resolvedTruthId,
    };
  }

  private async executeAssert(
    page: Page,
    step: Extract<WorkflowStep, { type: 'assert' }>,
    timeout: number,
    healingEnabled: boolean
  ): Promise<StepExecutionResult> {
    const { pwLocator, ...result } = await this.resolveCheck(
      page,
      step,
      healingEnabled
    );
    const resolvedTruthId =
      (await pwLocator.getAttribute('data-truth-id').catch(() => null)) ?? undefined;
    const assertion = step.assertion;

    switch (assertion.kind) {
      case 'visible': {
        const visible = await pwLocator.isVisible({ timeout });
        if (!visible) throw new Error('Assertion failed: element is not visible.');
        break;
      }
      case 'hidden': {
        const visible = await pwLocator.isVisible({ timeout });
        if (visible)
          throw new Error('Assertion failed: element is visible but expected hidden.');
        break;
      }
      case 'textEquals': {
        const text = await pwLocator.textContent({ timeout });
        if (text?.trim() !== assertion.expected) {
          throw new Error(
            `Assertion failed: text "${text?.trim()}" does not equal "${assertion.expected}".`
          );
        }
        break;
      }
      case 'textContains': {
        const text = await pwLocator.textContent({ timeout });
        if (!text?.includes(assertion.expected)) {
          throw new Error(
            `Assertion failed: text "${text}" does not contain "${assertion.expected}".`
          );
        }
        break;
      }
      case 'valueEquals': {
        const value = await pwLocator.inputValue({ timeout });
        if (value !== assertion.expected) {
          throw new Error(
            `Assertion failed: value "${value}" does not equal "${assertion.expected}".`
          );
        }
        break;
      }
      case 'attributeEquals': {
        const actual = await pwLocator.getAttribute(assertion.name, { timeout });
        if (actual !== assertion.expected) {
          throw new Error(
            `Assertion failed: attribute "${assertion.name}" is "${actual}" but expected "${assertion.expected}".`
          );
        }
        break;
      }
    }

    return {
      ...result,
      resolvedTruthId,
    };
  }

  private async executeNewTab(
    step: Extract<WorkflowStep, { type: 'newTab' }>
  ): Promise<void> {
    await this.ensureBrowser();
    if (this.attached && step.initialUrl)
      assertSafeAttachedNavigation(this.activePage!.url(), step.initialUrl);
    const newPage = await this.context!.newPage();
    const alias = `tab_${this.tabAliasCounter++}`;
    this.pages.set(alias, newPage);
    this.activePage = newPage;

    if (step.initialUrl) {
      await newPage.goto(step.initialUrl);
    }
  }

  private async executeCloseTab(): Promise<void> {
    if (!this.activePage) return;

    const currentPage = this.activePage;
    // Find and remove from the map
    for (const [alias, page] of this.pages) {
      if (page === currentPage) {
        this.pages.delete(alias);
        break;
      }
    }
    await currentPage.close();

    // Switch to the last remaining page
    const remaining = Array.from(this.pages.values());
    this.activePage = remaining.length > 0 ? remaining[remaining.length - 1]! : null;
  }

  /**
   * Drop the browsing context so the next run builds a fresh one — new
   * cookies, new storage, new page. The browser process itself is kept alive,
   * because relaunching Chromium per run costs seconds and buys nothing: a new
   * context is already a clean slate.
   *
   * Attached browsers are left alone. The user's tabs and session are not ours
   * to clear, and a run in that mode is explicitly not isolated anyway.
   */
  async resetForRun(options: RunTargetOptions = {}): Promise<void> {
    if (this.options.mode === 'attached') {
      await this.dispose();
      this.runTarget = options;
      this.attachedTargetId = undefined;
      if (!options.attachedTarget)
        throw new AttachedBrowserError(
          'attached_target_required',
          'Select a webpage in the Waypoint side panel and run again.'
        );
      if (options.recordedUrl)
        assertSafeAttachedNavigation(options.attachedTarget.url, options.recordedUrl);
      await this.ensureBrowser(); // Fail before accepting a run; never launch/create anything.
      if (
        options.reloadBeforeRun &&
        (!options.recordedUrl ||
          samePageUrl(this.activePage!.url(), options.recordedUrl))
      ) {
        try {
          await this.activePage!.reload({ waitUntil: 'load', timeout: 30_000 });
        } catch (error) {
          await this.dispose();
          throw new AttachedBrowserError(
            'attached_reload_failed',
            `The selected tab could not reload. Check the page and retry: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
          );
        }
        this.initialPageUrl = this.activePage!.url();
      }
      return;
    }
    this.runTarget = options;
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        /* already gone */
      }
      this.context = null;
    }
    this.pages.clear();
    this.activePage = null;
    this.tabAliasCounter = 0;
  }

  async dispose(): Promise<void> {
    // Keep browser open briefly so the user can see the final state
    const keepMs = this.options.keepOpenMs ?? 5000;
    if (keepMs > 0 && this.browser && !this.attached) {
      await new Promise((resolve) => setTimeout(resolve, keepMs));
    }

    if (this.attached) {
      // We did not start this browser, so we do not get to close it. Closing
      // the context would discard the user's real tabs. Drop our references
      // and disconnect, leaving the window exactly as we found it.
      if (this.browser) {
        try {
          await this.browser.close();
        } catch {
          /* disconnects, does not kill Chrome */
        }
        this.browser = null;
      }
      this.context = null;
      this.pages.clear();
      this.activePage = null;
      this.attached = false;
      return;
    }

    if (this.context) {
      try {
        await this.context.close();
      } catch {
        /* swallow */
      }
      this.context = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        /* swallow */
      }
      this.browser = null;
    }
    this.pages.clear();
    this.activePage = null;
  }

  getExecutionConditions(): ExecutionConditions {
    return {
      ...(this.options.allowedFamily
        ? { allowedFamily: this.options.allowedFamily }
        : {}),
      headless: Boolean(this.options.headless),
      slowMo: this.options.slowMo ?? 0,
      contextIsolation: this.options.mode === 'attached' ? 'attached' : 'isolated',
      browserEngine: this.options.mode === 'attached' ? 'cdp' : 'chromium',
      researchEligible: this.options.mode !== 'attached',
      ...(this.options.mode === 'attached'
        ? {
            cdpEndpoint: this.options.cdpEndpoint,
            selectedTabId: this.runTarget.attachedTarget?.tabId,
            selectedWindowId: this.runTarget.attachedTarget?.windowId,
            selectedUrl: this.runTarget.attachedTarget?.url,
            ...(this.runTarget.attachedTarget?.documentId
              ? { selectedDocumentId: this.runTarget.attachedTarget.documentId }
              : {}),
            ...(this.attachedTargetId
              ? { selectedTargetId: this.attachedTargetId }
              : {}),
          }
        : {}),
    };
  }
}

// ---- Helpers ----

/**
 * Creates a production-ready PlaywrightBrowserLauncher.
 * Use this in the runner entry point for real browser automation.
 */
export function createPlaywrightLauncher(
  options?: PlaywrightLauncherOptions
): PlaywrightBrowserLauncher {
  return new PlaywrightBrowserLauncher(options);
}
