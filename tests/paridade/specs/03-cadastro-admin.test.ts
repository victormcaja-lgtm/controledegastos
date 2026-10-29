import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertUser, pool, sql } from '../src/db.js';
import { call, client } from '../src/http.js';
import { signAccessToken } from '../src/tokens.js';
import { DEFAULT_PASSWORD, freshWorld, newUser, uniqueEmail, type Actor } from '../src/world.js';

/** Autocadastro e área administrativa — analise.md §4.3 (RN-050 a RN-062). */
let admin: Actor;

beforeAll(async () => {
  ({ admin } = await freshWorld());
});

afterAll(() => pool.end());

const DEFAULT_CATEGORIES = [
  { name: 'Assinaturas', color: 'oklch(0.62 0.10 330)', kind: 'EXPENSE' },
  { name: 'Casa', color: 'oklch(0.62 0.10 250)', kind: 'EXPENSE' },
  { name: 'Dívidas', color: 'oklch(0.62 0.10 40)', kind: 'EXPENSE' },
  { name: 'Educação', color: 'oklch(0.62 0.10 200)', kind: 'EXPENSE' },
  { name: 'Lazer', color: 'oklch(0.62 0.10 300)', kind: 'EXPENSE' },
  { name: 'Mercado', color: 'oklch(0.62 0.10 145)', kind: 'EXPENSE' },
  { name: 'Roupa', color: 'oklch(0.62 0.10 20)', kind: 'EXPENSE' },
  { name: 'Transporte', color: 'oklch(0.62 0.10 70)', kind: 'EXPENSE' },
  { name: 'Bônus', color: 'oklch(0.62 0.10 90)', kind: 'INCOME' },
  { name: 'Renda extra', color: 'oklch(0.62 0.10 120)', kind: 'INCOME' },
  { name: 'Salário', color: 'oklch(0.62 0.10 160)', kind: 'INCOME' },
];

const userIdByEmail = async (email: string) =>
  (await sql<{ id: string }>('SELECT id FROM "users" WHERE email=$1', [email]))[0]?.id;

const userDto = (overrides: Record<string, unknown>) => ({
  id: expect.any(String),
  name: expect.any(String),
  email: expect.any(String),
  role: 'USER',
  status: 'ACTIVE',
  mustChangePassword: expect.any(Boolean),
  lastLoginAt: null,
  createdAt: expect.any(String),
  updatedAt: expect.any(String),
  ...overrides,
});

describe('autocadastro (RN-050)', () => {
  it('cria pendente, com espaço financeiro e auditoria sem ator', async () => {
    const email = uniqueEmail('cadastro');
    const response = await call('POST', '/api/auth/signup', {
      body: { name: '  Duda Lima ', email: email.toUpperCase(), password: DEFAULT_PASSWORD },
    });
    expect(response.status).toBe(204);
    expect(response.text).toBe('');

    const [row] = await sql<any>(
      'SELECT id, name, role, status, "mustChangePassword" FROM "users" WHERE email=$1',
      [email],
    );
    expect(row).toMatchObject({ name: 'Duda Lima', role: 'USER', status: 'PENDING', mustChangePassword: false });

    const categories = await sql<any>(
      'SELECT name, color, kind, "isSystem" FROM "categories" WHERE "userId"=$1',
      [row.id],
    );
    expect(categories).toHaveLength(11);
    expect(categories.every((c) => c.isSystem)).toBe(true);
    expect((await sql('SELECT 1 FROM "user_settings" WHERE "userId"=$1', [row.id])).length).toBe(1);

    const [audit] = await sql<any>(
      'SELECT action, "actorId", "actorEmail" FROM "audit_logs" WHERE "targetId"=$1',
      [row.id],
    );
    expect(audit).toEqual({ action: 'user.signup_requested', actorId: null, actorEmail: email });
  });

  it('e-mail repetido → 409 "Já existe uma conta com este e-mail."', async () => {
    const user = await newUser(admin);
    const response = await call('POST', '/api/auth/signup', {
      body: { name: 'Outra Pessoa', email: user.email, password: DEFAULT_PASSWORD },
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: 'ConflictError', code: 'CONFLICT', message: 'Já existe uma conta com este e-mail.' });
  });

  it('nome curto e senha fraca → mensagens por campo', async () => {
    const response = await call('POST', '/api/auth/signup', {
      body: { name: 'A', email: uniqueEmail(), password: 'curta' },
    });
    expect(response.status).toBe(400);
    expect(response.body.details).toEqual(
      expect.arrayContaining([
        { path: 'name', message: 'Informe o nome completo.' },
        { path: 'password', message: 'A senha precisa ter pelo menos 10 caracteres.' },
      ]),
    );
  });
});

describe('acesso à área administrativa (RN-051)', () => {
  it('usuário comum → 403 "Esta área é exclusiva de administradores."', async () => {
    const user = await newUser(admin);
    const validBody = { name: 'Alguém', email: uniqueEmail(), password: DEFAULT_PASSWORD };
    for (const [method, path] of [
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users'],
      ['DELETE', `/api/admin/users/${admin.id}`],
    ] as const) {
      const response = await call(method, path, { token: user.token, body: method === 'POST' ? validBody : undefined });
      expect(response.status, path).toBe(403);
      expect(response.body).toMatchObject({
        error: 'ForbiddenError',
        code: 'FORBIDDEN',
        message: 'Esta área é exclusiva de administradores.',
      });
    }
  });

  it('sem token → 401 antes do 403', async () => {
    expect((await call('GET', '/api/admin/users')).status).toBe(401);
  });

  it('a validação do corpo vem ANTES da autorização: comum com corpo inválido → 400', async () => {
    const user = await newUser(admin);
    const response = await user.api.post('/api/admin/users', {});
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('criação pelo admin (RN-053, RN-062)', () => {
  it('padrões: USER, troca obrigatória, categorias padrão; 201 com UserDTO', async () => {
    const email = uniqueEmail();
    const response = await admin.api.post('/api/admin/users', {
      name: 'Eva Prado',
      email,
      password: DEFAULT_PASSWORD,
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual(userDto({ name: 'Eva Prado', email, mustChangePassword: true }));

    const categories = await call('GET', '/api/categories', {
      token: signAccessToken({ id: response.body.id, email }),
    });
    // RN-070: ordem kind asc (EXPENSE antes de INCOME), depois nome.
    expect(categories.body.map((c: any) => ({ name: c.name, color: c.color, kind: c.kind }))).toEqual(DEFAULT_CATEGORIES);
    expect(categories.body.every((c: any) => c.isSystem === true && c.archivedAt === null)).toBe(true);

    const [audit] = await sql<any>(
      `SELECT "actorId", metadata FROM "audit_logs" WHERE "targetId"=$1 AND action='user.created'`,
      [response.body.id],
    );
    expect(audit).toEqual({ actorId: admin.id, metadata: { email, role: 'USER' } });
  });

  it('sem categorias padrão: só os ajustes', async () => {
    const user = await newUser(admin, { seedDefaultCategories: false });
    expect((await user.api.get('/api/categories')).body).toEqual([]);
    expect((await user.api.get('/api/settings')).status).toBe(200);
  });

  it('e-mail repetido → 409 "Já existe um usuário com este e-mail."', async () => {
    const user = await newUser(admin);
    const response = await admin.api.post('/api/admin/users', {
      name: 'Repetida',
      email: user.email.toUpperCase(),
      password: DEFAULT_PASSWORD,
    });
    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Já existe um usuário com este e-mail.');
  });
});

describe('listagem (RN-052)', () => {
  beforeAll(async () => {
    await newUser(admin, { name: 'Zeca Listagem', email: uniqueEmail('zeca') });
    await newUser(admin, { name: 'Lia Listagem', email: uniqueEmail('lia'), role: 'ADMIN' });
  });

  it('paginação padrão, ordem por criação decrescente e totalPages', async () => {
    const response = await admin.api.get('/api/admin/users');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 1, perPage: 20 });
    const total = (await sql<{ n: string }>('SELECT COUNT(*) n FROM "users"'))[0]!.n;
    expect(response.body.total).toBe(Number(total));
    expect(response.body.totalPages).toBe(Math.max(1, Math.ceil(Number(total) / 20)));
    const created = response.body.items.map((u: any) => u.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
    expect(response.body.items[0]).not.toHaveProperty('passwordHash');
  });

  it('busca no nome ou e-mail, sem diferenciar maiúsculas; filtros de perfil e status', async () => {
    const byName = await admin.api.get('/api/admin/users?search=LISTAGEM');
    expect(byName.body.items.map((u: any) => u.name).sort()).toEqual(['Lia Listagem', 'Zeca Listagem']);
    const byEmail = await admin.api.get('/api/admin/users?search=zeca.');
    expect(byEmail.body.items).toHaveLength(1);
    const admins = await admin.api.get('/api/admin/users?search=listagem&role=ADMIN');
    expect(admins.body.items.map((u: any) => u.name)).toEqual(['Lia Listagem']);
    const nobody = await admin.api.get('/api/admin/users?search=ninguem-com-este-nome');
    expect(nobody.body).toMatchObject({ items: [], total: 0, totalPages: 1 });
  });

  it('perPage acima de 100 é recusado; página além do fim vem vazia', async () => {
    expect((await admin.api.get('/api/admin/users?perPage=101')).status).toBe(400);
    const far = await admin.api.get('/api/admin/users?page=999&perPage=1');
    expect(far.body.items).toEqual([]);
    expect(far.body.page).toBe(999);
  });

  it('detalhe inexistente → 404 "Usuário não encontrado."', async () => {
    const response = await admin.api.get('/api/admin/users/00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Usuário não encontrado.');
  });
});

describe('edição pelo admin (RN-054 a RN-058)', () => {
  it('RN-054 ⚠️: mexer no próprio perfil ou status → 403 com "da a"', async () => {
    const role = await admin.api.patch(`/api/admin/users/${admin.id}`, { role: 'USER' });
    expect(role.status).toBe(403);
    expect(role.body.message).toBe('Você não pode alterar o perfil da a própria conta.');
    const status = await admin.api.patch(`/api/admin/users/${admin.id}`, { status: 'SUSPENDED' });
    expect(status.body.message).toBe('Você não pode alterar o status da a própria conta.');
    // Mesmo valor atual não conta como mudança.
    expect((await admin.api.patch(`/api/admin/users/${admin.id}`, { role: 'ADMIN', status: 'ACTIVE' })).status).toBe(200);
  });

  it('RN-054: nome e e-mail; e-mail de outra pessoa → 409', async () => {
    const user = await newUser(admin);
    const other = await newUser(admin);
    const email = uniqueEmail('novo');
    const ok = await admin.api.patch(`/api/admin/users/${user.id}`, { name: 'Novo Nome', email: email.toUpperCase() });
    expect(ok.body).toEqual(userDto({ id: user.id, name: 'Novo Nome', email }));
    const clash = await admin.api.patch(`/api/admin/users/${user.id}`, { email: other.email });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toBe('Já existe um usuário com este e-mail.');
  });

  it('RN-055: último administrador ativo não é rebaixado nem suspenso', async () => {
    // O ator é admin pelo token, mas está suspenso no banco (RN-044): o alvo
    // passa a ser o único admin ativo.
    const target = await newUser(admin, { role: 'ADMIN' });
    const actor = await insertUser({ email: uniqueEmail('admin-suspenso'), role: 'ADMIN', status: 'SUSPENDED' });
    const actorApi = client(signAccessToken({ ...actor, role: 'ADMIN' }));
    await sql(`UPDATE "users" SET status='SUSPENDED' WHERE role='ADMIN' AND id <> $1`, [target.id]);

    const demote = await actorApi.patch(`/api/admin/users/${target.id}`, { role: 'USER' });
    expect(demote.status).toBe(422);
    expect(demote.body).toMatchObject({
      error: 'BusinessRuleError',
      code: 'BUSINESS_RULE',
      message: 'Este é o último administrador ativo. Promova outro usuário antes de alterar este.',
    });
    const suspend = await actorApi.patch(`/api/admin/users/${target.id}`, { status: 'SUSPENDED' });
    expect(suspend.status).toBe(422);

    // RN-060: e também não é excluído.
    const remove = await actorApi.delete(`/api/admin/users/${target.id}`);
    expect(remove.status).toBe(422);
    expect(remove.body.message).toBe('Não é possível excluir o último administrador ativo.');

    await sql(`UPDATE "users" SET status='ACTIVE' WHERE id=$1`, [admin.id]);
  });

  it('RN-055: admin suspenso pode ser rebaixado mesmo sem outro admin', async () => {
    const target = await newUser(admin, { role: 'ADMIN' });
    await admin.api.patch(`/api/admin/users/${target.id}`, { status: 'SUSPENDED' });
    const response = await admin.api.patch(`/api/admin/users/${target.id}`, { role: 'USER' });
    expect(response.body).toMatchObject({ role: 'USER', status: 'SUSPENDED' });
  });

  it('RN-056: suspender derruba as sessões; reativar zera o bloqueio', async () => {
    const user = await newUser(admin);
    await call('POST', '/api/auth/login', { body: { email: user.email, password: DEFAULT_PASSWORD } });
    await admin.api.patch(`/api/admin/users/${user.id}`, { status: 'SUSPENDED' });
    expect((await sql('SELECT 1 FROM "refresh_tokens" WHERE "userId"=$1 AND "revokedAt" IS NULL', [user.id])).length).toBe(0);

    await sql(`UPDATE "users" SET "failedLoginAttempts"=3, "lockedUntil"=NOW() + INTERVAL '1 hour' WHERE id=$1`, [user.id]);
    const active = await admin.api.patch(`/api/admin/users/${user.id}`, { status: 'ACTIVE' });
    expect(active.body.status).toBe('ACTIVE');
    const [row] = await sql<any>('SELECT "failedLoginAttempts","lockedUntil" FROM "users" WHERE id=$1', [user.id]);
    expect(row).toEqual({ failedLoginAttempts: 0, lockedUntil: null });
  });

  it('RN-056: aprovar um pendente = status ACTIVE', async () => {
    const email = uniqueEmail('pendente');
    await call('POST', '/api/auth/signup', { body: { name: 'Pendente', email, password: DEFAULT_PASSWORD } });
    const id = await userIdByEmail(email);
    const pending = await admin.api.get('/api/admin/users?status=PENDING');
    expect(pending.body.items.some((u: any) => u.id === id)).toBe(true);
    await admin.api.patch(`/api/admin/users/${id}`, { status: 'ACTIVE' });
    const login = await call('POST', '/api/auth/login', { body: { email, password: DEFAULT_PASSWORD } });
    expect(login.status).toBe(200);
  });

  it('RN-057 ⚠️: enviar status PENDING grava ACTIVE', async () => {
    const user = await newUser(admin);
    await admin.api.patch(`/api/admin/users/${user.id}`, { status: 'SUSPENDED' });
    const response = await admin.api.patch(`/api/admin/users/${user.id}`, { status: 'PENDING' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ACTIVE');
  });

  it('RN-058: auditoria guarda o corpo recebido', async () => {
    const user = await newUser(admin);
    await admin.api.patch(`/api/admin/users/${user.id}`, { name: 'Auditado' });
    const [audit] = await sql<any>(
      `SELECT metadata FROM "audit_logs" WHERE "targetId"=$1 AND action='user.updated'`,
      [user.id],
    );
    expect(audit.metadata).toEqual({ changes: { name: 'Auditado' } });
  });
});

describe('redefinir senha (RN-059)', () => {
  it('204, troca obrigatória por padrão, derruba sessões; vale para a própria conta', async () => {
    const user = await newUser(admin);
    await call('POST', '/api/auth/login', { body: { email: user.email, password: DEFAULT_PASSWORD } });
    const response = await admin.api.post(`/api/admin/users/${user.id}/password`, { newPassword: 'Provisoria123' });
    expect(response.status).toBe(204);
    const login = await call('POST', '/api/auth/login', { body: { email: user.email, password: 'Provisoria123' } });
    expect(login.body.user.mustChangePassword).toBe(true);
    expect(
      (await sql('SELECT 1 FROM "refresh_tokens" WHERE "userId"=$1 AND "revokedAt" IS NULL', [user.id])).length,
    ).toBe(1); // só a sessão aberta agora

    const self = await admin.api.post(`/api/admin/users/${admin.id}/password`, {
      newPassword: 'AdminNova12345',
      mustChangePassword: false,
    });
    expect(self.status).toBe(204);
  });
});

describe('exclusão (RN-060)', () => {
  it('a própria conta → 403 "Você não pode excluir a própria conta."', async () => {
    const response = await admin.api.delete(`/api/admin/users/${admin.id}`);
    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Você não pode excluir a própria conta.');
  });

  it('apaga tudo em cascata; auditorias em que ele era ator ficam sem ator', async () => {
    const user = await newUser(admin);
    await user.api.post('/api/incomes', { name: 'Salário', amountCents: 100, receiptDay: 5 });
    await user.api.post('/api/auth/me/password', {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'OutraSenha12345',
      confirmPassword: 'OutraSenha12345',
    });
    const response = await admin.api.delete(`/api/admin/users/${user.id}`);
    expect(response.status).toBe(204);
    for (const table of ['categories', 'incomes', 'user_settings']) {
      expect((await sql(`SELECT 1 FROM "${table}" WHERE "userId"=$1`, [user.id])).length, table).toBe(0);
    }
    const [orphan] = await sql<any>(
      `SELECT "actorId" FROM "audit_logs" WHERE "targetId"=$1 AND action='auth.password.changed'`,
      [user.id],
    );
    expect(orphan.actorId).toBeNull();
    const [deleted] = await sql<any>(
      `SELECT "actorId", metadata FROM "audit_logs" WHERE "targetId"=$1 AND action='user.deleted'`,
      [user.id],
    );
    expect(deleted).toEqual({ actorId: admin.id, metadata: { email: user.email } });
  });
});
