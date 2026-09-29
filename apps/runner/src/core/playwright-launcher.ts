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
  type Page
} from 'playwright';

import type { WorkflowStep } from '@waypoint/shared-types';

import type { BrowserLauncher, ExecuteStepContext, StepExecutionResult } from './executor.js';
import {
  resolveLocator,
  isResolveFailure,
  type LocatablePage,
  type LocatableHandle
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
    frameLocator: (selector: string) => adaptFrameLocator(page.frameLocator(selector))
  };
}

function adaptHandle(loc: PwLocator): LocatableHandle {
  return {
    count: () => loc.count(),
    first: () => adaptHandle(loc.first()),
    // Expose the underlying Playwright locator for action methods
    _pw: loc
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
    frameLocator: (selector: string) => adaptFrameLocator(fl.frameLocator(selector))
  };
}

/** Extract the underlying Playwright Locator from an adapted handle. */
function getPwLocator(handle: LocatableHandle): PwLocator {
  return (handle as LocatableHandle & { _pw: PwLocator })._pw;
}

// ---- PlaywrightBrowserLauncher ----

export interface PlaywrightLauncherOptions {
  /** Launch browser in headless mode. Default: false (visible). */
  headless?: boolean;
  /** Slow down actions by this many ms for visibility. Default: 0. */
  slowMo?: number;
  /** Auth profile storage state path (for pre-authenticated sessions). */
  storageStatePath?: string;
  /** Custom browser profile directory. */
  profileDirectory?: string;
  /** How many ms to keep the browser open after the run finishes. Default: 5000. */
  keepOpenMs?: number;
}

export class PlaywrightBrowserLauncher implements BrowserLauncher {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Map<string, Page> = new Map();
  private activePage: Page | null = null;
  private options: PlaywrightLauncherOptions;
  private tabAliasCounter = 0;

  constructor(options: PlaywrightLauncherOptions = {}) {
    this.options = {
      headless: false,
      slowMo: 50,
      ...options
    };
  }

  private async ensureBrowser(): Promise<BrowserContext> {
    if (this.context) return this.context;

    const launchOptions: Parameters<typeof chromium.launch>[0] = {};
    if (this.options.headless !== undefined) launchOptions.headless = this.options.headless;
    if (this.options.slowMo !== undefined) launchOptions.slowMo = this.options.slowMo;

    this.browser = await chromium.launch(launchOptions);

    const contextOptions: Parameters<Browser['newContext']>[0] = {
      viewport: { width: 1280, height: 800 }
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

  private async getActivePage(): Promise<Page> {
    await this.ensureBrowser();
    if (!this.activePage) {
      throw new Error('No active page available.');
    }
    return this.activePage;
  }

  async executeStep(
    step: WorkflowStep,
    _ctx: ExecuteStepContext
  ): Promise<StepExecutionResult | void> {
    const page = await this.getActivePage();
    const timeout = step.timeoutMs ?? 30_000;

    switch (step.type) {
      case 'goto':
        return this.executeGoto(page, step, timeout);

      case 'click':
        return this.executeClick(page, step, timeout);

      case 'type':
        return this.executeType(page, step, timeout);

      case 'select':
        return this.executeSelect(page, step, timeout);

      case 'press':
        return this.executePress(page, step, timeout);

      case 'waitFor':
        return this.executeWaitFor(page, step, timeout);

      case 'assert':
        return this.executeAssert(page, step, timeout);

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
    const normalize = (u: string) => u.replace(/\/+$/, '').replace(/#.*$/, '');
    if (normalize(currentUrl) === normalize(step.url)) {
      return;
    }
    await page.goto(step.url, {
      waitUntil: step.waitUntil,
      timeout
    });
  }

  private async executeClick(
    page: Page,
    step: Extract<WorkflowStep, { type: 'click' }>,
    timeout: number
  ): Promise<StepExecutionResult> {
    const adapted = adaptPage(page);
    const result = await resolveLocator(adapted, step);

    if (isResolveFailure(result)) {
      throw new Error(
        `Click failed: ${result.failureCode} — ${result.repairRecord.suggestion}`
      );
    }

    const pwLocator = getPwLocator(result.handle);
    await pwLocator.click({
      button: step.button,
      clickCount: step.clickCount,
      timeout
    });

    return {
      resolvedLocator: result.resolvedLocator,
      usedFallback: result.usedFallback
    };
  }

  private async executeType(
    page: Page,
    step: Extract<WorkflowStep, { type: 'type' }>,
    timeout: number
  ): Promise<StepExecutionResult> {
    const adapted = adaptPage(page);
    const result = await resolveLocator(adapted, step);

    if (isResolveFailure(result)) {
      throw new Error(
        `Type failed: ${result.failureCode} — ${result.repairRecord.suggestion}`
      );
    }

    const pwLocator = getPwLocator(result.handle);
    if (step.clearBefore) {
      await pwLocator.clear({ timeout });
    }
    await pwLocator.fill(step.value, { timeout });

    return {
      resolvedLocator: result.resolvedLocator,
      usedFallback: result.usedFallback
    };
  }

  private async executeSelect(
    page: Page,
    step: Extract<WorkflowStep, { type: 'select' }>,
    timeout: number
  ): Promise<StepExecutionResult> {
    const adapted = adaptPage(page);
    const result = await resolveLocator(adapted, step);

    if (isResolveFailure(result)) {
      throw new Error(
        `Select failed: ${result.failureCode} — ${result.repairRecord.suggestion}`
      );
    }

    const pwLocator = getPwLocator(result.handle);
    const { by, value } = step.option;

    if (by === 'label') {
      await pwLocator.selectOption({ label: String(value) }, { timeout });
    } else if (by === 'value') {
      await pwLocator.selectOption({ value: String(value) }, { timeout });
    } else {
      // by === 'index'
      await pwLocator.selectOption({ index: Number(value) }, { timeout });
    }

    return {
      resolvedLocator: result.resolvedLocator,
      usedFallback: result.usedFallback
    };
  }

  private async executePress(
    page: Page,
    step: Extract<WorkflowStep, { type: 'press' }>,
    timeout: number
  ): Promise<StepExecutionResult> {
    // If the step has a target locator, focus the element first
    if ('primaryLocator' in step && step.primaryLocator) {
      const adapted = adaptPage(page);
      const result = await resolveLocator(adapted, step);

      if (isResolveFailure(result)) {
        throw new Error(
          `Press failed: ${result.failureCode} — ${result.repairRecord.suggestion}`
        );
      }

      const pwLocator = getPwLocator(result.handle);
      // Build the key combo with modifiers
      const key = buildKeyCombo(step.key, step.modifiers);
      await pwLocator.press(key, { timeout });

      return {
        resolvedLocator: result.resolvedLocator,
        usedFallback: result.usedFallback
      };
    }

    // No target — press on the page (keyboard-level)
    const key = buildKeyCombo(step.key, step.modifiers);
    await page.keyboard.press(key);
    return {};
  }

  private async executeWaitFor(
    page: Page,
    step: Extract<WorkflowStep, { type: 'waitFor' }>,
    timeout: number
  ): Promise<StepExecutionResult> {
    const adapted = adaptPage(page);
    const result = await resolveLocator(adapted, step);

    if (isResolveFailure(result)) {
      throw new Error(
        `WaitFor failed: ${result.failureCode} — ${result.repairRecord.suggestion}`
      );
    }

    const pwLocator = getPwLocator(result.handle);

    // Map our condition to Playwright's waitFor state
    const stateMap: Record<string, 'attached' | 'detached' | 'visible' | 'hidden'> = {
      attached: 'attached',
      detached: 'detached',
      visible: 'visible',
      hidden: 'hidden',
      enabled: 'visible', // Playwright doesn't have 'enabled' state — use visible + isEnabled check
      disabled: 'visible'
    };

    const state = stateMap[step.condition] ?? 'visible';
    await pwLocator.waitFor({ state, timeout });

    // Extra check for enabled/disabled conditions
    if (step.condition === 'enabled') {
      const isEnabled = await pwLocator.isEnabled({ timeout });
      if (!isEnabled) throw new Error('Element is not enabled.');
    } else if (step.condition === 'disabled') {
      const isEnabled = await pwLocator.isEnabled({ timeout });
      if (isEnabled) throw new Error('Element is not disabled.');
    }

    return {
      resolvedLocator: result.resolvedLocator,
      usedFallback: result.usedFallback
    };
  }

  private async executeAssert(
    page: Page,
    step: Extract<WorkflowStep, { type: 'assert' }>,
    timeout: number
  ): Promise<StepExecutionResult> {
    const adapted = adaptPage(page);
    const result = await resolveLocator(adapted, step);

    if (isResolveFailure(result)) {
      throw new Error(
        `Assert failed: ${result.failureCode} — ${result.repairRecord.suggestion}`
      );
    }

    const pwLocator = getPwLocator(result.handle);
    const assertion = step.assertion;

    switch (assertion.kind) {
      case 'visible': {
        const visible = await pwLocator.isVisible({ timeout });
        if (!visible) throw new Error('Assertion failed: element is not visible.');
        break;
      }
      case 'hidden': {
        const visible = await pwLocator.isVisible({ timeout });
        if (visible) throw new Error('Assertion failed: element is visible but expected hidden.');
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
      resolvedLocator: result.resolvedLocator,
      usedFallback: result.usedFallback
    };
  }

  private async executeNewTab(
    step: Extract<WorkflowStep, { type: 'newTab' }>
  ): Promise<void> {
    await this.ensureBrowser();
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

  async dispose(): Promise<void> {
    // Keep browser open briefly so the user can see the final state
    const keepMs = this.options.keepOpenMs ?? 5000;
    if (keepMs > 0 && this.browser) {
      await new Promise((resolve) => setTimeout(resolve, keepMs));
    }

    if (this.context) {
      try { await this.context.close(); } catch { /* swallow */ }
      this.context = null;
    }
    if (this.browser) {
      try { await this.browser.close(); } catch { /* swallow */ }
      this.browser = null;
    }
    this.pages.clear();
    this.activePage = null;
  }
}

// ---- Helpers ----

function buildKeyCombo(key: string, modifiers: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>): string {
  if (modifiers.length === 0) return key;
  return [...modifiers, key].join('+');
}

/**
 * Creates a production-ready PlaywrightBrowserLauncher.
 * Use this in the runner entry point for real browser automation.
 */
export function createPlaywrightLauncher(
  options?: PlaywrightLauncherOptions
): PlaywrightBrowserLauncher {
  return new PlaywrightBrowserLauncher(options);
}
