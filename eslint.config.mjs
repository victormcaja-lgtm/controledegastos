import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Configuração única para o monorepo (flat config).
 *
 * A filosofia aqui é: o TypeScript já pega erro de tipo, então o ESLint cuida do
 * que ele não vê — Promise ignorada, `any` esgueirando, hook mal usado.
 * Regras de formatação ficam com o Prettier (por isso `eslint-config-prettier`
 * por último, desligando tudo que conflita).
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/api/src/generated/**',
      'apps/api/prisma/migrations/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'object-shorthand': 'warn',
    },
  },

  // Front: regras dos hooks do React.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Scripts e testes podem escrever no console à vontade.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'apps/api/prisma/seed.ts', '**/tests/**'],
    rules: { 'no-console': 'off' },
  },

  prettier,
);
