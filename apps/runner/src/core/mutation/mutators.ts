import { createHash } from 'node:crypto';
import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

export const MUTATION_TYPES = ['cosmetic', 'attribute', 'structural', 'layout', 'content', 'semantic'] as const;
export type MutationType = typeof MUTATION_TYPES[number];

export interface MutatorOptions {
  seed?: string;
}

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];
type TextNode = DefaultTreeAdapterMap['textNode'];

function isElement(node: Node): node is Element {
  return node !== null && typeof node === 'object' && 'tagName' in node && Array.isArray((node as Element).attrs);
}

function isTextNode(node: Node): node is TextNode {
  return node !== null && typeof node === 'object' && node.nodeName === '#text' && 'value' in node;
}

function hashValue(val: string, seed = 'waypoint'): string {
  return createHash('sha256')
    .update(`${val}:${seed}`)
    .digest('hex')
    .slice(0, 8);
}

function traverse(node: Node, visitor: (el: Element) => void): void {
  if (isElement(node)) {
    visitor(node);
  }
  if ('childNodes' in node && Array.isArray((node as ParentNode).childNodes)) {
    const children = [...(node as ParentNode).childNodes];
    for (const child of children) {
      traverse(child, visitor);
    }
  }
}

/**
 * Cosmetic Mutator:
 * - Hashes/randomizes CSS class names across all elements.
 * - Updates class selectors inside <style> blocks so page styling remains coordinated.
 * - STRICT GUARANTEE: Never alters, adds, or removes `data-truth-id`.
 */
export function mutateCosmetic(html: string, options: MutatorOptions = {}): string {
  const seed = options.seed ?? 'cosmetic';
  const ast = /<html[\s>]/i.test(html) ? parse(html) : parseFragment(html);
  const classMap = new Map<string, string>();

  // 1. Discover all class names
  traverse(ast, (el) => {
    const classAttr = el.attrs.find((a) => a.name === 'class');
    if (classAttr) {
      const classes = classAttr.value.split(/\s+/).filter(Boolean);
      for (const cls of classes) {
        if (!classMap.has(cls)) {
          classMap.set(cls, `cls_${hashValue(cls, seed)}`);
        }
      }
    }
  });

  // 2. Rewrite class attributes on all elements (never touching data-truth-id)
  traverse(ast, (el) => {
    for (const attr of el.attrs) {
      if (attr.name === 'data-truth-id') {
        // IMMUTABLE AUDIT ANCHOR: NEVER TOUCH
        continue;
      }
      if (attr.name === 'class') {
        const classes = attr.value.split(/\s+/).filter(Boolean);
        attr.value = classes.map((cls) => classMap.get(cls) ?? cls).join(' ');
      }
    }
  });

  // 3. Rewrite class selectors in <style> elements
  traverse(ast, (el) => {
    if (el.tagName === 'style' && el.childNodes) {
      for (const child of el.childNodes) {
        if (isTextNode(child)) {
          let css = child.value;
          for (const [orig, mutated] of classMap.entries()) {
            // Match .origClass with word boundary / CSS selector delimiter
            const regex = new RegExp(`\\.${orig}(?=[\\s\\.\\{\\#\\:\\,\\[\\]\\>\\+\\~]|$)`, 'g');
            css = css.replace(regex, `.${mutated}`);
          }
          child.value = css;
        }
      }
    }
  });

  return serialize(ast);
}

/**
 * Attribute Mutator:
 * - Renames non-truth IDs and testIds.
 * - Updates references like <label for="..."> and aria-labelledby.
 * - Updates ID selectors in <style> blocks.
 * - STRICT GUARANTEE: Never alters, adds, or removes `data-truth-id`.
 */
export function mutateAttribute(html: string, options: MutatorOptions = {}): string {
  const seed = options.seed ?? 'attribute';
  const ast = /<html[\s>]/i.test(html) ? parse(html) : parseFragment(html);
  const idMap = new Map<string, string>();

  // 1. Discover all non-truth IDs
  traverse(ast, (el) => {
    const idAttr = el.attrs.find((a) => a.name === 'id');
    if (idAttr && idAttr.value) {
      const origId = idAttr.value;
      if (!idMap.has(origId)) {
        idMap.set(origId, `id_${hashValue(origId, seed)}`);
      }
    }
  });

  // 2. Rewrite attributes on elements (never touching data-truth-id)
  traverse(ast, (el) => {
    for (const attr of el.attrs) {
      if (attr.name === 'data-truth-id') {
        // IMMUTABLE AUDIT ANCHOR: NEVER TOUCH
        continue;
      }
      if (attr.name === 'id' && idMap.has(attr.value)) {
        attr.value = idMap.get(attr.value)!;
      } else if (attr.name === 'for' && idMap.has(attr.value)) {
        attr.value = idMap.get(attr.value)!;
      } else if (attr.name === 'data-testid') {
        attr.value = `tst_${hashValue(attr.value, seed)}`;
      } else if (attr.name === 'aria-labelledby' || attr.name === 'aria-describedby') {
        const tokens = attr.value.split(/\s+/).filter(Boolean);
        attr.value = tokens.map((id) => idMap.get(id) ?? id).join(' ');
      }
    }
  });

  // 3. Rewrite #id selectors in <style> elements
  traverse(ast, (el) => {
    if (el.tagName === 'style' && el.childNodes) {
      for (const child of el.childNodes) {
        if (isTextNode(child)) {
          let css = child.value;
          for (const [orig, mutated] of idMap.entries()) {
            const regex = new RegExp(`\\#${orig}(?=[\\s\\.\\{\\#\\:\\,\\[\\]\\>\\+\\~]|$)`, 'g');
            css = css.replace(regex, `#${mutated}`);
          }
          child.value = css;
        }
      }
    }
  });

  return serialize(ast);
}

/**
 * Structural Mutator:
 * - Injects wrapper <div> tags around interactive elements, fieldsets, and containers.
 * - Alters the DOM hierarchy and depth, testing resilience of structural locators (CSS/XPath).
 * - STRICT GUARANTEE: Never alters, adds, or removes `data-truth-id`.
 */
export function mutateStructural(html: string, options: MutatorOptions = {}): string {
  const seed = options.seed ?? 'structural';
  const ast = /<html[\s>]/i.test(html) ? parse(html) : parseFragment(html);

  const WRAPPABLE_TAGS = new Set([
    'button',
    'input',
    'select',
    'textarea',
    'fieldset',
    'form',
    'textarea'
  ]);

  // Traverse and collect elements to wrap
  const elementsToWrap: Element[] = [];
  traverse(ast, (el) => {
    if (WRAPPABLE_TAGS.has(el.tagName.toLowerCase())) {
      elementsToWrap.push(el);
    }
  });

  for (const el of elementsToWrap) {
    const parent = el.parentNode as ParentNode | null;
    if (!parent || !Array.isArray(parent.childNodes)) continue;

    // Do not wrap if parent is already our generated wrapper
    if (
      isElement(parent as Node) &&
      (parent as Element).attrs.some((a) => a.name === 'data-mutation' && a.value === 'structural-wrapper')
    ) {
      continue;
    }

    const index = parent.childNodes.indexOf(el);
    if (index === -1) continue;

    const wrapperId = `wrap_${hashValue(el.tagName + index, seed)}`;
    const wrapper: Element = {
      nodeName: 'div',
      tagName: 'div',
      attrs: [
        { name: 'class', value: `wrapper-${wrapperId}` },
        { name: 'data-mutation', value: 'structural-wrapper' }
      ],
      childNodes: [el],
      parentNode: parent,
      namespaceURI: el.namespaceURI
    };

    el.parentNode = wrapper;
    parent.childNodes[index] = wrapper;
  }

  return serialize(ast);
}

/** CSS-only translation: preserves tag hierarchy, names, and accessibility. */
export function mutateLayout(html: string, options: MutatorOptions = {}): string {
  const offset = 80 + (parseInt(hashValue('layout', options.seed), 16) % 171);
  return html.replace(/<head[^>]*>/i, match => `${match}<style data-mutation="layout">body { position: relative; top: ${offset}px !important; } </style>`);
}

const COPY: Record<string, string> = {
  'sign in': 'Log in to Account', 'submit': 'Continue', 'delete': 'Remove Item',
  'search': 'Filter records', 'save': 'Apply Changes', 'next': 'Proceed',
  'confirm': 'Accept', 'cancel': 'Dismiss', 'email': 'Email address',
  'name': 'Full name', 'load': 'Fetch', 'open': 'Show', 'edit': 'Update'
};
function changeCopy(value: string): string {
  return value.replace(/sign in|submit|delete|search|save|next|confirm|cancel|email|name|load|open|edit/gi,
    token => COPY[token.toLowerCase()] ?? token);
}

export function mutateContent(html: string): string {
  const ast = /<html[\s>]/i.test(html) ? parse(html) : parseFragment(html);
  traverse(ast, el => {
    for (const attr of el.attrs) {
      if (['placeholder', 'aria-label', 'title'].includes(attr.name) ||
          (attr.name === 'value' && el.tagName === 'input' && el.attrs.some(a => a.name === 'type' && ['button', 'submit'].includes(a.value)))) {
        attr.value = changeCopy(attr.value);
      }
    }
    if (!['script', 'style'].includes(el.tagName)) {
      for (const node of el.childNodes) if (isTextNode(node)) node.value = changeCopy(node.value);
    }
  });
  return serialize(ast);
}

export function mutateSemantic(html: string): string {
  const ast = /<html[\s>]/i.test(html) ? parse(html) : parseFragment(html);
  traverse(ast, el => {
    el.attrs = el.attrs.filter(a => !['aria-label', 'aria-labelledby', 'role'].includes(a.name));
    if (el.tagName === 'label') {
      el.tagName = el.nodeName = 'span';
      el.attrs = el.attrs.filter(a => a.name !== 'for');
    }
    if (el.tagName === 'button') {
      el.tagName = el.nodeName = 'div';
      el.attrs.push({ name: 'tabindex', value: '0' });
      const cls = el.attrs.find(a => a.name === 'class');
      if (cls) cls.value += ' btn-lookalike';
      else el.attrs.push({ name: 'class', value: 'btn-lookalike' });
      // Match native button defaults and preserve inline click handlers. Submit
      // controls still submit their form; no semantic role is added back.
      el.attrs.push({ name: 'style', value: 'display:inline-block;box-sizing:border-box;font:400 13.3333px Arial;padding:8px 16px;border:2px outset ButtonBorder;background:ButtonFace;color:ButtonText;cursor:pointer;' + (el.attrs.find(a => a.name === 'style')?.value ?? '') });
      const styles = el.attrs.filter(a => a.name === 'style');
      el.attrs = el.attrs.filter(a => a.name !== 'style');
      el.attrs.push(styles[styles.length - 1]!);
      const click = el.attrs.find(a => a.name === 'onclick');
      if (!click && el.attrs.some(a => a.name === 'type' && a.value === 'submit'))
        el.attrs.push({ name: 'onclick', value: "this.closest('form')?.requestSubmit()" });
    }
  });
  return serialize(ast).replace(/button(?=\s*[{:.,>])/g, '.btn-lookalike');
}

/** Remove redundant test contracts and explicit labels without adding new ones. */
export function applyUnlabeledVariant(html: string): string {
  const ast = /<html[\s>]/i.test(html) ? parse(html) : parseFragment(html);
  traverse(ast, el => { el.attrs = el.attrs.filter(a => !['data-testid', 'aria-label', 'aria-labelledby'].includes(a.name)); });
  return serialize(ast);
}

// Transform srcdoc documents and fixture-owned HTML template literals as well
// as light DOM. Script code itself is never treated as visible copy.
function embedded(html: string, transform: (source: string) => string): string {
  const ast = /<html[\s>]/i.test(html) ? parse(html) : parseFragment(html);
  traverse(ast, el => {
    const srcdoc = el.attrs.find(a => a.name === 'srcdoc');
    if (srcdoc) srcdoc.value = embedded(srcdoc.value, transform);
    if (el.tagName === 'script') for (const child of el.childNodes) if (isTextNode(child)) {
      child.value = child.value.replace(/`([^`]*<[a-z][^`]*)`/gi,
        (_match, markup: string) => '`' + transform(markup) + '`');
    }
  });
  return transform(serialize(ast));
}

export function applyFixtureVariant(html: string, variant?: string): string {
  return variant === 'unlabeled' ? embedded(html, applyUnlabeledVariant) : html;
}

/** Applies mutations to static DOM, same-origin srcdoc, and generated markup. */
export function applyMutations(html: string, mutations: MutationType[], options: MutatorOptions = {}): string {
  const mutators: Record<MutationType, (source: string, options: MutatorOptions) => string> = {
    cosmetic: mutateCosmetic, attribute: mutateAttribute, structural: mutateStructural,
    layout: mutateLayout, content: mutateContent, semantic: mutateSemantic
  };
  let result = html;
  for (const mutation of mutations) result = embedded(result, source => mutators[mutation](source, options));
  return result;
}
