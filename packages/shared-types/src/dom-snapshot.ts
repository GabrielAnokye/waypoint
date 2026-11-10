import { computeAccessibleName, getRole } from 'dom-accessibility-api';
import type { ElementSnapshot } from './index.js';

/** Scoring inputs have an explicit allowlist. No arbitrary attribute scans. */
export function captureFeatures(el: Element): Omit<ElementSnapshot, 'expectedTruthId'> {
  const rect = el.getBoundingClientRect();
  const attributes: Record<string, string> = {};
  for (const key of ['type', 'name', 'href']) {
    const value = el.getAttribute(key);
    if (value)
      attributes[key] =
        key === 'href'
          ? new URL(
              value,
              /^(?:https?|file):/.test(el.ownerDocument.baseURI)
                ? el.ownerDocument.baseURI
                : 'http://fixture.invalid/'
            ).pathname
          : value;
  }
  const classes = [...el.classList].filter(
    (token) =>
      !/^(cls_|css-|sc-|jsx-|[a-f0-9]{6,}$)/i.test(token) &&
      !/^(?:p[trblxy]?|m[trblxy]?|w|h|text|bg|flex|grid|gap|items|justify)-/.test(token)
  );
  if (classes.length) attributes.class = classes.sort().join(' ');
  const ancestorTags: string[] = [];
  let parent: Element | null = el.parentElement;
  while (parent && ancestorTags.length < 4) {
    ancestorTags.push(parent.tagName.toLowerCase());
    parent = parent.parentElement;
  }
  const innerText =
    (el as HTMLElement).innerText?.trim() ?? el.textContent?.trim() ?? '';
  return {
    tagName: el.tagName.toLowerCase(),
    attributes,
    role: getRole(el) ?? undefined,
    accessibleName: computeAccessibleName(el),
    innerText,
    buttonValue:
      el.tagName === 'INPUT' &&
      ['button', 'submit', 'reset'].includes((el as HTMLInputElement).type)
        ? (el as HTMLInputElement).value
        : '',
    placeholder: el.getAttribute('placeholder') ?? undefined,
    ancestorTags,
    siblingIndex: el.parentElement ? [...el.parentElement.children].indexOf(el) : 0,
    boundingBox: {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      width: rect.width,
      height: rect.height,
    },
  };
}

/** Capture-only grading label. Never called by candidate enumeration. */
export function captureSnapshot(el: Element): ElementSnapshot {
  const expectedTruthId = el.getAttribute('data-truth-id');
  return { ...captureFeatures(el), ...(expectedTruthId ? { expectedTruthId } : {}) };
}
