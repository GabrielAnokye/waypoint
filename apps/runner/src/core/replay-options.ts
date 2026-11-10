import type { AttachedTarget, Workflow } from '@waypoint/shared-types';
import { assertSafeAttachedNavigation, AttachedBrowserError } from './debug-browser.js';

/** Change only the starting navigation for this run; keep the saved recording intact. */
export function prepareReplayWorkflow(
  workflow: Workflow,
  options: {
    useSelectedPage?: boolean | undefined;
    attachedTarget?: AttachedTarget | undefined;
  }
): Workflow {
  if (!options.useSelectedPage) return workflow;
  const target = options.attachedTarget;
  if (!target)
    throw new AttachedBrowserError(
      'attached_target_required',
      'Select the webpage to replay before running.'
    );
  assertSafeAttachedNavigation(target.url, target.url);
  const firstGotoIndex = workflow.steps.findIndex(
    (step) => step.enabled && step.type === 'goto'
  );
  if (firstGotoIndex === -1) return workflow;
  const recordedStep = workflow.steps[firstGotoIndex]!;
  if (recordedStep.type !== 'goto') return workflow;
  const recorded = new URL(recordedStep.url);
  const selected = new URL(target.url);
  const loopback = (url: URL) =>
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const filename = (url: URL) => url.pathname.split('/').filter(Boolean).at(-1);
  const sameRoute =
    recorded.origin === selected.origin && recorded.pathname === selected.pathname;
  const localFixture =
    (recorded.protocol === 'file:' || loopback(recorded)) &&
    (selected.protocol === 'file:' || loopback(selected)) &&
    filename(recorded)?.endsWith('.html') &&
    filename(recorded) === filename(selected);
  if (!sameRoute && !localFixture)
    throw new AttachedBrowserError(
      'selected_page_mismatch',
      'Select the matching webpage before replaying. Use the same route or the matching locally served fixture filename. To replay on a different page, edit the recording’s first Go to URL.'
    );
  return {
    ...workflow,
    steps: workflow.steps.map((step, index) =>
      index === firstGotoIndex && step.type === 'goto'
        ? { ...step, url: target.url }
        : step
    ),
  };
}
