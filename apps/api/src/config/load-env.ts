import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Carrega `.env` (ou `.env.test` quando `NODE_ENV=test`, ex.: Vitest já o
 * define antes dos setupFiles) antes de qualquer import que leia
 * `process.env` — por isso precisa ser o primeiro import do módulo que o
 * utiliza (import statements são avaliados na ordem em que aparecem).
 */
const candidates = process.env.NODE_ENV === 'test' ? ['.env.test', '.env'] : ['.env', '.env.test'];
for (const file of candidates) {
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}
