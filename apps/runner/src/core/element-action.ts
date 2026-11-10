import type { ElementHandle, Frame, Locator as PwLocator, Page } from 'playwright';
import {
  type HealingTelemetry,
  type Locator,
  type LocatorFamily,
  type WorkflowStep,
} from '@waypoint/shared-types';
import type { StepExecutionResult } from './executor.js';
import {
  resolveLocator,
  isResolveFailure,
  LocatorResolutionError,
  type LocatablePage,
  type LocatableHandle,
} from './locate.js';
import { heal, HealingError, type Thresholds } from './healer.js';

export function adaptScope(scope: Page | Frame): LocatablePage {
  const wrap = (locator: PwLocator): LocatableHandle =>
    ({ count: () => locator.count(), _pw: locator }) as LocatableHandle;
  return {
    getByRole: (role, options) =>
      wrap(
        scope.getByRole(role as Parameters<Page['getByRole']>[0], {
          ...options,
          exact: true,
        })
      ),
    getByLabel: (label) => wrap(scope.getByLabel(label, { exact: true })),
    getByText: (text, options) => wrap(scope.getByText(text, options)),
    getByTestId: (id) => wrap(scope.getByTestId(id)),
    getByPlaceholder: (text) => wrap(scope.getByPlaceholder(text, { exact: true })),
    locator: (selector) => wrap(scope.locator(selector)),
    frameLocator: () => {
      throw new Error('Frame context must be selected before adapting');
    },
  };
}
export function stepFrame(page: Page, step: WorkflowStep): Frame {
  let frame = page.mainFrame();
  if ('framePath' in step && step.framePath)
    for (const part of step.framePath) {
      const next = part.name
        ? frame.childFrames().find((f) => f.name() === part.name)
        : frame.childFrames()[part.index];
      if (!next) throw new Error('frame_mismatch: recorded frame is absent');
      frame = next;
    }
  return frame;
}
export interface ActionOptions {
  allowedFamily?: LocatorFamily;
  healingEnabled?: boolean;
  thresholds?: Thresholds;
  beforeAction?: (locator: PwLocator) => Promise<void>;
}

/** Shared by production playback and the empirical harness. Truth is read only
 * after resolution/healing has committed to an element, never to choose one. */
export async function executeElementAction(
  page: Page,
  step: WorkflowStep,
  options: ActionOptions = {}
): Promise<StepExecutionResult> {
  if (!('primaryLocator' in step)) throw new Error('An interactive step is required');
  const frame = stepFrame(page, step);
  let selected: PwLocator | ElementHandle<Element> | undefined;
  let resolvedLocator: Locator | undefined;
  let usedFallback = false;
  let telemetry: HealingTelemetry = { healingAttempted: false };
  const chain = [step.primaryLocator, ...step.fallbackLocators];
  const coordinate =
    options.allowedFamily === 'coordinate'
      ? chain.find((l) => l.kind === 'coordinates')
      : options.allowedFamily === undefined &&
          step.primaryLocator.kind === 'coordinates'
        ? step.primaryLocator
        : undefined;
  if (coordinate?.kind === 'coordinates') {
    const hit = await page.evaluateHandle(({ x, y }) => {
      let root: Document | ShadowRoot = document;
      let xx = x,
        yy = y;
      let element = root.elementFromPoint(xx, yy);
      while (element) {
        if (element.tagName === 'IFRAME') {
          const child = (element as HTMLIFrameElement).contentDocument;
          if (!child) break;
          const rect = element.getBoundingClientRect();
          xx -= rect.left + (element as HTMLElement).clientLeft;
          yy -= rect.top + (element as HTMLElement).clientTop;
          root = child;
          element = root.elementFromPoint(xx, yy);
          continue;
        }
        if (element.shadowRoot) {
          const deeper = element.shadowRoot.elementFromPoint(xx, yy);
          if (deeper && deeper !== element) {
            root = element.shadowRoot;
            element = deeper;
            continue;
          }
        }
        break;
      }
      return (
        element?.closest(
          'button,input,select,textarea,a[href],[role],[tabindex],[onclick]'
        ) ?? null
      );
    }, coordinate);
    selected = (hit.asElement() as ElementHandle<Element> | undefined) ?? undefined;
    resolvedLocator = coordinate;
  } else {
    // We already selected the frame; the resolver must not traverse it again.
    const framedStep = { ...step, framePath: undefined };
    const resolution = await resolveLocator(
      adaptScope(frame),
      framedStep,
      options.allowedFamily ? { allowedFamily: options.allowedFamily } : {}
    );
    if (!isResolveFailure(resolution)) {
      selected = (resolution.handle as LocatableHandle & { _pw: PwLocator })._pw;
      resolvedLocator = resolution.resolvedLocator;
      usedFallback = resolution.usedFallback;
    } else if (!options.healingEnabled || !step.snapshot)
      throw new LocatorResolutionError(resolution);
  }
  if (selected) {
    const action =
      step.type === 'type'
        ? { type: 'type' as const, value: step.value }
        : step.type === 'select'
          ? { type: 'select' as const, option: step.option }
          : { type: 'other' as const };
    const compatible = await (selected as ElementHandle<Element>).evaluate(
      (el, action) => {
        if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly)
          return false;
        if (action.type === 'type') {
          if (el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)
            return true;
          if (el.tagName !== 'INPUT') return false;
          const type = (el as HTMLInputElement).type;
          if (
            ![
              'text',
              'email',
              'password',
              'search',
              'tel',
              'url',
              'number',
              'date',
              'time',
              'datetime-local',
              'month',
              'week',
            ].includes(type)
          )
            return false;
          const probe = el.ownerDocument.createElement('input');
          probe.type = type;
          probe.value = action.value;
          return probe.value === action.value;
        }
        if (action.type === 'select') {
          if (el.tagName !== 'SELECT') return false;
          const options = Array.from((el as HTMLSelectElement).options);
          return options.some(
            (option, index) =>
              !option.disabled &&
              (action.option.by === 'index'
                ? index === Number(action.option.value)
                : action.option.by === 'label'
                  ? option.label === String(action.option.value)
                  : option.value === String(action.option.value))
          );
        }
        return true;
      },
      action
    );
    if (!compatible || !(await selected.isVisible())) {
      if (!('count' in selected)) await selected.dispose();
      selected = undefined;
    }
  }
  if (!selected) {
    if (!options.healingEnabled || !step.snapshot)
      throw new Error(
        'locator_not_found: no visible target supports the recorded action'
      );
    const decision = await heal(frame, step.snapshot, options.thresholds);
    telemetry = decision.telemetry;
    if (!decision.selected) throw new HealingError(telemetry);
    selected = decision.selected;
    resolvedLocator = telemetry.regeneratedLocator ?? undefined;
    usedFallback = true;
  }
  // A non-coordinate missing locator reaches here only via healing.
  if (!selected) throw new Error('locator_not_found');
  // Persist a short-lived locator for coordinate-selected elements as a diagnostic.
  if ('count' in selected && options.beforeAction) await options.beforeAction(selected);
  const resolvedTruthId = (await selected.getAttribute('data-truth-id')) ?? undefined;
  const timeout = step.timeoutMs;
  try {
    if (step.type === 'click') {
      if (coordinate?.kind === 'coordinates' && !telemetry.healingAttempted)
        await page.mouse.click(coordinate.x, coordinate.y, {
          button: step.button,
          clickCount: step.clickCount,
        });
      else
        await selected.click({
          button: step.button,
          clickCount: step.clickCount,
          timeout,
        });
    } else if (step.type === 'type') await selected.fill(step.value, { timeout });
    else if (step.type === 'select') {
      const value =
        step.option.by === 'index'
          ? { index: Number(step.option.value) }
          : step.option.by === 'label'
            ? { label: String(step.option.value) }
            : { value: String(step.option.value) };
      await selected.selectOption(value, { timeout });
    } else if (step.type === 'press')
      await selected.press([...step.modifiers, step.key].join('+'), { timeout });
    else throw new Error(`Unsupported action ${step.type}`);
  } catch (error) {
    if (telemetry.healingAttempted && error instanceof Error)
      Object.assign(error, { telemetry });
    throw error;
  } finally {
    if (!('count' in selected)) await selected.dispose();
  }
  return { resolvedLocator, usedFallback, resolvedTruthId, ...telemetry };
}
