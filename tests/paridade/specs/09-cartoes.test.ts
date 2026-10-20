import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../src/db.js';
import { addMonths, dayOf, todayUTC } from '../src/dates.js';
import { categoryId, freshWorld, newUser, type Actor } from '../src/world.js';

/** Cartões e faturas — analise.md §4.9 (RN-130 a RN-137). */
let admin: Actor;

beforeAll(async () => {
  ({ admin } = await freshWorld());
});

afterAll(() => pool.end());

async function setup() {
  const user = await newUser(admin);
  const clothes = await categoryId(user, 'Roupa');
  const createCard = async (body: Record<string, unknown>) => {
    const response = await user.api.post('/api/cards', body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as any;
  };
  const buy = async (cardId: string, body: Record<string, unknown>) => {
    const response = await user.api.post(`/api/cards/${cardId}/purchases`, { categoryId: clothes, ...body });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as any;
  };
  return { user, clothes, createCard, buy };
}

/** Fatura que receberia uma compra feita em `date`. */
function invoiceMonthFor(closingDay: number, date: string) {
  const month = date.slice(0, 7);
  return date < dayOf(month, closingDay) ? month : addMonths(month, 1);
}

describe('cadastro (RN-130)', () => {
  it('criar responde com limite usado zero e a fatura aberta (pela data UTC do servidor)', async () => {
    const { createCard } = await setup();
    const card = await createCard({ name: 'Nubank', closingDay: 3, dueDay: 10, limitCents: 500000 });
    const open = invoiceMonthFor(3, todayUTC());
    expect(card).toEqual({
      id: expect.any(String),
      name: 'Nubank',
      closingDay: 3,
      dueDay: 10,
      limitCents: 500000,
      active: true,
      usedLimitCents: 0,
      invoices: [{ month: open, closingDate: dayOf(open, 3), dueDate: dayOf(open, 10), totalCents: 0, status: 'OPEN' }],
    });
  });

  it('lista: ativos primeiro, depois por criação; inativo continua aparecendo', async () => {
    const { user, createCard } = await setup();
    const first = await createCard({ name: 'Primeiro', closingDay: 1, dueDay: 8 });
    await createCard({ name: 'Segundo', closingDay: 1, dueDay: 8 });
    await user.api.patch(`/api/cards/${first.id}`, { active: false, limitCents: null });
    const list = await user.api.get('/api/cards');
    expect(list.body.map((c: any) => [c.name, c.active, c.limitCents])).toEqual([
      ['Segundo', true, null],
      ['Primeiro', false, null],
    ]);
  });
});

describe('faturas (RN-131 a RN-135)', () => {
  it('fechamento, vencimento, parcelas (resto na 1ª), status e limite usado', async () => {
    const { user, createCard, buy } = await setup();
    const card = await createCard({ name: 'Visa', closingDay: 3, dueDay: 10, limitCents: 100000 });
    // Antes do fechamento → fatura do mesmo mês.
    await buy(card.id, { amountCents: 5000, purchasedOn: '2025-06-02', note: 'Camiseta' });
    // No dia do fechamento → fatura seguinte.
    await buy(card.id, { amountCents: 7000, purchasedOn: '2025-06-03' });
    // 3x de 300,01: 100,01 + 100,00 + 100,00.
    await buy(card.id, { amountCents: 30001, installments: 3, purchasedOn: '2025-06-20', note: 'Tênis' });

    const list = await user.api.get('/api/cards?today=2025-06-15');
    const visa = list.body.find((c: any) => c.id === card.id);
    expect(visa.invoices).toEqual([
      { month: '2025-07', closingDate: '2025-07-03', dueDate: '2025-07-10', totalCents: 17001, status: 'OPEN' },
      { month: '2025-08', closingDate: '2025-08-03', dueDate: '2025-08-10', totalCents: 10000, status: 'FUTURE' },
      { month: '2025-09', closingDate: '2025-09-03', dueDate: '2025-09-10', totalCents: 10000, status: 'FUTURE' },
    ]);
    // A fatura de junho já venceu (PAST) e não conta no limite usado.
    expect(visa.usedLimitCents).toBe(37001);

    const closed = await user.api.get('/api/cards?today=2025-07-05');
    expect(closed.body.find((c: any) => c.id === card.id).invoices[0]).toMatchObject({ month: '2025-07', status: 'CLOSED' });

    const june = await user.api.get(`/api/cards/${card.id}/invoice?month=2025-06`);
    expect(june.body).toMatchObject({ month: '2025-06', totalCents: 5000, cardName: 'Visa', cardId: card.id });
    expect(june.body.status).toBe('PAST'); // pelo relógio do servidor, junho/2025 já venceu
    expect(june.body.items).toEqual([
      {
        purchaseId: expect.any(String),
        label: 'Camiseta',
        category: { id: expect.any(String), name: 'Roupa', color: 'oklch(0.62 0.10 20)', kind: 'EXPENSE' },
        purchasedOn: '2025-06-02',
        installmentNumber: 1,
        installments: 1,
        amountCents: 5000,
      },
    ]);

    const july = await user.api.get(`/api/cards/${card.id}/invoice?month=2025-07`);
    // Sem observação, o rótulo é o nome da categoria.
    expect(july.body.items.map((i: any) => [i.label, i.installmentNumber, i.installments, i.amountCents])).toEqual([
      ['Tênis', 1, 3, 10001],
      ['Roupa', 1, 1, 7000],
    ]);
  });

  it('vencimento antes do fechamento cai no mês seguinte; dia 31 é limitado ao fim do mês', async () => {
    const { user, createCard, buy } = await setup();
    const card = await createCard({ name: 'Virada', closingDay: 25, dueDay: 5 });
    await buy(card.id, { amountCents: 100, purchasedOn: '2025-01-10' });
    const january = await user.api.get(`/api/cards/${card.id}/invoice?month=2025-01`);
    expect(january.body).toMatchObject({ closingDate: '2025-01-25', dueDate: '2025-02-05', totalCents: 100 });

    const end = await createCard({ name: 'Fim', closingDay: 31, dueDay: 31 });
    const february = await user.api.get(`/api/cards/${end.id}/invoice?month=2025-02`);
    // dueDay não é maior que closingDay → vence no mês seguinte.
    expect(february.body).toMatchObject({ closingDate: '2025-02-28', dueDate: '2025-03-31', totalCents: 0, items: [] });
  });

  it('mostra no máximo 4 faturas a partir da aberta', async () => {
    const { user, createCard, buy } = await setup();
    const card = await createCard({ name: 'Longo', closingDay: 3, dueDay: 10 });
    await buy(card.id, { amountCents: 60000, installments: 6, purchasedOn: '2025-06-20' });
    const list = await user.api.get('/api/cards?today=2025-06-15');
    const invoices = list.body.find((c: any) => c.id === card.id).invoices;
    expect(invoices.map((i: any) => [i.month, i.totalCents])).toEqual([
      ['2025-07', 10000],
      ['2025-08', 10000],
      ['2025-09', 10000],
      ['2025-10', 10000],
    ]);
  });

  it('sem ?month a fatura detalhada é a aberta hoje (UTC)', async () => {
    const { user, createCard } = await setup();
    const card = await createCard({ name: 'Padrão', closingDay: 15, dueDay: 25 });
    const response = await user.api.get(`/api/cards/${card.id}/invoice`);
    expect(response.body).toMatchObject({ month: invoiceMonthFor(15, todayUTC()), status: 'OPEN', items: [] });
  });
});

describe('compras (RN-133)', () => {
  it('formato, observação vazia vira null, data futura ok, categoria de entrada recusada', async () => {
    const { user, createCard, buy } = await setup();
    const card = await createCard({ name: 'Compras', closingDay: 3, dueDay: 10 });
    const purchase = await buy(card.id, { amountCents: 1234, purchasedOn: '2030-01-01', note: '   ' });
    expect(purchase).toEqual({
      id: expect.any(String),
      cardId: card.id,
      amountCents: 1234,
      installments: 1,
      purchasedOn: '2030-01-01',
      note: null,
      category: { id: expect.any(String), name: 'Roupa', color: 'oklch(0.62 0.10 20)', kind: 'EXPENSE' },
    });

    const salary = await categoryId(user, 'Salário', 'INCOME');
    const wrong = await user.api.post(`/api/cards/${card.id}/purchases`, {
      amountCents: 100, purchasedOn: '2025-01-01', categoryId: salary,
    });
    expect(wrong.status).toBe(422);
    expect(wrong.body.message).toBe('Compra no cartão precisa de uma categoria de despesa.');

    const tooMany = await user.api.post(`/api/cards/${card.id}/purchases`, {
      amountCents: 100, installments: 49, purchasedOn: '2025-01-01', categoryId: salary,
    });
    expect(tooMany.status).toBe(400);
  });

  it('sem checagem de limite: compra acima do limite é aceita', async () => {
    const { createCard, buy } = await setup();
    const card = await createCard({ name: 'Baixo', closingDay: 3, dueDay: 10, limitCents: 1000 });
    await buy(card.id, { amountCents: 999999, purchasedOn: todayUTC() });
  });

  it('apagar compra e apagar cartão (leva as compras junto)', async () => {
    const { user, createCard, buy } = await setup();
    const card = await createCard({ name: 'Some', closingDay: 3, dueDay: 10 });
    const first = await buy(card.id, { amountCents: 100, purchasedOn: '2025-01-01' });
    await buy(card.id, { amountCents: 100, purchasedOn: '2025-01-02' });
    expect((await user.api.delete(`/api/card-purchases/${first.id}`)).status).toBe(204);
    expect((await user.api.delete(`/api/card-purchases/${first.id}`)).body.message).toBe('Compra não encontrado.');
    expect((await user.api.delete(`/api/cards/${card.id}`)).status).toBe(204);
    expect((await sql('SELECT 1 FROM "card_purchases" WHERE "cardId"=$1', [card.id])).length).toBe(0);
  });
});
