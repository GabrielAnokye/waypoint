import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'node_modules/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' }
      ]
    }
  },
  {
    files: ['apps/extension/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        chrome: 'readonly'
      }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true }
      ]
    }
  },
  {
    files: [
      'apps/runner/**/*.{ts,tsx}',
      'packages/**/*.{ts,tsx}',
      'tests/**/*.{ts,tsx}',
      'apps/extension/scripts/**/*.mjs',
      '**/*.config.{js,mjs,ts}',
      '*.config.{js,mjs,ts}'
    ],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  }
);
