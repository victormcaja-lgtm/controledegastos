import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../src/db.js';
import { env } from '../src/env.js';
import { client, type Client } from '../src/http.js';
import { categoryId, freshWorld, newUser, type Actor } from '../src/world.js';

/**
 * Testes cruzados do M3 (T-033, plano.md §7.2): dívidas e metas gravadas por um
 * backend e lidas pelo outro, e a conta fixa criada pela conversão (.NET grava,
 * o Node lê — a conta ainda é atendida pelo Node). Precisam de PARITY_NODE_URL e
 * PARITY_DOTNET_URL; sem elas, o arquivo é pulado.
 */
const enabled = Boolean(env.nodeUrl && env.dotnetUrl);

describe.skipIf(!enabled)('M3 cruzado: dívidas e metas Node × .NET no mesmo banco', () => {
  let admin: Actor;

  beforeAll(async () => {
    ({ admin } = await freshWorld());
  });

  afterAll(() => pool.end());

  async function sides() {
    const user = await newUser(admin);
    return { user, node: client(user.token, env.nodeUrl) as Client, dotnet: client(user.token, env.dotnetUrl) as Client };
  }

  async function expectSame(s: { node: Client; dotnet: Client }, path: string) {
    const [fromNode, fromDotnet] = await Promise.all([s.node.get(path), s.dotnet.get(path)]);
    expect(fromNode.status, path).toBe(200);
    expect(fromDotnet.body, path).toEqual(fromNode.body);
    return fromNode.body;
  }

  it('dívidas: projeção e frase iguais com dívidas gravadas pelos dois lados', async () => {
    const s = await sides();
    await s.node.post('/api/debts', { name: 'Celular', installmentCents: 10000, totalInstallments: 12, paidInstallments: 10 });
    const moto = await s.dotnet.post('/api/debts', { name: 'Moto', installmentCents: 5000, totalInstallments: 24 });
    expect(moto.status).toBe(201);
    await s.node.patch(`/api/debts/${moto.body.id}`, { paidInstallments: 23 });

    const overview = await expectSame(s, '/api/debts');
    expect(overview.debts.map((d: any) => d.name)).toEqual(['Celular', 'Moto']);
    expect(overview.projection.map((p: any) => p.totalCents)).toEqual([15000, 10000, 0, 0, 0, 0]);

    const over = await s.dotnet.patch(`/api/debts/${moto.body.id}`, { totalInstallments: 20 });
    expect(over.status).toBe(422);
    expect((await s.node.delete(`/api/debts/${moto.body.id}`)).status).toBe(204);
    expect((await s.dotnet.delete(`/api/debts/${moto.body.id}`)).status).toBe(404);
  });

  it('conversão no .NET: a conta criada aparece igual no Node e a dívida some dos dois', async () => {
    const s = await sides();
    const house = await categoryId(s.user, 'Casa');
    const debt = await s.node.post('/api/debts', { name: 'Sofá', installmentCents: 25000, totalInstallments: 10, paidInstallments: 4 });
    const converted = await s.dotnet.post(`/api/debts/${debt.body.id}/convert`, { categoryId: house, dueDay: 31 });
    expect(converted.status).toBe(201);

    const bills = await s.node.get('/api/bills');
    expect(bills.body.bills).toContainEqual(converted.body);
    expect((await expectSame(s, '/api/debts')).debts).toEqual([]);
  });

  it('metas: destaque único, depósitos e extrato cruzados', async () => {
    const s = await sides();
    const trip = await s.dotnet.post('/api/goals', { name: 'Viagem', targetCents: 100000, featured: true });
    const reserve = await s.node.post('/api/goals', { name: 'Reserva', targetCents: 50000, savedCents: 10000, featured: true });
    expect((await expectSame(s, '/api/goals')).map((g: any) => [g.name, g.featured])).toEqual([['Reserva', true], ['Viagem', false]]);

    for (let index = 1; index <= 6; index += 1) {
      const side = index % 2 === 0 ? s.node : s.dotnet;
      expect((await side.post(`/api/goals/${trip.body.id}/deposits`, { amountCents: index * 100 })).status).toBe(200);
    }
    await s.dotnet.patch(`/api/goals/${trip.body.id}`, { featured: true });
    const goals = await expectSame(s, '/api/goals');
    expect(goals.map((g: any) => [g.name, g.featured, g.savedCents])).toEqual([['Viagem', true, 2100], ['Reserva', false, 10000]]);
    expect(goals[0].deposits.map((d: any) => d.amountCents)).toEqual([600, 500, 400, 300, 200, 100]);

    expect((await s.node.delete(`/api/goals/${trip.body.id}`)).status).toBe(204);
    expect((await sql('SELECT 1 FROM "goal_deposits" WHERE "goalId"=$1', [trip.body.id])).length).toBe(0);
    expect((await s.dotnet.patch(`/api/goals/${trip.body.id}`, { name: 'Volta' })).status).toBe(404);
    expect((await expectSame(s, '/api/goals')).map((g: any) => g.id)).toEqual([reserve.body.id]);
  });

  it('a mesma operação grava a mesma linha pelos dois lados (plano.md §7.3)', async () => {
    const [a, b] = [await sides(), await sides()];
    const shape = async (table: string, id: string) => {
      const [row] = await sql<Record<string, unknown>>(`SELECT * FROM "${table}" WHERE id=$1`, [id]);
      const { id: rowId, userId: _user, createdAt, updatedAt, goalId: _goal, categoryId: _category, startMonth, ...rest } = row!;
      expect(rowId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      for (const instant of [createdAt, updatedAt].filter(Boolean)) expect(Math.abs((instant as Date).getTime() - Date.now())).toBeLessThan(60_000);
      return { ...rest, ...(startMonth ? { startMonth: String(startMonth) } : {}) };
    };

    const debtA = await a.node.post('/api/debts', { name: 'TV', installmentCents: 999, totalInstallments: 5, paidInstallments: 2 });
    const debtB = await b.dotnet.post('/api/debts', { name: 'TV', installmentCents: 999, totalInstallments: 5, paidInstallments: 2 });
    expect(await shape('debts', debtB.body.id)).toEqual(await shape('debts', debtA.body.id));

    const billA = await a.node.post(`/api/debts/${debtA.body.id}/convert`, { categoryId: await categoryId(a.user, 'Casa'), dueDay: 10 });
    const billB = await b.dotnet.post(`/api/debts/${debtB.body.id}/convert`, { categoryId: await categoryId(b.user, 'Casa'), dueDay: 10 });
    expect(await shape('bills', billB.body.id)).toEqual(await shape('bills', billA.body.id));

    const goalA = await a.node.post('/api/goals', { name: 'Carro', targetCents: 9000, featured: true });
    const goalB = await b.dotnet.post('/api/goals', { name: 'Carro', targetCents: 9000, featured: true });
    const depositA = await a.node.post(`/api/goals/${goalA.body.id}/deposits`, { amountCents: 300 });
    const depositB = await b.dotnet.post(`/api/goals/${goalB.body.id}/deposits`, { amountCents: 300 });
    expect(await shape('goals', goalB.body.id)).toEqual(await shape('goals', goalA.body.id));
    expect(await shape('goal_deposits', depositB.body.deposits[0].id)).toEqual(await shape('goal_deposits', depositA.body.deposits[0].id));
  });
});
