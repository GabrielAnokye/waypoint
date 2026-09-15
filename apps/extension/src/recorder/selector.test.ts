import { describe, expect, it } from 'vitest';

import { buildCssCandidate, buildXpathFallback, type ElementDescriptor } from './selector.js';

describe('buildCssCandidate', () => {
  it('prefers #id when available', () => {
    const desc: ElementDescriptor = { tagName: 'BUTTON', id: 'submit-btn' };
    expect(buildCssCandidate(desc)).toBe('#submit-btn');
  });

  it('uses [data-testid] when no id', () => {
    const desc: ElementDescriptor = { tagName: 'INPUT', testId: 'email-field' };
    expect(buildCssCandidate(desc)).toBe('[data-testid="email-field"]');
  });

  it('falls back to nth-of-type chain', () => {
    const parent: ElementDescriptor = { tagName: 'DIV', nthOfType: 2 };
    const child: ElementDescriptor = {
      tagName: 'BUTTON',
      nthOfType: 3,
      parentDescriptors: [parent]
    };
    const css = buildCssCandidate(child);
    expect(css).toBe('div:nth-of-type(2) > button:nth-of-type(3)');
  });
});

describe('buildXpathFallback', () => {
  it('builds simple xpath', () => {
    const desc: ElementDescriptor = { tagName: 'BUTTON', nthOfType: 1 };
    expect(buildXpathFallback(desc)).toBe('//button[1]');
  });

  it('builds multi-level xpath', () => {
    const parent: ElementDescriptor = { tagName: 'FORM', nthOfType: 1 };
    const child: ElementDescriptor = {
      tagName: 'INPUT',
      nthOfType: 2,
      parentDescriptors: [parent]
    };
    expect(buildXpathFallback(child)).toBe('//form[1]/input[2]');
  });
});
