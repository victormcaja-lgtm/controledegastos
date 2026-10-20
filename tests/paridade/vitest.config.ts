import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['specs/**/*.test.ts'],
    // Todos os arquivos dividem o mesmo banco e a mesma API: em série.
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
