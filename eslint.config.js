import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['vite.config.ts', 'vite/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
]);
