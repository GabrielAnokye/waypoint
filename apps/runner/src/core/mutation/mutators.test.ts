import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, type DefaultTreeAdapterMap } from 'parse5';

import {
  applyMutations,
  mutateAttribute,
  mutateCosmetic,
  mutateStructural
} from './mutators.js';
import { createMutationServer, resolveFixturesDir } from './server.js';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];

function isElement(node: Node): node is Element {
  return node !== null && typeof node === 'object' && 'tagName' in node && Array.isArray((node as Element).attrs);
}

interface TruthAnchor {
  truthId: string;
  tagName: string;
}

function extractTruthAnchors(html: string): TruthAnchor[] {
  const ast = parse(html);
  const anchors: TruthAnchor[] = [];

  function walk(node: Node) {
    if (isElement(node)) {
      const truthAttr = node.attrs.find((a) => a.name === 'data-truth-id');
      if (truthAttr && truthAttr.value) {
        anchors.push({
          truthId: truthAttr.value,
          tagName: node.tagName.toLowerCase()
        });
      }
    }
    if ('childNodes' in node && Array.isArray((node as ParentNode).childNodes)) {
      for (const child of (node as ParentNode).childNodes) {
        walk(child);
      }
    }
  }

  walk(ast);
  return anchors;
}

describe('Mutation Engine Mutators', () => {
  const sampleHtml = `<!DOCTYPE html>
<html>
<head>
  <style>
    .btn { background: red; }
    .primary { color: white; }
    #submit-btn { font-size: 16px; }
  </style>
</head>
<body>
  <div class="container main" id="main-container">
    <label for="username">Username</label>
    <input id="username" class="input-field" data-testid="user-input" data-truth-id="user-input" />
    <button id="submit-btn" class="btn primary" data-testid="btn-submit" data-truth-id="btn-submit">Submit</button>
  </div>
</body>
</html>`;

  describe('mutateCosmetic', () => {
    it('hashes class names in attributes and style sheets without touching data-truth-id', () => {
      const mutated = mutateCosmetic(sampleHtml, { seed: 'test-seed' });

      // Original class names should be rewritten
      expect(mutated).not.toContain('class="container main"');
      expect(mutated).toContain('cls_');
      // Style tag updated
      expect(mutated).not.toContain('.btn {');
      expect(mutated).toMatch(/\.cls_[a-f0-9]+\s*\{/);

      // data-truth-id must be strictly preserved
      const origAnchors = extractTruthAnchors(sampleHtml);
      const mutatedAnchors = extractTruthAnchors(mutated);
      expect(mutatedAnchors).toEqual(origAnchors);
    });

    it('produces deterministic output with same seed and different with different seeds', () => {
      const res1 = mutateCosmetic(sampleHtml, { seed: 'seed-a' });
      const res2 = mutateCosmetic(sampleHtml, { seed: 'seed-a' });
      const res3 = mutateCosmetic(sampleHtml, { seed: 'seed-b' });

      expect(res1).toBe(res2);
      expect(res1).not.toBe(res3);
    });
  });

  describe('mutateAttribute', () => {
    it('renames non-truth IDs and testIds and updates label for references', () => {
      const mutated = mutateAttribute(sampleHtml, { seed: 'attr-seed' });

      // ID rewritten
      expect(mutated).not.toContain('id="username"');
      expect(mutated).toMatch(/id="id_[a-f0-9]+"/);

      // Label for rewritten to match new input ID
      const inputIdMatch = mutated.match(/<input[^>]*id="(id_[a-f0-9]+)"/);
      expect(inputIdMatch).not.toBeNull();
      const newId = inputIdMatch![1];
      expect(mutated).toContain(`for="${newId}"`);

      // TestIds rewritten
      expect(mutated).not.toContain('data-testid="user-input"');
      expect(mutated).toMatch(/data-testid="tst_[a-f0-9]+"/);

      // Style tag #id updated
      expect(mutated).not.toContain('#submit-btn {');

      // data-truth-id must be strictly preserved
      const origAnchors = extractTruthAnchors(sampleHtml);
      const mutatedAnchors = extractTruthAnchors(mutated);
      expect(mutatedAnchors).toEqual(origAnchors);
    });
  });

  describe('mutateStructural', () => {
    it('wraps wrappable elements in wrapper divs without altering data-truth-id', () => {
      const mutated = mutateStructural(sampleHtml, { seed: 'struct-seed' });

      // Contains injected wrappers
      expect(mutated).toContain('data-mutation="structural-wrapper"');
      expect(mutated).toContain('class="wrapper-wrap_');

      // Wrappers must NOT carry data-truth-id
      const ast = parse(mutated);
      function checkWrappers(node: Node) {
        if (isElement(node)) {
          if (node.attrs.some((a) => a.name === 'data-mutation' && a.value === 'structural-wrapper')) {
            expect(node.attrs.some((a) => a.name === 'data-truth-id')).toBe(false);
          }
        }
        if ('childNodes' in node && Array.isArray((node as ParentNode).childNodes)) {
          for (const child of (node as ParentNode).childNodes) {
            checkWrappers(child);
          }
        }
      }
      checkWrappers(ast);

      // Target elements retain their exact data-truth-id and tag names
      const origAnchors = extractTruthAnchors(sampleHtml);
      const mutatedAnchors = extractTruthAnchors(mutated);
      expect(mutatedAnchors).toEqual(origAnchors);
    });
  });

  describe('applyMutations', () => {
    it('chains multiple mutations cleanly', () => {
      const mutated = applyMutations(
        sampleHtml,
        ['cosmetic', 'attribute', 'structural'],
        { seed: 'combined-seed' }
      );

      expect(mutated).toContain('cls_');
      expect(mutated).toContain('tst_');
      expect(mutated).toContain('data-mutation="structural-wrapper"');

      const origAnchors = extractTruthAnchors(sampleHtml);
      const mutatedAnchors = extractTruthAnchors(mutated);
      expect(mutatedAnchors).toEqual(origAnchors);
    });
  });

  describe('Strict Audit Across All 8 Demo Fixture Pages', () => {
    const fixturesDir = resolveFixturesDir();
    const fixtureFiles = fs
      .readdirSync(fixturesDir)
      .filter((file) => file.endsWith('.html'))
      .sort();

    it('finds all 8 expected fixture files in demo-pages', () => {
      expect(fixtureFiles).toHaveLength(8);
      expect(fixtureFiles).toEqual([
        'ambiguous.html',
        'delayed.html',
        'dropdowns.html',
        'forms.html',
        'iframe.html',
        'shadow-dom.html',
        'spa.html',
        'tables.html'
      ]);
    });

    for (const file of fixtureFiles) {
      it(`preserves 100% of data-truth-id anchors under all mutations for ${file}`, () => {
        const filePath = path.join(fixturesDir, file);
        const originalHtml = fs.readFileSync(filePath, 'utf-8');
        const baselineAnchors = extractTruthAnchors(originalHtml);

        expect(baselineAnchors.length).toBeGreaterThan(0);

        // 1. Cosmetic mutation
        const cosmeticHtml = mutateCosmetic(originalHtml, { seed: 'bench' });
        const cosmeticAnchors = extractTruthAnchors(cosmeticHtml);
        expect(cosmeticAnchors).toEqual(baselineAnchors);

        // 2. Attribute mutation
        const attrHtml = mutateAttribute(originalHtml, { seed: 'bench' });
        const attrAnchors = extractTruthAnchors(attrHtml);
        expect(attrAnchors).toEqual(baselineAnchors);

        // 3. Structural mutation
        const structHtml = mutateStructural(originalHtml, { seed: 'bench' });
        const structAnchors = extractTruthAnchors(structHtml);
        expect(structAnchors).toEqual(baselineAnchors);

        // 4. Combined mutations
        const combinedHtml = applyMutations(
          originalHtml,
          ['cosmetic', 'attribute', 'structural'],
          { seed: 'bench' }
        );
        const combinedAnchors = extractTruthAnchors(combinedHtml);
        expect(combinedAnchors).toEqual(baselineAnchors);
      });
    }
  });

  describe('Mutation HTTP Server', () => {
    let server: ReturnType<typeof createMutationServer>;
    let baseUrl: string;

    it('starts on an ephemeral port and serves the demo pages index', async () => {
      server = createMutationServer({ port: 0 });
      baseUrl = await server.start();
      expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const text = await res.text();
      expect(text).toContain('Waypoint Mutation Fixture Server');
      expect(text).toContain('forms.html');
      expect(text).toContain('tables.html');
    });

    it('serves unmutated fixture when no mutation param is provided', async () => {
      const res = await fetch(`${baseUrl}/forms.html`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('data-truth-id="login-email"');
      expect(text).toContain('id="login-email"');
      expect(res.headers.get('x-mutations-applied')).toBe('');
    });

    it('serves fixture with cosmetic mutation applied', async () => {
      const res = await fetch(`${baseUrl}/forms.html?mutation=cosmetic`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-mutations-applied')).toBe('cosmetic');
      const text = await res.text();
      expect(text).toContain('cls_');
      // Truth anchors intact
      const anchors = extractTruthAnchors(text);
      expect(anchors.length).toBeGreaterThan(0);
      expect(anchors.some((a) => a.truthId === 'login-email')).toBe(true);
    });

    it('serves fixture with attribute mutation applied', async () => {
      const res = await fetch(`${baseUrl}/forms.html?mutation=attribute`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-mutations-applied')).toBe('attribute');
      const text = await res.text();
      expect(text).not.toMatch(/\sid="login-email"/);
      expect(text).toMatch(/\sid="id_[a-f0-9]+"/);
      expect(text).toContain('data-truth-id="login-email"');
    });

    it('serves fixture with structural mutation applied', async () => {
      const res = await fetch(`${baseUrl}/forms.html?mutation=structural`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-mutations-applied')).toBe('structural');
      const text = await res.text();
      expect(text).toContain('data-mutation="structural-wrapper"');
      expect(text).toContain('data-truth-id="login-email"');
    });

    it('serves fixture with combined mutations applied', async () => {
      const res = await fetch(`${baseUrl}/forms.html?mutation=cosmetic,attribute,structural`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-mutations-applied')).toBe('cosmetic,attribute,structural');
      const text = await res.text();
      expect(text).toContain('cls_');
      expect(text).toContain('id="id_');
      expect(text).toContain('data-mutation="structural-wrapper"');
      expect(text).toContain('data-truth-id="login-email"');
    });

    it('returns 404 for unknown fixtures', async () => {
      const res = await fetch(`${baseUrl}/non-existent-page.html`);
      expect(res.status).toBe(404);
    });

    it('returns 403 for directory traversal attempts', async () => {
      const res = await fetch(`${baseUrl}/../../../../etc/passwd`);
      // Normalized or rejected
      expect([403, 404]).toContain(res.status);
    });

    it('stops cleanly', async () => {
      await server.stop();
      await expect(fetch(`${baseUrl}/`)).rejects.toThrow();
    });
  });
});
