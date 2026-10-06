import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/shared/infra/database/prisma.js';
import { addMonths, currentMonthRef, daysInMonth } from '@grana/shared';

/**
 * Saldo futuro de ponta a ponta, com um usuário novo (carteira zerada) para o
 * resultado não depender dos dados de exemplo do seed.
 *
 * "Hoje" é enviado como o último dia do mês corrente: assim uma conta que vence
 * no dia 1 está sempre atrasada, não importa em que dia o teste rode.
 */
let app: FastifyInstance;
let adminToken: string;
let userToken: string;
let userId: string;
let expenseCategoryId: string;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@grana.app';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'TrocaEssaSenha123';
const MONTH = currentMonthRef();
const FIRST = `${MONTH}-01`;
const LAST = `${MONTH}-${String(daysInMonth(MONTH)).padStart(2, '0')}`;
const FAR = `${addMonths(MONTH, 4)}-28`;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function login(email: string, password: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
}

async function cashflow(query = `from=${FIRST}&to=${LAST}&today=${LAST}`) {
  const response = await app.inject({
    method: 'GET',
    url: `/api/cashflow?${query}`,
    headers: auth(userToken),
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  adminToken = (await login(ADMIN_EMAIL, ADMIN_PASSWORD)).json().accessToken;

  const email = `saldo-${Date.now()}@grana.app`;
  const created = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: auth(adminToken),
    payload: { name: 'Saldo Futuro', email, password: 'SenhaForte123', role: 'USER' },
  });
  userId = created.json().id;
  userToken = (await login(email, 'SenhaForte123')).json().accessToken;

  const categories = await app.inject({
    method: 'GET',
    url: '/api/categories',
    headers: auth(userToken),
  });
  expenseCategoryId = categories
    .json()
    .find((category: { kind: string }) => category.kind === 'EXPENSE').id;
});

afterAll(async () => {
  await app.inject({
    method: 'DELETE',
    url: `/api/admin/users/${userId}`,
    headers: auth(adminToken),
  });
  await app.close();
  await prisma.$disconnect();
});

describe('saldo futuro', () => {
  let billId: string;

  it('fica desligado até o usuário informar o saldo inicial', async () => {
    const body = await cashflow();
    expect(body.configured).toBe(false);
    expect(body.days).toHaveLength(0);
  });

  it('recusa data de saldo inicial no futuro', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: auth(userToken),
      payload: { openingBalanceCents: 1000, openingDate: '2099-01-01' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('parte do saldo inicial', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: auth(userToken),
      payload: { openingBalanceCents: 500_000, openingDate: FIRST, dailyBudgetCents: 0 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ openingBalanceCents: 500_000, openingDate: FIRST });

    const body = await cashflow();
    expect(body.configured).toBe(true);
    expect(body.todayBalanceCents).toBe(500_000);
    expect(body.days[0].date).toBe(FIRST);
  });

  it('conta vencida e não paga acumula como atrasada', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/bills',
      headers: auth(userToken),
      payload: { name: 'Aluguel', categoryId: expenseCategoryId, amountCents: 100_000, dueDay: 1 },
    });
    expect(created.statusCode).toBe(201);
    billId = created.json().id;

    const body = await cashflow();
    expect(body.overdueBills).toHaveLength(1);
    expect(body.overdueBills[0]).toMatchObject({ billId, month: MONTH, amountCents: 100_000 });
    expect(body.todayBalanceCents).toBe(500_000);
    expect(body.endOfMonthCents).toBe(400_000);

    const overdue = await app.inject({
      method: 'GET',
      url: `/api/bills/overdue?today=${LAST}`,
      headers: auth(userToken),
    });
    expect(overdue.json()).toHaveLength(1);
  });

  it('pagar com juros tira do atraso e debita o valor pago', async () => {
    const paid = await app.inject({
      method: 'PUT',
      url: `/api/bills/${billId}/payment`,
      headers: auth(userToken),
      payload: { month: MONTH, paid: true, amountCents: 110_000 },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({ paid: true, waived: false });

    const body = await cashflow();
    expect(body.overdueBills).toHaveLength(0);
    expect(body.todayBalanceCents).toBe(390_000);
  });

  it('"não vou pagar" dispensa a competência sem mexer no saldo', async () => {
    const waived = await app.inject({
      method: 'PUT',
      url: `/api/bills/${billId}/payment`,
      headers: auth(userToken),
      payload: { month: MONTH, paid: false, waived: true },
    });
    expect(waived.json()).toMatchObject({ paid: false, waived: true });

    const body = await cashflow();
    expect(body.overdueBills).toHaveLength(0);
    expect(body.endOfMonthCents).toBe(500_000);

    const overview = await app.inject({
      method: 'GET',
      url: `/api/bills?month=${MONTH}`,
      headers: auth(userToken),
    });
    expect(overview.json().dueCents).toBe(0);
  });

  it('dinheiro guardado em meta sai do saldo', async () => {
    const goal = await app.inject({
      method: 'POST',
      url: '/api/goals',
      headers: auth(userToken),
      payload: { name: 'Reserva', targetCents: 100_000, savedCents: 0, featured: false },
    });
    await app.inject({
      method: 'POST',
      url: `/api/goals/${goal.json().id}/deposits`,
      headers: auth(userToken),
      payload: { amountCents: 10_000 },
    });

    const body = await cashflow();
    expect(body.todayBalanceCents).toBe(490_000);
    expect(body.months[0].savedCents).toBe(10_000);
  });
});

describe('cartões', () => {
  let cardId: string;

  it('compra parcelada vira faturas futuras no saldo', async () => {
    const card = await app.inject({
      method: 'POST',
      url: '/api/cards',
      headers: auth(userToken),
      payload: { name: 'Cartão teste', closingDay: 3, dueDay: 10, limitCents: 500_000 },
    });
    expect(card.statusCode).toBe(201);
    cardId = card.json().id;

    const purchase = await app.inject({
      method: 'POST',
      url: `/api/cards/${cardId}/purchases`,
      headers: auth(userToken),
      payload: {
        amountCents: 30_000,
        installments: 3,
        purchasedOn: LAST,
        categoryId: expenseCategoryId,
        note: 'Geladeira',
      },
    });
    expect(purchase.statusCode).toBe(201);

    const cards = await app.inject({
      method: 'GET',
      url: `/api/cards?today=${LAST}`,
      headers: auth(userToken),
    });
    const [listed] = cards.json();
    expect(listed.usedLimitCents).toBe(30_000);
    expect(
      listed.invoices.reduce((sum: number, i: { totalCents: number }) => sum + i.totalCents, 0),
    ).toBe(30_000);

    const body = await cashflow(`from=${FIRST}&to=${FAR}&today=${LAST}`);
    const invoiceEvents = body.days
      .flatMap((day: { events: Array<{ kind: string; amountCents: number }> }) => day.events)
      .filter((event: { kind: string }) => event.kind === 'CARD_INVOICE');
    expect(invoiceEvents).toHaveLength(3);
    expect(
      invoiceEvents.every((event: { amountCents: number }) => event.amountCents === -10_000),
    ).toBe(true);

    const invoice = await app.inject({
      method: 'GET',
      url: `/api/cards/${cardId}/invoice?month=${addMonths(MONTH, 1)}`,
      headers: auth(userToken),
    });
    expect(invoice.json().items[0]).toMatchObject({ label: 'Geladeira', installmentNumber: 1 });
  });

  it('categoria com compra no cartão não pode ser excluída', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/categories/${expenseCategoryId}`,
      headers: auth(userToken),
    });
    expect(response.statusCode).not.toBe(204);
  });

  it('posso comprar? avisa quando o saldo fica negativo', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/cashflow/simulate',
      headers: auth(userToken),
      payload: {
        from: FIRST,
        to: FAR,
        today: LAST,
        amountCents: 10_000_000,
        installments: 1,
        date: LAST,
        method: 'ACCOUNT',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().fits).toBe(false);
    expect(response.json().verdict).toMatch(/negativo/);

    const onCard = await app.inject({
      method: 'POST',
      url: '/api/cashflow/simulate',
      headers: auth(userToken),
      payload: {
        from: FIRST,
        to: FAR,
        today: LAST,
        amountCents: 1_000,
        installments: 2,
        date: LAST,
        method: 'CARD',
        cardId,
      },
    });
    expect(onCard.json().fits).toBe(true);
  });
});

describe('dívidas viram contas com prazo', () => {
  it('converte o que falta em conta fixa', async () => {
    const debt = await app.inject({
      method: 'POST',
      url: '/api/debts',
      headers: auth(userToken),
      payload: {
        name: 'Celular',
        installmentCents: 5_000,
        totalInstallments: 3,
        paidInstallments: 1,
      },
    });

    const converted = await app.inject({
      method: 'POST',
      url: `/api/debts/${debt.json().id}/convert`,
      headers: auth(userToken),
      payload: { categoryId: expenseCategoryId, dueDay: 28 },
    });
    expect(converted.statusCode).toBe(201);
    expect(converted.json()).toMatchObject({
      name: 'Celular',
      totalInstallments: 2,
      amountCents: 5_000,
    });

    const debts = await app.inject({ method: 'GET', url: '/api/debts', headers: auth(userToken) });
    expect(debts.json().debts).toHaveLength(0);
  });
});
