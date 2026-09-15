/**
 * Pure helpers for CSS/XPath selector generation.
 * These operate on a simplified element descriptor so they can be tested
 * without a real DOM.
 */

export interface ElementDescriptor {
  tagName: string;
  id?: string;
  testId?: string;
  classList?: string[];
  nthOfType?: number;
  parentDescriptors?: ElementDescriptor[];
}

/**
 * Generate a stable CSS selector for an element.
 * Preference order: #id → [data-testid] → nth-of-type chain (capped at 4 levels).
 */
export function buildCssCandidate(desc: ElementDescriptor): string {
  if (desc.id) {
    return `#${CSS.escape(desc.id)}`;
  }
  if (desc.testId) {
    return `[data-testid="${CSS.escape(desc.testId)}"]`;
  }

  const chain: string[] = [];
  const descriptors = [...(desc.parentDescriptors ?? []), desc];
  const tail = descriptors.slice(-4);

  for (const d of tail) {
    const tag = d.tagName.toLowerCase();
    if (d.id) {
      chain.push(`#${CSS.escape(d.id)}`);
    } else if (d.nthOfType !== undefined) {
      chain.push(`${tag}:nth-of-type(${d.nthOfType})`);
    } else {
      chain.push(tag);
    }
  }
  return chain.join(' > ');
}

/**
 * Generate a simple XPath fallback.
 * Builds a descendant path from the chain: //tag[nth] / tag[nth] ...
 */
export function buildXpathFallback(desc: ElementDescriptor): string {
  const chain: string[] = [];
  const descriptors = [...(desc.parentDescriptors ?? []), desc];
  const tail = descriptors.slice(-4);

  for (let i = 0; i < tail.length; i++) {
    const d = tail[i]!;
    const tag = d.tagName.toLowerCase();
    const prefix = i === 0 ? '//' : '';
    if (d.nthOfType !== undefined) {
      chain.push(`${prefix}${tag}[${d.nthOfType}]`);
    } else {
      chain.push(`${prefix}${tag}`);
    }
  }
  return chain.join('/');
}

/** Polyfill for CSS.escape in environments that don't have it (e.g. tests). */
if (typeof globalThis.CSS === 'undefined') {
  (globalThis as Record<string, unknown>).CSS = {
    escape: (s: string) =>
      s.replace(/([^\w-])/g, (_, c: string) => `\\${c}`)
  };
}
