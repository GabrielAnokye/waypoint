import { createHash } from 'node:crypto';
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';

export type MutationType = 'cosmetic' | 'attribute' | 'structural';

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
  const ast = parse(html);
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
  const ast = parse(html);
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
  const ast = parse(html);

  const WRAPPABLE_TAGS = new Set([
    'button',
    'input',
    'select',
    'textarea',
    'fieldset',
    'form',
    'table',
    'tr',
    'td',
    'th'
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

/**
 * Applies a sequence of requested DOM mutations to the fixture HTML.
 */
export function applyMutations(
  html: string,
  mutations: MutationType[],
  options: MutatorOptions = {}
): string {
  let result = html;
  for (const mut of mutations) {
    switch (mut) {
      case 'cosmetic':
        result = mutateCosmetic(result, options);
        break;
      case 'attribute':
        result = mutateAttribute(result, options);
        break;
      case 'structural':
        result = mutateStructural(result, options);
        break;
    }
  }
  return result;
}
