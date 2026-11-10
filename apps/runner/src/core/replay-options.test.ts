import { describe, expect, it } from 'vitest';
import { SampleWorkflow, type AttachedTarget } from '@waypoint/shared-types';
import { prepareReplayWorkflow } from './replay-options.js';

const target: AttachedTarget = {
  tabId: 1,
  windowId: 1,
  url: 'http://localhost:8080/ambiguous.html?mutation=structural',
  token: '00000000-0000-4000-8000-000000000001',
};
describe('selected-page replay', () => {
  it('replaces only the first enabled Go to and preserves the saved recording and snapshots', () => {
    const workflow = structuredClone(SampleWorkflow);
    workflow.steps = workflow.steps.map((step) =>
      step.type === 'goto' ? { ...step, url: 'file:///fixture/ambiguous.html' } : step
    );
    const before = JSON.stringify(workflow);
    const original = workflow.steps.find((s) => s.type === 'goto')!;
    workflow.steps.unshift({ ...original, id: 'disabled', enabled: false });
    workflow.steps.push({ ...original, id: 'later-navigation' });
    const saved = JSON.stringify(workflow);
    const run = prepareReplayWorkflow(workflow, {
      useSelectedPage: true,
      attachedTarget: target,
    });
    expect(run).not.toBe(workflow);
    expect(JSON.stringify(workflow)).toBe(saved);
    expect(run.steps[0]).toBe(workflow.steps[0]);
    const first = run.steps.find((s) => s.enabled && s.type === 'goto');
    expect(first).toMatchObject({ type: 'goto', url: target.url });
    expect(run.steps.at(-1)).toBe(workflow.steps.at(-1));
    for (const step of workflow.steps.filter((s) => 'primaryLocator' in s))
      expect(run.steps.find((s) => s.id === step.id)).toBe(step);
    expect(before).not.toBe(saved);
  });
  it('keeps ordinary replay unchanged until explicitly enabled', () => {
    expect(prepareReplayWorkflow(SampleWorkflow, {})).toBe(SampleWorkflow);
  });
  it('rejects an unrelated active website instead of replaying fixture actions there', () => {
    const workflow = structuredClone(SampleWorkflow);
    workflow.steps = workflow.steps.map((step) =>
      step.type === 'goto' ? { ...step, url: 'file:///fixture/ambiguous.html' } : step
    );
    expect(() =>
      prepareReplayWorkflow(workflow, {
        useSelectedPage: true,
        attachedTarget: { ...target, url: 'https://gemini.google.com/app/example' },
      })
    ).toThrow('Select the matching webpage');
  });
  it('refuses missing or unsafe selected page identity', () => {
    expect(() =>
      prepareReplayWorkflow(SampleWorkflow, { useSelectedPage: true })
    ).toThrow();
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'chrome://extensions',
      'https://user:password@example.com',
    ])
      expect(() =>
        prepareReplayWorkflow(SampleWorkflow, {
          useSelectedPage: true,
          attachedTarget: { ...target, url },
        })
      ).toThrow();
  });
});
