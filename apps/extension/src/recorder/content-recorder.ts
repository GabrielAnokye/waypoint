/**
 * Page-side capture module injected by the service worker when recording
 * starts. Installs DOM event listeners and emits RawRecordedEventInput
 * objects via a Chrome runtime port.
 *
 * This module is meant to be compiled as a standalone entry and
 * `chrome.scripting.executeScript`'d into the target tab.
 */

import type { RawRecordedEventInput, Target } from '@waypoint/shared-types';

import { EventBuffer } from './event-buffer.js';
import { shouldRedact } from './redact.js';
import { buildCssCandidate, buildXpathFallback, type ElementDescriptor } from './selector.js';

let eventCounter = 0;

function nextEventId(): string {
  return `evt_${++eventCounter}`;
}

// ---- Element snapshot helpers ----

function getFramePath(): Array<{ index: number; name?: string; url?: string }> | undefined {
  try {
    if (window === window.top) return undefined;
    const entries: Array<{ index: number; name?: string; url?: string }> = [];
    let current: Window = window;
    while (current !== current.top && current.frameElement) {
      const fe = current.frameElement as HTMLIFrameElement;
      const parent = current.parent;
      const siblings = parent.document.querySelectorAll('iframe, frame');
      let index = 0;
      for (let i = 0; i < siblings.length; i++) {
        if (siblings[i] === fe) {
          index = i;
          break;
        }
      }
      entries.unshift({
        index,
        ...(fe.name ? { name: fe.name } : {}),
        ...(fe.src ? { url: fe.src } : {})
      });
      current = parent;
    }
    return entries.length > 0 ? entries : undefined;
  } catch {
    return undefined;
  }
}

function getDescriptor(el: Element, depth = 0): ElementDescriptor {
  const tag = el.tagName;
  const id = el.id || undefined;
  const testId = el.getAttribute('data-testid') ?? undefined;
  const classList = el.classList.length > 0 ? [...el.classList] : undefined;

  let nthOfType: number | undefined;
  if (el.parentElement) {
    const siblings = el.parentElement.querySelectorAll(`:scope > ${tag}`);
    if (siblings.length > 1) {
      for (let i = 0; i < siblings.length; i++) {
        if (siblings[i] === el) {
          nthOfType = i + 1;
          break;
        }
      }
    }
  }

  const parentDescriptors: ElementDescriptor[] = [];
  if (depth < 3 && el.parentElement && el.parentElement !== document.documentElement) {
    parentDescriptors.push(getDescriptor(el.parentElement, depth + 1));
  }

  return {
    tagName: tag,
    ...(id ? { id } : {}),
    ...(testId ? { testId } : {}),
    ...(classList ? { classList } : {}),
    ...(nthOfType ? { nthOfType } : {}),
    parentDescriptors
  };
}

function getNearbyText(el: Element, maxLen = 120): string | undefined {
  let text = '';
  let current: Element | null = el;
  for (let i = 0; i < 3 && current; i++) {
    const tc = current.textContent?.trim();
    if (tc) {
      text = tc;
      if (text.length >= 10) break;
    }
    current = current.parentElement;
  }
  return text ? text.slice(0, maxLen) : undefined;
}

function getRole(el: Element): string | undefined {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const implicitMap: Record<string, string> = {
    A: 'link', BUTTON: 'button', INPUT: 'textbox',
    SELECT: 'combobox', TEXTAREA: 'textbox', IMG: 'img',
    NAV: 'navigation', MAIN: 'main', HEADER: 'banner',
    FOOTER: 'contentinfo', FORM: 'form', TABLE: 'table',
    DIALOG: 'dialog'
  };
  const inputEl = el as HTMLInputElement;
  if (el.tagName === 'INPUT') {
    if (inputEl.type === 'checkbox') return 'checkbox';
    if (inputEl.type === 'radio') return 'radio';
    if (inputEl.type === 'submit' || inputEl.type === 'button') return 'button';
  }
  return implicitMap[el.tagName];
}

function getAccessibleName(el: Element): string | undefined {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;
  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const parts = ariaLabelledBy.split(/\s+/).map((id) => {
      const ref = document.getElementById(id);
      return ref?.textContent?.trim() ?? '';
    }).filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }
  if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
    const inputEl = el as HTMLInputElement;
    if (inputEl.labels && inputEl.labels.length > 0) {
      return inputEl.labels[0]!.textContent?.trim() || undefined;
    }
  }
  if (el.tagName === 'BUTTON' || el.tagName === 'A') {
    return el.textContent?.trim() || undefined;
  }
  return undefined;
}

function getLabelText(el: Element): string | undefined {
  if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
    const inputEl = el as HTMLInputElement;
    if (inputEl.labels && inputEl.labels.length > 0) {
      return inputEl.labels[0]!.textContent?.trim() || undefined;
    }
  }
  return undefined;
}

function buildTarget(el: Element): Target {
  const role = getRole(el);
  const name = getAccessibleName(el);
  const labelText = getLabelText(el);
  const placeholder = el.getAttribute('placeholder') ?? undefined;
  const testId = el.getAttribute('data-testid') ?? undefined;
  const desc = getDescriptor(el);
  const cssCandidate = buildCssCandidate(desc);
  const xpathFallback = buildXpathFallback(desc);
  const framePath = getFramePath();

  // Build locators in priority order.
  const locators: Array<Record<string, unknown>> = [];

  if (role && name) {
    locators.push({ kind: 'role', role, name });
  }
  if (testId) {
    locators.push({ kind: 'testId', testId });
  }
  if (labelText) {
    locators.push({ kind: 'label', label: labelText });
  }
  if (placeholder) {
    locators.push({ kind: 'placeholder', placeholder });
  }
  if (cssCandidate) {
    locators.push({ kind: 'css', selector: cssCandidate });
  }
  if (xpathFallback) {
    locators.push({ kind: 'xpath', selector: xpathFallback });
  }

  // If nothing semantic found, fallback to coordinates.
  if (locators.length === 0) {
    const rect = el.getBoundingClientRect();
    locators.push({ kind: 'coordinates', x: Math.round(rect.x), y: Math.round(rect.y) });
  }

  const primary = locators[0]!;
  const fallbacks = locators.slice(1);

  return {
    primaryLocator: primary as Target['primaryLocator'],
    fallbackLocators: fallbacks as Target['fallbackLocators'],
    ...(framePath ? { framePath } : {})
  };
}

function buildElementSnapshot(el: Element) {
  const role = getRole(el);
  const name = getAccessibleName(el);
  const labelText = getLabelText(el);
  const desc = getDescriptor(el);
  const inputEl = el as HTMLInputElement;

  return {
    tagName: el.tagName,
    textContent: el.textContent?.trim()?.slice(0, 200) || undefined,
    attributes: Object.fromEntries(
      [...el.attributes]
        .filter((a) => !a.name.startsWith('on'))
        .map((a) => [a.name, a.value])
    ),
    role,
    accessibleName: name,
    labelText,
    placeholder: el.getAttribute('placeholder') ?? undefined,
    nameAttr: el.getAttribute('name') ?? undefined,
    testId: el.getAttribute('data-testid') ?? undefined,
    nearbyText: getNearbyText(el),
    cssCandidate: buildCssCandidate(desc),
    xpathFallback: buildXpathFallback(desc),
    boundingRect: (() => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    })(),
    framePath: getFramePath(),
    pageUrl: window.location.href,
    isPasswordField: inputEl.type === 'password',
    isSensitiveHeuristic: shouldRedact({
      type: inputEl.type,
      ...(el.getAttribute('autocomplete') ? { autocomplete: el.getAttribute('autocomplete')! } : {}),
      ...(el.getAttribute('name') ? { name: el.getAttribute('name')! } : {}),
      ...(el.id ? { id: el.id } : {})
    }).redacted
  };
}

// ---- Main recorder entry ----

export interface ContentRecorderOptions {
  tabId: string;
  startedAtMs: number;
  onEvents: (events: RawRecordedEventInput[]) => void;
}

export class ContentRecorder {
  private readonly tabId: string;
  private readonly startedAtMs: number;
  private readonly buffer: EventBuffer;
  private disposed = false;
  private cleanupFns: Array<() => void> = [];

  constructor(options: ContentRecorderOptions) {
    this.tabId = options.tabId;
    this.startedAtMs = options.startedAtMs;
    this.buffer = new EventBuffer({
      onFlush: options.onEvents
    });
  }

  private atMs(): number {
    return Date.now() - this.startedAtMs;
  }

  /** Install all event listeners. */
  start(): void {
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    const doc = document;

    const onClickCapture = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el) return;
      const buttonMap: Record<number, 'left' | 'middle' | 'right'> = { 0: 'left', 1: 'middle', 2: 'right' };
      this.buffer.push({
        eventId: nextEventId(),
        type: 'click',
        atMs: this.atMs(),
        tabId: this.tabId,
        target: buildTarget(el),
        element: buildElementSnapshot(el),
        button: buttonMap[e.button] ?? 'left'
      });
    };

    const onInput = (e: Event) => {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return;
      const redaction = shouldRedact({
        type: (el as HTMLInputElement).type,
        ...(el.getAttribute('autocomplete') ? { autocomplete: el.getAttribute('autocomplete')! } : {}),
        ...(el.getAttribute('name') ? { name: el.getAttribute('name')! } : {}),
        ...(el.id ? { id: el.id } : {})
      });
      this.buffer.push({
        eventId: nextEventId(),
        type: 'input',
        atMs: this.atMs(),
        tabId: this.tabId,
        target: buildTarget(el),
        element: buildElementSnapshot(el),
        value: redaction.redacted ? '' : el.value,
        redacted: redaction.redacted
      });
    };

    const onChange = (e: Event) => {
      const el = e.target as HTMLSelectElement | null;
      if (!el || el.tagName !== 'SELECT') return;
      const selected = el.options[el.selectedIndex];
      if (!selected) return;
      this.buffer.push({
        eventId: nextEventId(),
        type: 'select',
        atMs: this.atMs(),
        tabId: this.tabId,
        target: buildTarget(el),
        option: { by: 'label', value: selected.text },
        element: buildElementSnapshot(el)
      });
    };

    const onSubmit = (e: Event) => {
      const el = e.target as Element | null;
      if (!el) return;
      this.buffer.push({
        eventId: nextEventId(),
        type: 'submit',
        atMs: this.atMs(),
        tabId: this.tabId,
        target: buildTarget(el),
        element: buildElementSnapshot(el)
      });
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as Element | null;
      if (!el) return;
      this.buffer.push({
        eventId: nextEventId(),
        type: 'focus',
        atMs: this.atMs(),
        tabId: this.tabId,
        target: buildTarget(el)
      });
    };

    const onFocusOut = (e: FocusEvent) => {
      const el = e.target as Element | null;
      if (!el) return;
      this.buffer.push({
        eventId: nextEventId(),
        type: 'blur',
        atMs: this.atMs(),
        tabId: this.tabId,
        target: buildTarget(el)
      });
    };

    // History API monkey-patching
    const origPushState = history.pushState.bind(history);
    const origReplaceState = history.replaceState.bind(history);

    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      origPushState(...args);
      this.emitHistoryChange('pushState');
    };
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      origReplaceState(...args);
      this.emitHistoryChange('replaceState');
    };

    const onPopState = () => this.emitHistoryChange('popstate');
    const onHashChange = () => this.emitHistoryChange('hashchange');

    doc.addEventListener('click', onClickCapture, opts);
    doc.addEventListener('input', onInput, opts);
    doc.addEventListener('change', onChange, opts);
    doc.addEventListener('submit', onSubmit, opts);
    doc.addEventListener('focusin', onFocusIn, opts);
    doc.addEventListener('focusout', onFocusOut, opts);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);

    this.cleanupFns.push(
      () => doc.removeEventListener('click', onClickCapture, opts),
      () => doc.removeEventListener('input', onInput, opts),
      () => doc.removeEventListener('change', onChange, opts),
      () => doc.removeEventListener('submit', onSubmit, opts),
      () => doc.removeEventListener('focusin', onFocusIn, opts),
      () => doc.removeEventListener('focusout', onFocusOut, opts),
      () => window.removeEventListener('popstate', onPopState),
      () => window.removeEventListener('hashchange', onHashChange),
      () => { history.pushState = origPushState; },
      () => { history.replaceState = origReplaceState; }
    );
  }

  private emitHistoryChange(kind: 'pushState' | 'replaceState' | 'popstate' | 'hashchange'): void {
    this.buffer.push({
      eventId: nextEventId(),
      type: 'historyChange',
      atMs: this.atMs(),
      tabId: this.tabId,
      kind,
      url: window.location.href
    });
  }

  /** Tear down all listeners and flush pending events. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
    this.buffer.dispose();
  }
}
