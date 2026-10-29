import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../src/db.js';
import { addDays, addMonths, currentMonth, todayUTC } from '../src/dates.js';
import { env } from '../src/env.js';
import { client, type Client } from '../src/http.js';
import { categoryId, freshWorld, newUser, type Actor } from '../src/world.js';

/**
 * Comparação do M7 (só leitura): saldo futuro e "Posso comprar?" calculados pelos dois
 * backends sobre o MESMO dado, em várias combinações de intervalo e de `today`.
 * Precisa de PARITY_NODE_URL e PARITY_DOTNET_URL; sem elas, o arquivo é pulado.
 */
const enabled = Boolean(env.nodeUrl && env.dotnetUrl);
const MONTH = currentMonth();

describe.skipIf(!enabled)('M7 cruzado: saldo futuro Node × .NET', () => {
  let admin: Actor;

  beforeAll(async () => {
    ({ admin } = await freshWorld());
  });

  afterAll(() => pool.end());

  async function expectSame(node: Client, dotnet: Client, method: 'get' | 'post', path: string, body?: unknown) {
    const [fromNode, fromDotnet] = await Promise.all([
      method === 'get' ? node.get(path) : node.post(path, body),
      method === 'get' ? dotnet.get(path) : dotnet.post(path, body),
    ]);
    expect(fromDotnet.status, `${path} ${JSON.stringify(body ?? '')}`).toBe(fromNode.status);
    const scrub = (value: any) => (value && typeof value === 'object' && 'requestId' in value ? { ...value, requestId: 'x' } : value);
    expect(scrub(fromDotnet.body), `${path} ${JSON.stringify(body ?? '')}`).toEqual(scrub(fromNode.body));
    return fromNode;
  }

  it('sem saldo inicial: configured false e simulação recusada, iguais', async () => {
    const user = await newUser(admin);
    const node = client(user.token, env.nodeUrl);
    const dotnet = client(user.token, env.dotnetUrl);
    const today = todayUTC();
    await expectSame(node, dotnet, 'get', `/api/cashflow?from=${today}&to=${addDays(today, 30)}`);
    await expectSame(node, dotnet, 'post', '/api/cashflow/simulate', { from: today, to: addDays(today, 30), amountCents: 100, date: today, method: 'ACCOUNT' });
  });

  it('cenário completo: mesmos dias, eventos, meses, atrasadas e vereditos', async () => {
    const user = await newUser(admin);
    const node = client(user.token, env.nodeUrl);
    const dotnet = client(user.token, env.dotnetUrl);
    const market = await categoryId(user, 'Mercado');
    const house = await categoryId(user, 'Casa');
    const salary = await categoryId(user, 'Salário', 'INCOME');
    const today = todayUTC();
    const opening = `${addMonths(MONTH, -2)}-10`;

    await node.patch('/api/settings', { openingBalanceCents: 250000, openingDate: opening });
    await node.post('/api/incomes', { name: 'Salário', amountCents: 520000, receiptDay: 5 });
    await node.post('/api/incomes', { name: 'Aluguel recebido', amountCents: 90000, receiptDay: 31 });

    const tx = (type: string, amountCents: number, categoryId: string, occurredOn: string, note?: string) =>
      node.post('/api/transactions', { type, amountCents, categoryId, occurredOn, ...(note !== undefined ? { note } : {}) });
    await tx('EXPENSE', 30000, market, addDays(opening, -3), 'antes do saldo inicial');
    await tx('EXPENSE', 12345, market, addDays(opening, 2));
    await tx('EXPENSE', 999, market, addDays(today, -1), '   ');
    await tx('INCOME', 15000, salary, today, 'Pix');
    await tx('EXPENSE', 50000, market, addDays(today, 12), 'Agendado');

    const bill = async (name: string, amountCents: number, dueDay: number, totalInstallments?: number) => {
      const created = await node.post('/api/bills', { name, categoryId: house, amountCents, dueDay, ...(totalInstallments ? { totalInstallments } : {}) });
      await sql('UPDATE "bills" SET "startMonth"=$1 WHERE id=$2', [`${addMonths(MONTH, -3)}-01`, created.body.id]);
      return created.body.id as string;
    };
    const rent = await bill('Aluguel', 150000, 5);
    const power = await bill('Luz', 18000, 28, 6);
    const water = await bill('Água', 7000, 1);
    await bill('Internet', 9990, 15);
    await node.put(`/api/bills/${rent}/payment`, { month: addMonths(MONTH, -1), paid: true, amountCents: 151500 });
    await node.put(`/api/bills/${power}/payment`, { month: addMonths(MONTH, -1), paid: false, waived: true });
    await node.put(`/api/bills/${water}/payment`, { month: addMonths(MONTH, -2), paid: true });

    const card = await node.post('/api/cards', { name: 'Visa', closingDay: 3, dueDay: 10 });
    await node.post(`/api/cards/${card.body.id}/purchases`, { amountCents: 60001, installments: 6, purchasedOn: `${addMonths(MONTH, -1)}-20`, categoryId: market });
    await node.post(`/api/cards/${card.body.id}/purchases`, { amountCents: 4590, purchasedOn: today, categoryId: market });

    const goal = await node.post('/api/goals', { name: 'Viagem', targetCents: 100000 });
    await node.post(`/api/goals/${goal.body.id}/deposits`, { amountCents: 2500 });

    const ranges: Array<[string, string, string?]> = [
      [today, addDays(today, 90)],
      [addDays(today, -30), addDays(today, 30)],
      [opening, addDays(opening, 400)],
      [today, addDays(today, 30), addDays(today, 5)],
      [today, addDays(today, 30), `${MONTH}-01`],
      ['2026-02-31', '2026-03-31', '2026-02-31'],
      [addDays(opening, -10), addDays(opening, 5), addDays(opening, -1)],
    ];
    for (const [from, to, day] of ranges) {
      await expectSame(node, dotnet, 'get', `/api/cashflow?from=${from}&to=${to}${day ? `&today=${day}` : ''}`);
    }

    // Média diária pelo histórico e por valor fixo.
    await node.patch('/api/settings', { dailyBudgetCents: 4321 });
    await expectSame(node, dotnet, 'get', `/api/cashflow?from=${today}&to=${addDays(today, 60)}`);
    await node.patch('/api/settings', { dailyBudgetCents: null });

    const simulations = [
      { amountCents: 100000, date: today, method: 'ACCOUNT' },
      { amountCents: 100001, installments: 3, date: `${MONTH}-31`, method: 'ACCOUNT' },
      { amountCents: 9_000_000_000, date: today, method: 'ACCOUNT' },
      { amountCents: 2_000_000, installments: 10, date: today, method: 'CARD', cardId: card.body.id },
      { amountCents: 500, date: '2026-02-31', method: 'CARD', cardId: card.body.id },
      { amountCents: 500, date: today, method: 'CARD', cardId: '00000000-0000-4000-8000-000000000000' },
      { amountCents: 500, date: today, method: 'CARD' },
    ];
    for (const simulation of simulations) {
      await expectSame(node, dotnet, 'post', '/api/cashflow/simulate', { from: today, to: addDays(today, 120), ...simulation });
    }
  });
});
