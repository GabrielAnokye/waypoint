import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^node:sqlite$/,
        replacement: 'node:sqlite'
      },
      {
        find: /^@waypoint\/db\/runtime-paths$/,
        replacement: fileURLToPath(
          new URL('./packages/db/src/runtime-paths.ts', import.meta.url)
        )
      },
      {
        find: /^@waypoint\/shared-types$/,
        replacement: fileURLToPath(
          new URL('./packages/shared-types/src/index.ts', import.meta.url)
        )
      },
      {
        find: /^@waypoint\/compiler$/,
        replacement: fileURLToPath(
          new URL('./packages/compiler/src/index.ts', import.meta.url)
        )
      },
      {
        find: /^@waypoint\/db$/,
        replacement: fileURLToPath(
          new URL('./packages/db/src/index.ts', import.meta.url)
        )
      },
      {
        find: /^@waypoint\/bridge-protocol$/,
        replacement: fileURLToPath(
          new URL('./packages/bridge-protocol/src/index.ts', import.meta.url)
        )
      },
      {
        find: /^@waypoint\/logger$/,
        replacement: fileURLToPath(
          new URL('./packages/logger/src/index.ts', import.meta.url)
        )
      },
      {
        find: /^@waypoint\/ui$/,
        replacement: fileURLToPath(
          new URL('./packages/ui/src/index.tsx', import.meta.url)
        )
      }
    ]
  },
  test: {
    include: ['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html']
    }
  }
});
