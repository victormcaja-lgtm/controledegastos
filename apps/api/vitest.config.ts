import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Testes de integração compartilham um Postgres: rodar em série evita
    // corridas entre criação/remoção de usuários.
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 30_000,
    testTimeout: 30_000,
    setupFiles: ['./tests/setup.ts'],
  },
});
