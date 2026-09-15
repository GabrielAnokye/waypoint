import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppShell } from './index.js';

describe('AppShell', () => {
  it('renders the provided title and subtitle', () => {
    const markup = renderToStaticMarkup(
      <AppShell title="Morning setup" subtitle="Extension scaffold">
        <p>Ready</p>
      </AppShell>
    );

    expect(markup).toContain('Morning setup');
    expect(markup).toContain('Extension scaffold');
  });
});
