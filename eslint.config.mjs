import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The service worker runs in its own global scope (self, caches, fetch),
    // not the browser window's — without this every line of it reads as an
    // undefined variable.
    files: ['client/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // Node scripts and config files.
    files: ['client/vite.config.ts', 'server/scripts/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
