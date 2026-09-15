import { describe, expect, it } from 'vitest';

import { shouldRedact } from './redact.js';

describe('shouldRedact', () => {
  it('redacts password input type', () => {
    const r = shouldRedact({ type: 'password' });
    expect(r.redacted).toBe(true);
    expect(r.reason).toContain('password');
  });

  it('redacts autocomplete=current-password', () => {
    const r = shouldRedact({ type: 'text', autocomplete: 'current-password' });
    expect(r.redacted).toBe(true);
  });

  it('redacts cc-number autocomplete', () => {
    const r = shouldRedact({ autocomplete: 'cc-number' });
    expect(r.redacted).toBe(true);
  });

  it('redacts name matching sensitive pattern', () => {
    expect(shouldRedact({ name: 'user_password' }).redacted).toBe(true);
    expect(shouldRedact({ name: 'api_token' }).redacted).toBe(true);
    expect(shouldRedact({ id: 'ssn_field' }).redacted).toBe(true);
  });

  it('does not redact normal text input', () => {
    const r = shouldRedact({ type: 'text', name: 'username', id: 'email' });
    expect(r.redacted).toBe(false);
  });
});
