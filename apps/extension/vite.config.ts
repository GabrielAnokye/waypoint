import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const watchMode = process.env.VITE_WATCH === 'true';
const extensionRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: !watchMode,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        sidepanel: `${extensionRoot}sidepanel.html`,
        'scripts/service-worker': `${extensionRoot}src/service-worker.ts`,
        'scripts/content-script': `${extensionRoot}src/content-script.ts`,
        'scripts/content-recorder': `${extensionRoot}src/recorder/entry.ts`
      },
      output: {
        // Keep each script as a single IIFE file (no code-splitting).
        entryFileNames(chunkInfo) {
          if (chunkInfo.name.startsWith('scripts/')) {
            return `${chunkInfo.name}.js`;
          }
          return 'assets/[name]-[hash].js';
        }
      }
    }
  }
});
