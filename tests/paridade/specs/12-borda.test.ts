import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertUser, pool, sql } from '../src/db.js';
import { call } from '../src/http.js';
import { DEFAULT_PASSWORD, freshWorld, newUser, uniqueEmail, type Actor } from '../src/world.js';

/**
 * Borda HTTP e compatibilidade de dados — RN-016, RN-017, R-01.
 * A API sob teste roda em modo produção com CORS_ORIGINS=http://localhost:5173.
 */
let admin: Actor;

beforeAll(async () => {
  ({ admin } = await freshWorld());
});

afterAll(() => pool.end());

describe('CORS (RN-016)', () => {
  it('origem da allowlist: preflight com credenciais, métodos e cache de 1 dia', async () => {
    const response = await call('OPTIONS', '/api/auth/login', {
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, PATCH, PUT, DELETE, OPTIONS');
    expect(response.headers.get('access-control-max-age')).toBe('86400');
  });

  it('sem Origin (app móvel, curl, health check) passa', async () => {
    expect((await call('GET', '/health')).status).toBe(200);
  });

  it('RN-161 ⚠️: origem fora da allowlist → 500 genérico (não 403); preview da Vercel também, em produção', async () => {
    for (const origin of ['https://malicioso.example', 'https://grana-abc123-time.vercel.app']) {
      const response = await call('GET', '/health', { headers: { origin } });
      expect(response.status, origin).toBe(500);
      expect(response.body).toEqual({
        statusCode: 500,
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'Algo deu errado do nosso lado. Tente novamente em instantes.',
        requestId: expect.any(String),
      });
    }
  });
});

describe('cabeçalhos de segurança em produção (RN-017)', () => {
  it('CSP restritiva, HSTS, nosniff e frame SAMEORIGIN', async () => {
    const response = await call('GET', '/health');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('documentação (/docs) não existe em produção', async () => {
    expect((await call('GET', '/docs')).status).toBe(404);
  });
});

describe('compatibilidade do hash de senha (R-01)', () => {
  it('a API grava Argon2id em formato PHC com m=19456, t=2, p=1', async () => {
    const user = await newUser(admin);
    const [row] = await sql<{ passwordHash: string }>('SELECT "passwordHash" FROM "users" WHERE id=$1', [user.id]);
    expect(row!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  });

  it('um hash gerado fora da API (biblioteca @node-rs/argon2) é aceito no login', async () => {
    // insertUser grava o hash com a biblioteca usada pela API Node hoje — o
    // .NET precisa verificar os hashes que já estão no banco.
    const user = await insertUser({ email: uniqueEmail('hash') });
    const response = await call('POST', '/api/auth/login', { body: { email: user.email, password: DEFAULT_PASSWORD } });
    expect(response.status).toBe(200);
  });
});
