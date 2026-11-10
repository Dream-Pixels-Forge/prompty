import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
    rules: {
      'no-prototype-builtins': 'warn',
    },
  },
  {
    // background.js and content/assist.js are @ts-nocheck, so tsc can't catch undefined identifiers there.
    // A swallowed import once left every message constant undefined at runtime.
    files: ['src/background.js', 'src/content/assist.js'],
    rules: { 'no-undef': 'error' },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
