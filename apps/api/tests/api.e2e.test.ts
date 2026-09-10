import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/shared/infra/database/prisma.js';
import { currentMonthRef } from '@grana/shared';

/**
 * Testes de integração de verdade: sobem a aplicação inteira (rotas, validação,
 * autenticação, casos de uso, Prisma) contra um Postgres real e batem via
 * `app.inject`, sem abrir porta.
 *
 * Pré-requisito: DATABASE_URL apontando para um banco de teste já migrado.
 */
let app: FastifyInstance;
let adminToken: string;
let adminCookie: string;
let adminId: string;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@grana.app';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'TrocaEssaSenha123';
const MONTH = currentMonthRef();

async function login(email: string, password: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  return response;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const response = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  expect(response.statusCode).toBe(200);
  const body = response.json();
  adminToken = body.accessToken;
  adminId = body.user.id;
  adminCookie = response.cookies.find((c) => c.name === 'grana_refresh_token')!.value;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const auth = (token = adminToken) => ({ authorization: `Bearer ${token}` });

describe('infraestrutura', () => {
  it('health check consulta o banco', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', database: 'up' });
  });
});

describe('autenticação', () => {
  it('rejeita senha errada com a mesma mensagem de e-mail inexistente', async () => {
    const wrongPassword = await login(ADMIN_EMAIL, 'SenhaErrada123');
    const unknownEmail = await login('ninguem@grana.app', 'SenhaErrada123');

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json().message).toBe(unknownEmail.json().message);
  });

  it('bloqueia rota protegida sem token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(response.statusCode).toBe(401);
  });

  it('devolve o perfil autenticado', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ email: ADMIN_EMAIL, role: 'ADMIN' });
  });

  it('rotaciona o refresh token e invalida o anterior', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { grana_refresh_token: adminCookie },
    });
    expect(first.statusCode).toBe(200);

    const rotated = first.cookies.find((c) => c.name === 'grana_refresh_token')!.value;
    expect(rotated).not.toBe(adminCookie);

    // Reusar o token antigo é sinal de roubo: a API derruba tudo.
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { grana_refresh_token: adminCookie },
    });
    expect(reuse.statusCode).toBe(401);

    // E o token que havia rotacionado também caiu junto.
    const after = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { grana_refresh_token: rotated },
    });
    expect(after.statusCode).toBe(401);

    // Refaz o login para os testes seguintes continuarem válidos.
    const relogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    adminToken = relogin.json().accessToken;
    adminCookie = relogin.cookies.find((c) => c.name === 'grana_refresh_token')!.value;
  });
});

describe('dashboard e relatórios', () => {
  it('calcula o resumo da competência', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/dashboard?month=${MONTH}`,
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.incomeCents).toBeGreaterThan(0);
    expect(body.billsTotalCents).toBeGreaterThan(0);
    // sobra = entradas − contas fixas − gastos variáveis
    expect(body.leftoverCents).toBe(
      body.incomeCents - body.billsTotalCents - body.variableSpentCents,
    );
    expect(body.weeks).toHaveLength(4);
    expect(body.upcomingBills.length).toBeGreaterThan(0);
  });

  it('monta o relatório por categoria somando contas fixas', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/reports/categories?month=${MONTH}`,
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.items.length).toBeGreaterThan(0);
    const soma = body.items.reduce((acc: number, item: { totalCents: number }) => acc + item.totalCents, 0);
    expect(soma).toBe(body.totalCents);
  });

  it('recusa competência em formato inválido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard?month=2026-13',
      headers: auth(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });
});

describe('lançamentos', () => {
  let categoryId: string;
  let transactionId: string;

  it('cria, lista, edita e apaga um lançamento', async () => {
    const categories = await app.inject({ method: 'GET', url: '/api/categories', headers: auth() });
    categoryId = categories
      .json()
      .find((category: { kind: string; name: string }) => category.kind === 'EXPENSE').id;

    const created = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(),
      payload: {
        type: 'EXPENSE',
        amountCents: 4599,
        categoryId,
        occurredOn: `${MONTH}-05`,
        note: 'teste automatizado',
      },
    });
    expect(created.statusCode).toBe(201);
    transactionId = created.json().id;
    expect(created.json().amountCents).toBe(4599);

    const list = await app.inject({
      method: 'GET',
      url: `/api/transactions?month=${MONTH}`,
      headers: auth(),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().groups.length).toBeGreaterThan(0);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/transactions/${transactionId}`,
      headers: auth(),
      payload: { amountCents: 5000 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().amountCents).toBe(5000);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/transactions/${transactionId}`,
      headers: auth(),
    });
    expect(removed.statusCode).toBe(204);
  });

  it('recusa valor não inteiro e categoria de tipo incompatível', async () => {
    const decimal = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(),
      payload: { type: 'EXPENSE', amountCents: 45.99, categoryId, occurredOn: `${MONTH}-05` },
    });
    expect(decimal.statusCode).toBe(400);

    const categories = await app.inject({ method: 'GET', url: '/api/categories', headers: auth() });
    const incomeCategory = categories
      .json()
      .find((category: { kind: string }) => category.kind === 'INCOME');

    const mismatched = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(),
      payload: {
        type: 'EXPENSE',
        amountCents: 1000,
        categoryId: incomeCategory.id,
        occurredOn: `${MONTH}-05`,
      },
    });
    expect(mismatched.statusCode).toBe(422);
  });
});

describe('contas fixas por competência', () => {
  it('marca como paga em um mês sem afetar o mês seguinte', async () => {
    const overview = await app.inject({
      method: 'GET',
      url: `/api/bills?month=${MONTH}`,
      headers: auth(),
    });
    const bill = overview.json().bills.find((item: { paid: boolean }) => !item.paid);

    const paid = await app.inject({
      method: 'PUT',
      url: `/api/bills/${bill.id}/payment`,
      headers: auth(),
      payload: { month: MONTH, paid: true },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().paid).toBe(true);

    const nextMonth = await app.inject({
      method: 'GET',
      url: `/api/bills?month=2030-01`,
      headers: auth(),
    });
    const sameBillNextMonth = nextMonth
      .json()
      .bills.find((item: { id: string }) => item.id === bill.id);
    expect(sameBillNextMonth.paid).toBe(false);

    // desfaz
    const unpaid = await app.inject({
      method: 'PUT',
      url: `/api/bills/${bill.id}/payment`,
      headers: auth(),
      payload: { month: MONTH, paid: false },
    });
    expect(unpaid.json().paid).toBe(false);
  });
});

describe('metas', () => {
  it('depósito soma no saldo e registra o extrato', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/goals',
      headers: auth(),
      payload: { name: 'Meta de teste', targetCents: 100000, savedCents: 0, featured: false },
    });
    expect(created.statusCode).toBe(201);
    const goalId = created.json().id;

    const deposited = await app.inject({
      method: 'POST',
      url: `/api/goals/${goalId}/deposits`,
      headers: auth(),
      payload: { amountCents: 25000 },
    });
    expect(deposited.statusCode).toBe(200);
    expect(deposited.json().savedCents).toBe(25000);
    expect(deposited.json().progressPercent).toBe(25);
    expect(deposited.json().deposits).toHaveLength(1);

    await app.inject({ method: 'DELETE', url: `/api/goals/${goalId}`, headers: auth() });
  });
});

describe('administração e isolamento entre usuários', () => {
  const email = `teste-${Date.now()}@grana.app`;
  let userId: string;
  let userToken: string;

  it('admin cria usuário com categorias padrão', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth(),
      payload: { name: 'Usuário Teste', email, password: 'SenhaForte123', role: 'USER' },
    });
    expect(created.statusCode).toBe(201);
    userId = created.json().id;

    const session = await login(email, 'SenhaForte123');
    expect(session.statusCode).toBe(200);
    userToken = session.json().accessToken;

    const categories = await app.inject({
      method: 'GET',
      url: '/api/categories',
      headers: auth(userToken),
    });
    expect(categories.json().length).toBeGreaterThan(5);
  });

  it('usuário comum não enxerga o dado financeiro do admin', async () => {
    const transactions = await app.inject({
      method: 'GET',
      url: `/api/transactions?month=${MONTH}`,
      headers: auth(userToken),
    });
    expect(transactions.json().total).toBe(0);

    const dashboard = await app.inject({
      method: 'GET',
      url: `/api/dashboard?month=${MONTH}`,
      headers: auth(userToken),
    });
    expect(dashboard.json().incomeCents).toBe(0);
  });

  it('usuário comum não acessa a área administrativa', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: auth(userToken),
    });
    expect(response.statusCode).toBe(403);
  });

  it('suspender derruba a sessão e impede novo login', async () => {
    const suspended = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${userId}`,
      headers: auth(),
      payload: { status: 'SUSPENDED' },
    });
    expect(suspended.statusCode).toBe(200);

    const blocked = await login(email, 'SenhaForte123');
    expect(blocked.statusCode).toBe(401);
  });

  it('admin não pode rebaixar nem excluir a própria conta', async () => {
    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${adminId}`,
      headers: auth(),
      payload: { role: 'USER' },
    });
    expect(demote.statusCode).toBe(403);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${adminId}`,
      headers: auth(),
    });
    expect(remove.statusCode).toBe(403);
  });

  it('e-mail duplicado devolve 409', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth(),
      payload: { name: 'Outro', email, password: 'SenhaForte123' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('senha fraca é recusada com mensagem em português', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth(),
      payload: { name: 'Fraco', email: `fraco-${Date.now()}@grana.app`, password: 'abc' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().details[0].message).toMatch(/caracteres/);
  });

  it('exclui o usuário de teste em cascata', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${userId}`,
      headers: auth(),
    });
    expect(response.statusCode).toBe(204);
    expect(await prisma.category.count({ where: { userId } })).toBe(0);
  });
});
