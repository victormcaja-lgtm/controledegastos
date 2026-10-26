import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertUser, pool, sql } from '../src/db.js';
import { call, client, cookieAttributes, cookieValue } from '../src/http.js';
import { decodeJwt } from '../src/tokens.js';
import { DEFAULT_PASSWORD, freshWorld, newUser, uniqueEmail, type Actor } from '../src/world.js';

/** Autenticação e sessão — analise.md §4.2 (RN-030 a RN-046). */
const COOKIE = 'grana_refresh_token';
let admin: Actor;

beforeAll(async () => {
  ({ admin } = await freshWorld());
});

afterAll(() => pool.end());

const login = (email: string, password = DEFAULT_PASSWORD, headers: Record<string, string> = {}) =>
  call('POST', '/api/auth/login', { body: { email, password }, headers });

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function userRow(id: string) {
  const [row] = await sql<{
    failedLoginAttempts: number;
    lockedUntil: Date | null;
    lastLoginAt: Date | null;
    mustChangePassword: boolean;
    status: string;
  }>('SELECT "failedLoginAttempts","lockedUntil","lastLoginAt","mustChangePassword","status" FROM "users" WHERE id=$1', [
    id,
  ]);
  return row!;
}

const activeTokens = async (userId: string) =>
  (await sql('SELECT id FROM "refresh_tokens" WHERE "userId"=$1 AND "revokedAt" IS NULL', [userId])).length;

const auditActions = async (targetId: string) =>
  (await sql<{ action: string; metadata: any }>(
    'SELECT action, metadata FROM "audit_logs" WHERE "targetId"=$1 ORDER BY "createdAt"',
    [targetId],
  ));

describe('login', () => {
  it('RN-036/037: sessão aberta — corpo, JWT, cookie de refresh e o que fica gravado', async () => {
    const user = await newUser(admin, { name: 'Ana Souza' });
    const response = await login(user.email, DEFAULT_PASSWORD, { 'user-agent': 'paridade/1.0' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      accessToken: expect.any(String),
      expiresIn: 900,
      user: {
        id: user.id,
        name: 'Ana Souza',
        email: user.email,
        role: 'USER',
        status: 'ACTIVE',
        mustChangePassword: false,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      },
    });

    // O token emitido NÃO traz `iss` (a opção do `sign` substitui a padrão);
    // a verificação aceita `iss` ausente e recusa `iss` diferente (ver 01-transversal).
    const payload = decodeJwt(response.body.accessToken);
    expect(Object.keys(payload).sort()).toEqual(['email', 'exp', 'iat', 'role', 'sub']);
    expect(payload).toMatchObject({ sub: user.id, email: user.email, role: 'USER' });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(900);

    const refresh = cookieValue(response.setCookies, COOKIE)!;
    expect(refresh).toMatch(/^[A-Za-z0-9_-]{86}$/); // 64 bytes em base64url
    const attributes = cookieAttributes(response.setCookies, COOKIE);
    expect(attributes).toMatchObject({ path: '/api/auth', httponly: true, secure: true, samesite: 'None' });
    const expires = Date.parse(String(attributes.expires));
    expect(Math.abs(expires - (Date.now() + 7 * 86_400_000))).toBeLessThan(120_000);

    const [stored] = await sql<{ tokenHash: string; userAgent: string; revokedAt: Date | null }>(
      'SELECT "tokenHash","userAgent","revokedAt" FROM "refresh_tokens" WHERE "userId"=$1',
      [user.id],
    );
    expect(stored).toEqual({ tokenHash: sha256(refresh), userAgent: 'paridade/1.0', revokedAt: null });
    expect((await userRow(user.id)).lastLoginAt).not.toBeNull();
    expect((await auditActions(user.id)).map((a) => a.action)).toContain('auth.login.success');
  });

  it('RN-030: e-mail é aparado e passa para minúsculas', async () => {
    const user = await newUser(admin);
    const response = await login(`  ${user.email.toUpperCase()}  `);
    expect(response.status).toBe(200);
  });

  it('RN-031: senha vazia → "Informe a senha."', async () => {
    const response = await login('alguem@grana.app', '');
    expect(response.status).toBe(400);
    expect(response.body.details).toContainEqual({ path: 'password', message: 'Informe a senha.' });
  });

  it('RN-032: e-mail inexistente → mesma mensagem e auditoria unknown_email', async () => {
    const email = uniqueEmail('fantasma');
    const response = await login(email, 'QualquerCoisa123');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      statusCode: 401,
      error: 'UnauthorizedError',
      code: 'UNAUTHORIZED',
      message: 'E-mail ou senha incorretos.',
      requestId: expect.any(String),
    });
    const [audit] = await sql<{ action: string; metadata: any; targetId: string | null }>(
      'SELECT action, metadata, "targetId" FROM "audit_logs" WHERE "actorEmail"=$1',
      [email],
    );
    expect(audit).toEqual({ action: 'auth.login.failed', metadata: { reason: 'unknown_email' }, targetId: null });
  });

  it('RN-034: 5ª senha errada ainda é 401, mas bloqueia por 15 min e zera o contador', async () => {
    const user = await newUser(admin);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await login(user.email, 'SenhaErrada123')).status).toBe(401);
      expect((await userRow(user.id)).failedLoginAttempts).toBe(attempt);
    }
    const fifth = await login(user.email, 'SenhaErrada123');
    expect(fifth.status).toBe(401);
    expect(fifth.body.message).toBe('E-mail ou senha incorretos.');

    const row = await userRow(user.id);
    expect(row.failedLoginAttempts).toBe(0);
    expect(Math.abs(row.lockedUntil!.getTime() - (Date.now() + 15 * 60_000))).toBeLessThan(60_000);
    const failures = (await auditActions(user.id)).filter((a) => a.action === 'auth.login.failed');
    expect(failures).toHaveLength(5);
    expect(failures.every((a) => a.metadata?.reason === 'bad_password')).toBe(true);

    // RN-033: bloqueada, nem a senha certa entra.
    const blocked = await login(user.email);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      statusCode: 429,
      error: 'TooManyAttemptsError',
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Conta temporariamente bloqueada por excesso de tentativas. Tente em 15 min.',
      requestId: expect.any(String),
    });
  });

  it('RN-033: minutos restantes arredondados para cima', async () => {
    const user = await insertUser({ email: uniqueEmail(), lockedUntil: new Date(Date.now() + 90_000) });
    const response = await login(user.email);
    expect(response.status).toBe(429);
    expect(response.body.message).toBe('Conta temporariamente bloqueada por excesso de tentativas. Tente em 2 min.');
  });

  it('RN-036: bloqueio vencido não impede o login e zera os contadores', async () => {
    const user = await insertUser({
      email: uniqueEmail(),
      lockedUntil: new Date(Date.now() - 1000),
      failedLoginAttempts: 3,
    });
    expect((await login(user.email)).status).toBe(200);
    const row = await userRow(user.id);
    expect(row.failedLoginAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it('RN-035: status checado depois da senha — pendente e suspenso', async () => {
    const pending = await insertUser({ email: uniqueEmail(), status: 'PENDING' });
    const suspended = await insertUser({ email: uniqueEmail(), status: 'SUSPENDED' });

    const pendingResponse = await login(pending.email);
    expect(pendingResponse.status).toBe(401);
    expect(pendingResponse.body.message).toBe('Sua conta ainda não foi aprovada pelo administrador.');

    const suspendedResponse = await login(suspended.email);
    expect(suspendedResponse.status).toBe(401);
    expect(suspendedResponse.body.message).toBe('Esta conta está suspensa. Fale com o administrador.');

    // Com a senha errada, nada revela o status.
    const wrong = await login(pending.email, 'SenhaErrada123');
    expect(wrong.body.message).toBe('E-mail ou senha incorretos.');
    expect((await userRow(pending.id)).failedLoginAttempts).toBe(1);
    expect(await activeTokens(pending.id)).toBe(0);
  });
});

describe('refresh (RN-039)', () => {
  it('sem cookie → 401 "Sessão inválida. Faça login novamente."', async () => {
    const response = await call('POST', '/api/auth/refresh');
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Sessão inválida. Faça login novamente.');
    expect(response.setCookies).toEqual([]);
  });

  it('rotaciona: emite outro, revoga o anterior apontando para o novo', async () => {
    const user = await newUser(admin, { name: 'Bia' });
    const first = cookieValue((await login(user.email)).setCookies, COOKIE)!;

    const response = await call('POST', '/api/auth/refresh', { cookie: `${COOKIE}=${first}` });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ expiresIn: 900, user: { id: user.id, name: 'Bia' } });
    const second = cookieValue(response.setCookies, COOKIE)!;
    expect(second).not.toBe(first);

    const [old] = await sql<{ revokedAt: Date | null; replacedBy: string | null }>(
      'SELECT "revokedAt","replacedBy" FROM "refresh_tokens" WHERE "tokenHash"=$1',
      [sha256(first)],
    );
    const [fresh] = await sql<{ id: string }>('SELECT id FROM "refresh_tokens" WHERE "tokenHash"=$1', [sha256(second)]);
    expect(old!.revokedAt).not.toBeNull();
    expect(old!.replacedBy).toBe(fresh!.id);
  });

  it('reuso de token revogado derruba TODAS as sessões', async () => {
    const user = await newUser(admin);
    const deviceA = cookieValue((await login(user.email)).setCookies, COOKIE)!;
    await login(user.email); // outra sessão, outro aparelho
    await call('POST', '/api/auth/refresh', { cookie: `${COOKIE}=${deviceA}` });
    expect(await activeTokens(user.id)).toBe(2);

    const reuse = await call('POST', '/api/auth/refresh', { cookie: `${COOKIE}=${deviceA}` });
    expect(reuse.status).toBe(401);
    expect(reuse.body.message).toBe('Sessão comprometida. Faça login novamente.');
    expect(await activeTokens(user.id)).toBe(0);
  });

  it('expirado → "Sessão expirada. Faça login novamente."', async () => {
    const user = await newUser(admin);
    const token = cookieValue((await login(user.email)).setCookies, COOKIE)!;
    await sql(`UPDATE "refresh_tokens" SET "expiresAt" = NOW() - INTERVAL '1 second' WHERE "tokenHash"=$1`, [sha256(token)]);
    const response = await call('POST', '/api/auth/refresh', { cookie: `${COOKIE}=${token}` });
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Sessão expirada. Faça login novamente.');
  });

  it('usuário que deixou de estar ativo → "Sessão inválida…" e todas revogadas', async () => {
    const user = await newUser(admin);
    const token = cookieValue((await login(user.email)).setCookies, COOKIE)!;
    await sql(`UPDATE "users" SET status='PENDING' WHERE id=$1`, [user.id]);
    const response = await call('POST', '/api/auth/refresh', { cookie: `${COOKIE}=${token}` });
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Sessão inválida. Faça login novamente.');
    expect(await activeTokens(user.id)).toBe(0);
  });
});

describe('logout (RN-040)', () => {
  it('sem access token: revoga o refresh e limpa o cookie', async () => {
    const user = await newUser(admin);
    const token = cookieValue((await login(user.email)).setCookies, COOKIE)!;
    const response = await call('POST', '/api/auth/logout', { cookie: `${COOKIE}=${token}` });
    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    const cleared = cookieAttributes(response.setCookies, COOKIE);
    expect(cookieValue(response.setCookies, COOKIE)).toBe('');
    expect(cleared.path).toBe('/api/auth');
    expect(Date.parse(String(cleared.expires))).toBe(0);
    expect(await activeTokens(user.id)).toBe(0);

    const reuse = await call('POST', '/api/auth/refresh', { cookie: `${COOKIE}=${token}` });
    expect(reuse.body.message).toBe('Sessão comprometida. Faça login novamente.');
  });

  it('sem cookie também responde 204', async () => {
    expect((await call('POST', '/api/auth/logout')).status).toBe(204);
  });
});

describe('perfil', () => {
  it('GET /me devolve o usuário autenticado', async () => {
    const user = await newUser(admin, { name: 'Caio' });
    const response = await user.api.get('/api/auth/me');
    expect(response.body).toEqual({
      id: user.id,
      name: 'Caio',
      email: user.email,
      role: 'USER',
      status: 'ACTIVE',
      mustChangePassword: false,
      createdAt: expect.any(String),
    });
  });

  it('RN-041: PATCH /me renomeia e responde UserDTO', async () => {
    const user = await newUser(admin);
    const response = await user.api.patch('/api/auth/me', { name: '  Nome Novo  ' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: user.id,
      name: 'Nome Novo',
      email: user.email,
      role: 'USER',
      status: 'ACTIVE',
      mustChangePassword: false,
      lastLoginAt: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const short = await user.api.patch('/api/auth/me', { name: 'a' });
    expect(short.status).toBe(400);
  });
});

describe('troca de senha (RN-042)', () => {
  it('validações do formulário', async () => {
    const user = await newUser(admin);
    const mismatch = await user.api.post('/api/auth/me/password', {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'NovaSenha12345',
      confirmPassword: 'OutraSenha12345',
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.details).toContainEqual({ path: 'confirmPassword', message: 'As senhas não conferem.' });

    const same = await user.api.post('/api/auth/me/password', {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: DEFAULT_PASSWORD,
      confirmPassword: DEFAULT_PASSWORD,
    });
    expect(same.body.details).toContainEqual({
      path: 'newPassword',
      message: 'A nova senha precisa ser diferente da atual.',
    });

    const weak = await user.api.post('/api/auth/me/password', {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'semnumeroaqui',
      confirmPassword: 'semnumeroaqui',
    });
    expect(weak.body.details).toEqual(
      expect.arrayContaining([
        { path: 'newPassword', message: 'Inclua ao menos uma letra maiúscula.' },
        { path: 'newPassword', message: 'Inclua ao menos um número.' },
      ]),
    );
  });

  it('senha atual errada → 401 "A senha atual está incorreta."', async () => {
    const user = await newUser(admin);
    const response = await user.api.post('/api/auth/me/password', {
      currentPassword: 'NaoEhEssa12345',
      newPassword: 'NovaSenha12345',
      confirmPassword: 'NovaSenha12345',
    });
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('A senha atual está incorreta.');
  });

  it('sucesso: 204, limpa o cookie, derruba todas as sessões e tira a troca obrigatória', async () => {
    const user = await newUser(admin, { mustChangePassword: true });
    await login(user.email);
    await login(user.email);
    const response = await user.api.post('/api/auth/me/password', {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'NovaSenha12345',
      confirmPassword: 'NovaSenha12345',
    });
    expect(response.status).toBe(204);
    expect(cookieValue(response.setCookies, COOKIE)).toBe('');
    expect(await activeTokens(user.id)).toBe(0);
    expect((await userRow(user.id)).mustChangePassword).toBe(false);
    expect((await auditActions(user.id)).map((a) => a.action)).toContain('auth.password.changed');
    expect((await login(user.email)).status).toBe(401);
    expect((await login(user.email, 'NovaSenha12345')).status).toBe(200);
  });
});

describe('limites da autorização (comportamento atual)', () => {
  it('RN-043 ⚠️: troca obrigatória de senha NÃO é imposta pela API', async () => {
    const user = await newUser(admin, { mustChangePassword: true });
    const response = await user.api.get('/api/settings');
    expect(response.status).toBe(200);
  });

  it('RN-044 ⚠️: access token de usuário suspenso continua valendo até expirar', async () => {
    const user = await newUser(admin);
    await admin.api.patch(`/api/admin/users/${user.id}`, { status: 'SUSPENDED' });
    expect((await userRow(user.id)).status).toBe('SUSPENDED');
    expect((await user.api.get('/api/categories')).status).toBe(200);
  });

  it('RN-044 ⚠️: o perfil vem do token — rebaixado ainda entra na área de admin', async () => {
    const promoted = await newUser(admin, { role: 'ADMIN' });
    await admin.api.patch(`/api/admin/users/${promoted.id}`, { role: 'USER' });
    expect((await promoted.api.get('/api/admin/users')).status).toBe(200);
    // Um token novo, com o perfil atual, já não entra.
    const fresh = client(
      (await login(promoted.email)).body.accessToken,
    );
    expect((await fresh.get('/api/admin/users')).status).toBe(403);
  });
});
