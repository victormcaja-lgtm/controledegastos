import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../src/db.js';
import { addDays, addMonths, currentMonth, todayUTC } from '../src/dates.js';
import { env } from '../src/env.js';
import { client, type Client } from '../src/http.js';
import { categoryId, freshWorld, newUser, type Actor } from '../src/world.js';

/**
 * Testes cruzados do M5 (T-053, plano.md §7.2): cartões e compras gravados por um
 * backend e lidos pelo outro — listagem com faturas e limite, detalhe da fatura.
 * Precisam de PARITY_NODE_URL e PARITY_DOTNET_URL; sem elas, o arquivo é pulado.
 */
const enabled = Boolean(env.nodeUrl && env.dotnetUrl);
const MONTH = currentMonth();

describe.skipIf(!enabled)('M5 cruzado: cartões Node × .NET no mesmo banco', () => {
  let admin: Actor;

  beforeAll(async () => {
    ({ admin } = await freshWorld());
  });

  afterAll(() => pool.end());

  async function sides() {
    const user = await newUser(admin);
    return {
      user,
      node: client(user.token, env.nodeUrl) as Client,
      dotnet: client(user.token, env.dotnetUrl) as Client,
      market: await categoryId(user, 'Mercado'),
      leisure: await categoryId(user, 'Lazer'),
    };
  }

  async function expectSame(s: { node: Client; dotnet: Client }, path: string) {
    const [fromNode, fromDotnet] = await Promise.all([s.node.get(path), s.dotnet.get(path)]);
    expect(fromNode.status, path).toBe(fromDotnet.status);
    expect(fromDotnet.body, path).toEqual(fromNode.body);
    return fromNode.body;
  }

  it('listagem, faturas e detalhe iguais com cartões e compras dos dois lados', async () => {
    const s = await sides();
    const visa = await s.node.post('/api/cards', { name: 'Visa', closingDay: 31, dueDay: 10, limitCents: 500000 });
    const master = await s.dotnet.post('/api/cards', { name: 'Master', closingDay: 5, dueDay: 15 });
    expect(master.status).toBe(201);

    const today = todayUTC();
    const purchases: Array<[Client, string, Record<string, unknown>]> = [
      [s.dotnet, visa.body.id, { amountCents: 100001, installments: 3, purchasedOn: addDays(today, -40), categoryId: s.market, note: '  Geladeira ' }],
      [s.node, visa.body.id, { amountCents: 4590, purchasedOn: today, categoryId: s.leisure }],
      [s.dotnet, visa.body.id, { amountCents: 12000, installments: 12, purchasedOn: '2026-02-31', categoryId: s.market, note: '   ' }],
      [s.node, master.body.id, { amountCents: 777, installments: 2, purchasedOn: `${MONTH}-05`, categoryId: s.market }],
      [s.dotnet, master.body.id, { amountCents: 999, purchasedOn: `${MONTH}-04`, categoryId: s.leisure }],
    ];
    for (const [side, card, body] of purchases) expect((await side.post(`/api/cards/${card}/purchases`, body)).status).toBe(201);
    await s.dotnet.patch(`/api/cards/${master.body.id}`, { active: false, limitCents: 1000 });

    for (const query of ['', `?today=${today}`, `?today=${addDays(today, 45)}`, '?today=2026-02-31', `?today=${MONTH}-05`]) {
      await expectSame(s, `/api/cards${query}`);
    }
    for (const card of [visa.body.id, master.body.id]) {
      for (const month of [undefined, addMonths(MONTH, -1), MONTH, addMonths(MONTH, 1), addMonths(MONTH, 3), '2026-03']) {
        await expectSame(s, `/api/cards/${card}/invoice${month ? `?month=${month}` : ''}`);
      }
    }
  });

  it('exclusões cruzadas: compra e cartão (com as compras em cascata)', async () => {
    const s = await sides();
    const card = await s.dotnet.post('/api/cards', { name: 'Elo', closingDay: 1, dueDay: 8 });
    const purchase = await s.node.post(`/api/cards/${card.body.id}/purchases`, { amountCents: 100, purchasedOn: todayUTC(), categoryId: s.market });
    expect((await s.dotnet.delete(`/api/card-purchases/${purchase.body.id}`)).status).toBe(204);
    expect((await s.node.delete(`/api/card-purchases/${purchase.body.id}`)).status).toBe(404);

    await s.dotnet.post(`/api/cards/${card.body.id}/purchases`, { amountCents: 100, purchasedOn: todayUTC(), categoryId: s.market });
    expect((await s.node.delete(`/api/cards/${card.body.id}`)).status).toBe(204);
    expect((await sql('SELECT 1 FROM "card_purchases" WHERE "cardId"=$1', [card.body.id])).length).toBe(0);
    expect((await s.dotnet.get(`/api/cards/${card.body.id}/invoice`)).status).toBe(404);
  });

  it('a mesma operação grava a mesma linha pelos dois lados (plano.md §7.3)', async () => {
    const [a, b] = [await sides(), await sides()];
    const cardA = await a.node.post('/api/cards', { name: 'Visa', closingDay: 20, dueDay: 2, limitCents: 300000 });
    const cardB = await b.dotnet.post('/api/cards', { name: 'Visa', closingDay: 20, dueDay: 2, limitCents: 300000 });
    const buyA = await a.node.post(`/api/cards/${cardA.body.id}/purchases`, { amountCents: 2999, installments: 4, purchasedOn: '2026-02-31', categoryId: a.market, note: '  ' });
    const buyB = await b.dotnet.post(`/api/cards/${cardB.body.id}/purchases`, { amountCents: 2999, installments: 4, purchasedOn: '2026-02-31', categoryId: b.market, note: '  ' });
    expect(buyB.body).toEqual({ ...buyA.body, id: buyB.body.id, cardId: cardB.body.id, category: { ...buyA.body.category, id: b.market } });

    const shape = async (table: string, id: string) => {
      const [row] = await sql<Record<string, unknown>>(`SELECT * FROM "${table}" WHERE id=$1`, [id]);
      const { id: rowId, userId: _user, cardId: _card, categoryId: _category, createdAt, updatedAt, purchasedOn, ...rest } = row!;
      expect(rowId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      for (const instant of [createdAt, updatedAt].filter(Boolean)) expect(Math.abs((instant as Date).getTime() - Date.now())).toBeLessThan(60_000);
      return { ...rest, ...(purchasedOn ? { purchasedOn: String(purchasedOn) } : {}) };
    };
    expect(await shape('cards', cardB.body.id)).toEqual(await shape('cards', cardA.body.id));
    expect(await shape('card_purchases', buyB.body.id)).toEqual(await shape('card_purchases', buyA.body.id));
  });
});
