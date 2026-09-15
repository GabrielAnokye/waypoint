import { describe, expect, it } from 'vitest';

import { createLogger } from './index.js';

describe('createLogger', () => {
  it('creates a logger with the requested level', () => {
    const logger = createLogger({ level: 'debug', name: 'test' });

    expect(logger.level).toBe('debug');
  });
});
