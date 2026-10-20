import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { call } from '../src/http.js';
import { freshWorld, newUser, uniqueEmail, type Actor } from '../src/world.js';

/**
 * Rate limits padrão — RN-015 e RN-038. Cada teste fixa um IP próprio no
 * `X-Forwarded-For`; os limites são por IP e por rota.
 */
let user: Actor;

beforeAll(async () => {
  const { admin } = await freshWorld();
  user = await newUser(admin);
});

afterAll(() => pool.end());

const fromIp = (ip: string) => ({ 'x-forwarded-for': ip });

// Os contadores vivem na memória da API: cada execução usa IPs inéditos.
const run = [Math.floor(Math.random() * 250) + 1, Math.floor(Math.random() * 250) + 1];
const ipFor = (test: number) => `172.${run[0]}.${run[1]}.${test}`;

function expectRateLimited(response: { status: number; body: any }) {
  expect(response.status).toBe(429);
  // O erro do plugin passa pelo tratador comum: `error` vira "Error" (nome da
  // classe) e o `requestId` é acrescentado.
  expect(response.body).toEqual({
    statusCode: 429,
    error: 'Error',
    code: 'RATE_LIMITED',
    message: expect.stringMatching(/^Muitas requisições\. Tente de novo em \d+s\.$/),
    requestId: expect.any(String),
  });
}

describe('rate limits', () => {
  it('login: 8 por 15 min por IP (RN-038)', async () => {
    const ip = ipFor(10);
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const response = await call('POST', '/api/auth/login', {
        body: { email: uniqueEmail(), password: 'Errada12345' },
        headers: fromIp(ip),
      });
      expect(response.status, `tentativa ${attempt}`).toBe(401);
    }
    const ninth = await call('POST', '/api/auth/login', {
      body: { email: uniqueEmail(), password: 'Errada12345' },
      headers: fromIp(ip),
    });
    expectRateLimited(ninth);
    // A mensagem traz o tempo restante da janela de 15 min.
    const seconds = Number(/em (\d+)s/.exec(ninth.body.message)![1]);
    expect(seconds).toBeGreaterThan(800);
    expect(seconds).toBeLessThanOrEqual(900);
    expect(ninth.headers.get('retry-after')).not.toBeNull();

    // Outro IP segue livre.
    const other = await call('POST', '/api/auth/login', {
      body: { email: uniqueEmail(), password: 'Errada12345' },
      headers: fromIp(ipFor(11)),
    });
    expect(other.status).toBe(401);
  });

  it('RN-162 ⚠️: vale o IP mais à ESQUERDA do X-Forwarded-For (o que o cliente envia)', async () => {
    // Simula o proxy da Railway: o cliente manda um IP e o proxy acrescenta o real à direita.
    const realIp = ipFor(50);
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const spoofed = `198.18.${run[0]}.${attempt}`; // muda a cada tentativa
      const response = await call('POST', '/api/auth/login', {
        body: { email: uniqueEmail(), password: 'Errada12345' },
        headers: { 'x-forwarded-for': `${spoofed}, ${realIp}` },
      });
      expect(response.status, `tentativa ${attempt}`).toBe(401); // nunca 429: o limite é burlado
    }
  });

  it('autocadastro: 5 por 15 min por IP (RN-038)', async () => {
    const ip = ipFor(20);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await call('POST', '/api/auth/signup', { body: {}, headers: fromIp(ip) });
      expect(response.status).toBe(400);
    }
    expectRateLimited(await call('POST', '/api/auth/signup', { body: {}, headers: fromIp(ip) }));
  });

  it('troca de senha: 5 por 15 min por IP (RN-038)', async () => {
    const ip = ipFor(30);
    const body = { currentPassword: 'x', newPassword: 'NovaSenha12345', confirmPassword: 'NovaSenha12345' };
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await call('POST', '/api/auth/me/password', { token: user.token, body, headers: fromIp(ip) });
      expect(response.status).toBe(401);
    }
    expectRateLimited(await call('POST', '/api/auth/me/password', { token: user.token, body, headers: fromIp(ip) }));
  });

  it('global: 200 por minuto por IP; /health fica de fora (RN-015, RN-018)', async () => {
    const ip = ipFor(40);
    const statuses: number[] = [];
    for (let index = 0; index < 200; index += 1) {
      statuses.push((await call('GET', '/api/settings', { token: user.token, headers: fromIp(ip) })).status);
    }
    expect(statuses.every((status) => status === 200)).toBe(true);
    const over = await call('GET', '/api/settings', { token: user.token, headers: fromIp(ip) });
    expectRateLimited(over);
    expect(Number(/em (\d+)s/.exec(over.body.message)![1])).toBeLessThanOrEqual(60);

    expect((await call('GET', '/health', { headers: fromIp(ip) })).status).toBe(200);
  });
});
