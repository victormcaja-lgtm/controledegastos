import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../src/db.js';
import { addDays, todayUTC } from '../src/dates.js';
import { env } from '../src/env.js';
import { client, type Client } from '../src/http.js';
import { categoryId, freshWorld, newUser, type Actor } from '../src/world.js';

/**
 * Testes cruzados do M2 (T-023, plano.md §7.2 e §7.3): lançamentos gravados por um
 * backend e lidos pelo outro. Precisam de PARITY_NODE_URL e PARITY_DOTNET_URL (a
 * fachada com `Transactions` em `dotnet`); sem elas, o arquivo é pulado.
 */
const enabled = Boolean(env.nodeUrl && env.dotnetUrl);

describe.skipIf(!enabled)('M2 cruzado: lançamentos Node × .NET no mesmo banco', () => {
  let admin: Actor;

  beforeAll(async () => {
    ({ admin } = await freshWorld());
  });

  afterAll(() => pool.end());

  async function sides() {
    const user = await newUser(admin);
    const node: Client = client(user.token, env.nodeUrl);
    const dotnet: Client = client(user.token, env.dotnetUrl);
    return { user, node, dotnet, market: await categoryId(user, 'Mercado'), salary: await categoryId(user, 'Salário', 'INCOME') };
  }

  it('lançamentos gravados pelos dois lados saem iguais pelos dois, com grupos, paginação e resumo', async () => {
    const s = await sides();
    const today = todayUTC();
    const add = (side: Client, type: string, amountCents: number, categoryId: string, occurredOn: string, note?: string) =>
      side.post('/api/transactions', { type, amountCents, categoryId, occurredOn, ...(note !== undefined ? { note } : {}) });

    await add(s.node, 'EXPENSE', 1000, s.market, '2025-03-05', 'Feira da Semana');
    await add(s.dotnet, 'EXPENSE', 2000, s.market, '2025-03-05', 'cinema');
    await add(s.node, 'INCOME', 500000, s.salary, '2025-03-05');
    await add(s.dotnet, 'EXPENSE', 3000, s.market, '2025-03-20', '   ');
    await add(s.dotnet, 'EXPENSE', 1, s.market, today);
    await add(s.node, 'EXPENSE', 1, s.market, addDays(today, -1));

    for (const query of [
      '',
      '?month=2025-03',
      '?month=2025-03&perPage=2',
      '?month=2025-03&perPage=2&page=2',
      '?type=INCOME',
      `?categoryId=${s.market}`,
      '?search=FEIRA',
      '?search=',
      '?search=%25',
      '?page=99',
    ]) {
      const [fromNode, fromDotnet] = await Promise.all([s.node.get(`/api/transactions${query}`), s.dotnet.get(`/api/transactions${query}`)]);
      expect(fromNode.status, query).toBe(200);
      expect(fromDotnet.body, query).toEqual(fromNode.body);
    }
  });

  it('edição e exclusão cruzadas', async () => {
    const s = await sides();
    const created = await s.dotnet.post('/api/transactions', { type: 'EXPENSE', amountCents: 100, categoryId: s.market, occurredOn: todayUTC(), note: 'antes' });
    expect(created.status).toBe(201);

    const leisure = await categoryId(s.user, 'Lazer');
    const edited = await s.node.patch(`/api/transactions/${created.body.id}`, { categoryId: leisure, amountCents: 999, occurredOn: '2026-02-31' });
    expect(edited.body).toMatchObject({ amountCents: 999, occurredOn: '2026-03-03', category: { id: leisure } });

    const cleared = await s.dotnet.patch(`/api/transactions/${created.body.id}`, { note: null });
    expect(cleared.body).toEqual({ ...edited.body, note: null });
    expect((await s.node.get('/api/transactions')).body.items).toContainEqual(cleared.body);

    expect((await s.node.delete(`/api/transactions/${created.body.id}`)).status).toBe(204);
    expect((await s.dotnet.delete(`/api/transactions/${created.body.id}`)).status).toBe(404);
  });

  it('a mesma operação grava a mesma linha pelos dois lados (plano.md §7.3)', async () => {
    const [a, b] = [await sides(), await sides()];
    const body = (s: { market: string }) => ({ type: 'EXPENSE', amountCents: 4321, categoryId: s.market, occurredOn: '2026-02-31', note: '  ' });
    const viaNode = await a.node.post('/api/transactions', body(a));
    const viaDotnet = await b.dotnet.post('/api/transactions', body(b));

    const shape = async (id: string) => {
      const [row] = await sql<Record<string, unknown>>('SELECT * FROM "transactions" WHERE id=$1', [id]);
      const { id: rowId, userId, categoryId: _category, createdAt, updatedAt, occurredOn, ...rest } = row!;
      expect(rowId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(typeof userId).toBe('string');
      for (const instant of [createdAt, updatedAt]) expect(Math.abs((instant as Date).getTime() - Date.now())).toBeLessThan(60_000);
      return { ...rest, occurredOn: String(occurredOn) };
    };
    expect(await shape(viaDotnet.body.id)).toEqual(await shape(viaNode.body.id));
    expect(viaDotnet.body.note).toBe('');
  });
});
