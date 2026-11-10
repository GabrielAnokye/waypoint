import {
  WorkflowSchema,
  type ElementSnapshot,
  type Locator,
  type LocatorFamily,
  type WorkflowStep,
} from '@waypoint/shared-types';
import type { Browser, Frame, Page } from 'playwright';
import { installFeatures, snapshotElement } from '../dom-features.js';

export const FAMILIES: LocatorFamily[] = [
  'coordinate',
  'structural',
  'intent',
  'testContract',
];
export const CONDITIONS = [
  'none',
  'cosmetic',
  'attribute',
  'structural',
  'layout',
  'content',
  'semantic',
] as const;
export type Condition = (typeof CONDITIONS)[number];
export interface TargetSpec {
  truth: string;
  frame?: string;
  setup?: string;
  value?: string;
  option?: string;
}
export const TARGETS: Record<string, TargetSpec[]> = {
  forms: [
    { truth: 'login-email', value: 'research@example.com' },
    { truth: 'login-password', value: 'test-password' },
    { truth: 'remember-me' },
    { truth: 'login-submit' },
    { truth: 'reg-name', value: 'Jane Researcher' },
    { truth: 'reg-phone', value: '+15550100' },
    { truth: 'reg-bio', value: 'Benchmark recording' },
    { truth: 'gender-female' },
  ],
  tables: [
    { truth: 'table-search', value: 'User 1' },
    { truth: 'select-all' },
    { truth: 'delete-selected' },
    { truth: 'header-check' },
    { truth: 'row-check-1' },
    { truth: 'row-check-2' },
    { truth: 'delete-1' },
    { truth: 'delete-2' },
  ],
  dropdowns: [
    { truth: 'native-select', option: 'us' },
    { truth: 'native-select', option: 'gh' },
    { truth: 'multi-select', option: 'js' },
    { truth: 'multi-select', option: 'py' },
    { truth: 'custom-trigger' },
    { truth: 'opt-low', setup: 'toggleCustom()' },
    { truth: 'opt-high', setup: 'toggleCustom()' },
    { truth: 'combobox-input', value: 'Accra' },
  ],
  delayed: [
    { truth: 'load-data' },
    { truth: 'load-skeleton' },
    { truth: 'reveal-step1' },
    { truth: 'step1-input', setup: 'revealStep(1)', value: 'Weekly workflow' },
    { truth: 'reveal-step2', setup: 'revealStep(1)' },
    { truth: 'step2-select', setup: 'revealStep(2)', option: 'advanced' },
    { truth: 'reveal-step3', setup: 'revealStep(2)' },
  ],
  iframe: [
    { truth: 'host-button' },
    { truth: 'iframe-name-input', frame: 'form-frame', value: 'Jane' },
    { truth: 'iframe-email-input', frame: 'form-frame', value: 'jane@example.com' },
    { truth: 'iframe-submit', frame: 'form-frame' },
    { truth: 'iframe-btn-approve', frame: 'actions-frame' },
    { truth: 'iframe-btn-reject', frame: 'actions-frame' },
    { truth: 'iframe-btn-escalate', frame: 'actions-frame' },
  ],
  'shadow-dom': [
    { truth: 'light-button' },
    { truth: 'light-input', value: 'Light' },
    { truth: 'shadow-input', value: 'Shadow' },
    { truth: 'shadow-button' },
    { truth: 'nested-outer-button' },
    { truth: 'nested-inner-button' },
    { truth: 'slotted-button' },
  ],
  spa: [
    { truth: 'nav-dashboard' },
    { truth: 'nav-settings' },
    { truth: 'nav-profile' },
    { truth: 'go-dashboard' },
    { truth: 'go-settings' },
    { truth: 'dark-mode', setup: "renderPage('/settings')" },
    { truth: 'save-settings', setup: "renderPage('/settings')" },
    { truth: 'edit-name', setup: "renderPage('/profile/edit')", value: 'Jane Updated' },
  ],
  ambiguous: [
    { truth: 'delete-alpha' },
    { truth: 'delete-beta' },
    { truth: 'delete-gamma' },
    { truth: 'form-a-input', value: 'A' },
    { truth: 'form-b-submit' },
    { truth: 'action-save' },
    { truth: 'bare-second', value: 'Second value' },
  ],
};
export interface BenchmarkStep {
  spec: TargetSpec;
  step: WorkflowStep;
  families: Record<LocatorFamily, Locator>;
  snapshot: ElementSnapshot;
  scroll: { x: number; y: number };
}
export interface BenchmarkWorkflow {
  id: string;
  page: string;
  variant: 'labeled' | 'unlabeled';
  steps: BenchmarkStep[];
}
export async function preparePage(
  page: Page,
  url: string,
  spec: TargetSpec
): Promise<Frame> {
  await page.goto(url, { waitUntil: 'load' });
  if (spec.setup) await page.evaluate(spec.setup);
  const frame = spec.frame ? page.frame({ name: spec.frame }) : page.mainFrame();
  if (!frame) throw new Error(`Missing frame ${spec.frame}`);
  await installFeatures(frame);
  return frame;
}

/** Capture from the unmutated variant once; never recapture on a mutated page. */
export async function captureWorkflows(
  browser: Browser,
  baseUrl: string
): Promise<BenchmarkWorkflow[]> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const workflows: BenchmarkWorkflow[] = [];
  try {
    for (const variant of ['labeled', 'unlabeled'] as const)
      for (const [name, targets] of Object.entries(TARGETS)) {
        const workflow: BenchmarkWorkflow = {
          id: `${name}-${variant}`,
          page: `${name}.html`,
          variant,
          steps: [],
        };
        for (const [index, spec] of targets.entries()) {
          const frame = await preparePage(
            page,
            `${baseUrl}/${name}.html?variant=${variant}`,
            spec
          );
          // Annotation-only selector: used exclusively while making the baseline recording.
          const target = frame.locator(`[data-truth-id="${spec.truth}"]`);
          if ((await target.count()) !== 1)
            throw new Error(`Capture target is not unique: ${spec.truth}`);
          await target.scrollIntoViewIfNeeded();
          const snapshot = await snapshotElement(target, true);
          const details = await target.evaluate((el) => {
            const parts: string[] = [];
            let node: Element | null = el;
            while (node) {
              const siblings: Element[] = node.parentElement
                ? [...node.parentElement.children].filter(
                    (e) => e.tagName === node!.tagName
                  )
                : [node];
              parts.unshift(
                `${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`
              );
              const parent: Element | null = node.parentElement;
              if (!parent) {
                const host: Element | undefined = (node.getRootNode() as ShadowRoot)
                  .host;
                if (host) {
                  parts.unshift('>>>');
                  node = host;
                  continue;
                }
              }
              node = parent;
            }
            return {
              css: parts.join(' > ').replace(/ > >>> > /g, ' > '),
              testId: el.getAttribute('data-testid'),
            };
          });
          if ((await frame.locator(details.css).count()) !== 1)
            throw new Error(`Non-unique structural capture: ${details.css}`);
          const box = await target.boundingBox();
          if (!box) throw new Error(`Invisible capture target: ${spec.truth}`);
          const families: Record<LocatorFamily, Locator> = {
            coordinate: {
              kind: 'coordinates',
              x: Math.round(box.x + box.width / 2),
              y: Math.round(box.y + box.height / 2),
            },
            structural: { kind: 'css', selector: details.css },
            intent:
              snapshot.role && snapshot.accessibleName
                ? { kind: 'role', role: snapshot.role, name: snapshot.accessibleName }
                : snapshot.placeholder
                  ? { kind: 'placeholder', placeholder: snapshot.placeholder }
                  : snapshot.innerText
                    ? { kind: 'text', text: snapshot.innerText, exact: true }
                    : {
                        kind: 'role',
                        role: snapshot.role ?? 'generic',
                        name: '__absent_capture_name__',
                      },
            // An absent test contract remains absent. Never invent one from truth.
            testContract: {
              kind: 'testId',
              testId: details.testId ?? '__absent_capture_test_contract__',
            },
          };
          const parsed = WorkflowSchema.parse({
            trigger: { type: 'manual' },
            createdAt: '2026-11-10T12:00:00.000Z',
            updatedAt: '2026-11-10T12:00:00.000Z',
            schemaVersion: 1,
            workflowId: `benchmark-${workflow.id}`,
            workflowVersion: 1,
            name: workflow.id,
            steps: [
              {
                id: `${workflow.id}-${index}`,
                type:
                  spec.value !== undefined ? 'type' : spec.option ? 'select' : 'click',
                primaryLocator: families.intent,
                fallbackLocators: [
                  families.testContract,
                  families.structural,
                  families.coordinate,
                ],
                snapshot,
                dataTruthId: snapshot.expectedTruthId,
                ...(spec.frame
                  ? {
                      framePath: [
                        {
                          index: spec.frame === 'form-frame' ? 0 : 1,
                          name: spec.frame,
                        },
                      ],
                    }
                  : {}),
                ...(spec.value !== undefined
                  ? { value: spec.value }
                  : spec.option
                    ? { option: { by: 'value', value: spec.option } }
                    : {}),
              },
            ],
          });
          workflow.steps.push({
            spec,
            families,
            snapshot,
            step: parsed.steps[0]!,
            scroll: await page.evaluate(() => ({ x: scrollX, y: scrollY })),
          });
        }
        workflows.push(workflow);
      }
  } finally {
    await context.close();
  }
  if (
    workflows.length !== 16 ||
    workflows.reduce((n, w) => n + w.steps.length, 0) !== 120
  )
    throw new Error('Invalid canonical suite size');
  return workflows;
}
