import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { insertUser, pool, sql } from '../src/db.js';
import { env } from '../src/env.js';
import { call, client, cookieValue } from '../src/http.js';
import { decodeJwt } from '../src/tokens.js';
import { DEFAULT_PASSWORD, freshWorld, uniqueEmail, type Actor } from '../src/world.js';

/**
 * Testes cruzados do M8 (T-084, plano.md §7.2, RNF-02): sessões, cookies, hashes e
 * contas gravados por um backend e usados pelo outro. Precisam de PARITY_NODE_URL e
 * PARITY_DOTNET_URL (a fachada com `Identity` em `dotnet`); sem elas, o arquivo é pulado.
 */
const enabled = Boolean(env.nodeUrl && env.dotnetUrl);
const COOKIE = 'grana_refresh_token';

describe.skipIf(!enabled)('M8 cruzado: identidade Node × .NET no mesmo banco', () => {
  let admin: Actor;

  beforeAll(async () => {
    ({ admin } = await freshWorld());
  });

  afterAll(() => pool.end());

  const login = (baseUrl: string | undefined, email: string, password = DEFAULT_PASSWORD) =>
    call('POST', '/api/auth/login', { body: { email, password }, baseUrl });
  const refresh = (baseUrl: string | undefined, token: string) =>
    call('POST', '/api/auth/refresh', { cookie: `${COOKIE}=${token}`, baseUrl });

  it('login num lado, refresh no outro, em cadeia; o token de um vale no outro', async () => {
    const user = await insertUser({ email: uniqueEmail('cruzado') });
    const first = await login(env.dotnetUrl, user.email);
    expect(first.status).toBe(200);
    expect(Object.keys(decodeJwt(first.body.accessToken))).toEqual(['sub', 'email', 'role', 'iat', 'exp']);

    let token = cookieValue(first.setCookies, COOKIE)!;
    for (const side of [env.nodeUrl, env.dotnetUrl, env.nodeUrl]) {
      const next = await refresh(side, token);
      expect(next.status, side).toBe(200);
      expect(next.body.user).toEqual(first.body.user);
      const me = await client(next.body.accessToken, side === env.nodeUrl ? env.dotnetUrl : env.nodeUrl).get('/api/auth/me');
      expect(me.body).toEqual(first.body.user);
      token = cookieValue(next.setCookies, COOKIE)!;
    }

    // Reuso do token já rotacionado, apresentado ao outro backend: derruba tudo.
    const stale = cookieValue(first.setCookies, COOKIE)!;
    const reuse = await refresh(env.nodeUrl, stale);
    expect(reuse.body.message).toBe('Sessão comprometida. Faça login novamente.');
    expect((await refresh(env.dotnetUrl, token)).body.message).toBe('Sessão comprometida. Faça login novamente.');
  });

  it('a mesma resposta de login e de cookie pelos dois lados (fora token e datas)', async () => {
    const user = await insertUser({ email: uniqueEmail('cookie') });
    const [fromNode, fromDotnet] = [await login(env.nodeUrl, user.email), await login(env.dotnetUrl, user.email)];
    expect(fromDotnet.body.user).toEqual(fromNode.body.user);
    expect(fromDotnet.body.expiresIn).toBe(fromNode.body.expiresIn);
    const shape = (line: string) => line.replace(/=[^;]+;/, '=X;').replace(/Expires=[^;]+/, 'Expires=X');
    expect(shape(fromDotnet.setCookies[0]!)).toBe(shape(fromNode.setCookies[0]!));

    const [outNode, outDotnet] = [
      await call('POST', '/api/auth/logout', { cookie: `${COOKIE}=${cookieValue(fromNode.setCookies, COOKIE)}`, baseUrl: env.dotnetUrl }),
      await call('POST', '/api/auth/logout', { cookie: `${COOKIE}=${cookieValue(fromDotnet.setCookies, COOKIE)}`, baseUrl: env.nodeUrl }),
    ];
    expect(outDotnet.setCookies).toEqual(outNode.setCookies);
    expect((await sql('SELECT 1 FROM refresh_tokens WHERE "userId"=$1 AND "revokedAt" IS NULL', [user.id])).length).toBe(0);
  });

  it('hash gravado pelo .NET entra no Node e vice-versa (cadastro, criação e troca de senha)', async () => {
    const viaDotnet = uniqueEmail('dotnet');
    expect((await call('POST', '/api/auth/signup', { body: { name: 'Pelo Dotnet', email: viaDotnet, password: 'SenhaNova12345' }, baseUrl: env.dotnetUrl })).status).toBe(204);
    await sql(`UPDATE users SET status='ACTIVE' WHERE email=$1`, [viaDotnet]);
    expect((await login(env.nodeUrl, viaDotnet, 'SenhaNova12345')).status).toBe(200);

    const created = await client(admin.token, env.nodeUrl).post('/api/admin/users', { name: 'Pelo Node', email: uniqueEmail('node'), password: 'OutraSenha12345' });
    expect((await login(env.dotnetUrl, created.body.email, 'OutraSenha12345')).status).toBe(200);

    const session = await login(env.dotnetUrl, created.body.email, 'OutraSenha12345');
    const changed = await call('POST', '/api/auth/me/password', {
      token: session.body.accessToken,
      body: { currentPassword: 'OutraSenha12345', newPassword: 'TerceiraSenha123', confirmPassword: 'TerceiraSenha123' },
      baseUrl: env.dotnetUrl,
    });
    expect(changed.status).toBe(204);
    expect((await login(env.nodeUrl, created.body.email, 'TerceiraSenha123')).status).toBe(200);
    const [row] = await sql<{ passwordHash: string }>('SELECT "passwordHash" FROM users WHERE id=$1', [created.body.id]);
    expect(row!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  });

  it('administração cruzada: listas iguais, edição, bloqueio e exclusão', async () => {
    const node = client(admin.token, env.nodeUrl);
    const dotnet = client(admin.token, env.dotnetUrl);
    const target = await dotnet.post('/api/admin/users', { name: 'Alvo', email: uniqueEmail('alvo'), password: 'SenhaForte12345', role: 'USER' });
    expect(target.status).toBe(201);
    for (const query of ['', '?perPage=2', '?page=2&perPage=2', '?search=ALVO', '?role=ADMIN', '?status=ACTIVE', '?search=%25']) {
      const [a, b] = await Promise.all([node.get(`/api/admin/users${query}`), dotnet.get(`/api/admin/users${query}`)]);
      expect(b.body, query).toEqual(a.body);
    }

    await node.patch(`/api/admin/users/${target.body.id}`, { status: 'SUSPENDED' });
    expect((await login(env.dotnetUrl, target.body.email, 'SenhaForte12345')).body.message).toBe('Esta conta está suspensa. Fale com o administrador.');
    const self = await dotnet.patch(`/api/admin/users/${admin.id}`, { role: 'USER' });
    expect(self.body.message).toBe('Você não pode alterar o perfil da a própria conta.');

    // Bloqueio por senha errada: 5 falhas alternando os backends.
    const victim = await insertUser({ email: uniqueEmail('bloqueio') });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(attempt % 2 === 0 ? env.nodeUrl : env.dotnetUrl, victim.email, 'Errada12345');
    }
    const blocked = await login(env.dotnetUrl, victim.email);
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toBe('Conta temporariamente bloqueada por excesso de tentativas. Tente em 15 min.');

    expect((await dotnet.delete(`/api/admin/users/${target.body.id}`)).status).toBe(204);
    expect((await node.get(`/api/admin/users/${target.body.id}`)).status).toBe(404);
  });

  it('as linhas gravadas pelos dois lados têm a mesma forma (plano.md §7.3)', async () => {
    const [a, b] = [await insertUser({ email: uniqueEmail('forma-a') }), await insertUser({ email: uniqueEmail('forma-b') })];
    await call('POST', '/api/auth/login', { body: { email: a.email, password: DEFAULT_PASSWORD }, headers: { 'user-agent': 'forma/1.0', 'x-forwarded-for': '10.200.0.1' }, baseUrl: env.nodeUrl });
    await call('POST', '/api/auth/login', { body: { email: b.email, password: DEFAULT_PASSWORD }, headers: { 'user-agent': 'forma/1.0', 'x-forwarded-for': '10.200.0.1' }, baseUrl: env.dotnetUrl });
    const tokens = await sql<Record<string, unknown>>(
      'SELECT "userId", length("tokenHash") AS "hashLength", "userAgent", ip, "revokedAt", "replacedBy", ("expiresAt" - "createdAt") > interval \'6 days 23 hours\' AS "sevenDays" FROM refresh_tokens WHERE "userId" IN ($1,$2) ORDER BY ("userId" = $1) DESC',
      [a.id, b.id],
    );
    expect({ ...tokens[1], userId: 'x' }).toEqual({ ...tokens[0], userId: 'x' });
    const audits = await sql<Record<string, unknown>>(
      'SELECT action, "targetType", "actorEmail" IS NOT NULL AS "hasEmail", ip, metadata FROM audit_logs WHERE "targetId" IN ($1,$2) ORDER BY ("targetId" = $1) DESC, "createdAt"',
      [a.id, b.id],
    );
    expect(audits.length).toBe(2);
    expect(audits[1]).toEqual(audits[0]);

    // Hash de refresh é o SHA-256 hex do token do cookie.
    const session = await login(env.dotnetUrl, b.email);
    const token = cookieValue(session.setCookies, COOKIE)!;
    const stored = await sql('SELECT 1 FROM refresh_tokens WHERE "tokenHash"=$1', [createHash('sha256').update(token).digest('hex')]);
    expect(stored.length).toBe(1);
  });
});
