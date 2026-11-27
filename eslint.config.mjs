// Single flat config for the whole workspace. Each package runs `eslint .` from its own folder,
// and ESLint finds this file by walking up.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
      'reference/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/cli.ts', '**/*.test.ts', '**/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/business/**/*.tsx', 'apps/admin/**/*.tsx', 'apps/customer/**/*.tsx'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
