import { defineConfig } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import oxlint from 'eslint-plugin-oxlint';

/**
 * @type {import('eslint').Linter.Config}
 */
export default defineConfig([
  {
    files: ['**/*.{js,mjs,cjs,ts,mts}'],
    ignores: ['node_modules/', 'dist/', 'coverage/', '*.config.js', '*.config.mjs', '.lintstagedrc.js'],
  },
  
  eslint.configs.recommended,
  
  ...tseslint.configs.recommended,
  
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {},
  },

  {
    files: ['**/*.test.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-empty": 'off', // Allow empty test cases
      "@typescript-eslint/no-explicit-any": 'off', // Allow any in tests
    },
  },

  ...oxlint.buildFromOxlintConfigFile('./.oxlintrc.json'),
]);