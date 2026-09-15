/** Heuristics to determine if an element captures sensitive data. */

const SENSITIVE_TYPES = new Set([
  'password',
  'hidden'
]);

const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'one-time-code'
]);

const SENSITIVE_NAME_PATTERN = /pass|secret|token|cvv|ssn|otp|pin/i;

export interface RedactDecision {
  redacted: boolean;
  reason?: string;
}

/**
 * Pure function — no DOM access. Pass in the relevant attributes extracted
 * from the element earlier.
 */
export function shouldRedact(attrs: {
  type?: string;
  autocomplete?: string;
  name?: string;
  id?: string;
}): RedactDecision {
  if (attrs.type && SENSITIVE_TYPES.has(attrs.type)) {
    return { redacted: true, reason: `input type="${attrs.type}"` };
  }
  if (attrs.autocomplete) {
    const tokens = attrs.autocomplete.split(/\s+/);
    for (const token of tokens) {
      if (SENSITIVE_AUTOCOMPLETE.has(token)) {
        return { redacted: true, reason: `autocomplete="${token}"` };
      }
    }
  }
  if (attrs.name && SENSITIVE_NAME_PATTERN.test(attrs.name)) {
    return { redacted: true, reason: `name="${attrs.name}" matches sensitive pattern` };
  }
  if (attrs.id && SENSITIVE_NAME_PATTERN.test(attrs.id)) {
    return { redacted: true, reason: `id="${attrs.id}" matches sensitive pattern` };
  }
  return { redacted: false };
}
