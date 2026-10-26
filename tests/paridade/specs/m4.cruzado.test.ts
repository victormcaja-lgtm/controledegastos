import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../src/db.js';
import { addDays, addMonths, currentMonth, todayUTC } from '../src/dates.js';
import { env } from '../src/env.js';
import { client, type Client } from '../src/http.js';
import { categoryId, freshWorld, newUser, type Actor } from '../src/world.js';

/**
 * Testes cruzados do M4 (T-043, plano.md §7.2): contas fixas e baixas gravadas por
 * um backend e lidas pelo outro — visão do mês, calendário e atrasadas. Precisam de
 * PARITY_NODE_URL e PARITY_DOTNET_URL; sem elas, o arquivo é pulado.
 */
const enabled = Boolean(env.nodeUrl && env.dotnetUrl);
const MONTH = currentMonth();

describe.skipIf(!enabled)('M4 cruzado: contas fixas Node × .NET no mesmo banco', () => {
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
      house: await categoryId(user, 'Casa'),
    };
  }

  async function expectSame(s: { node: Client; dotnet: Client }, path: string) {
    const [fromNode, fromDotnet] = await Promise.all([s.node.get(path), s.dotnet.get(path)]);
    expect(fromNode.status, path).toBe(200);
    expect(fromDotnet.body, path).toEqual(fromNode.body);
    return fromNode.body;
  }

  it('visão do mês, calendário e somas iguais com contas e baixas dos dois lados', async () => {
    const s = await sides();
    const rent = await s.node.post('/api/bills', { name: 'Aluguel', categoryId: s.house, amountCents: 100000, dueDay: 5 });
    const tv = await s.dotnet.post('/api/bills', { name: 'TV', categoryId: s.house, amountCents: 5000, dueDay: 31, totalInstallments: 3 });
    const gym = await s.dotnet.post('/api/bills', { name: 'Academia', categoryId: s.house, amountCents: 9000, dueDay: 1 });
    await s.node.patch(`/api/bills/${gym.body.id}`, { active: false });

    await s.dotnet.put(`/api/bills/${rent.body.id}/payment`, { month: MONTH, paid: true, amountCents: 101500 });
    await s.node.put(`/api/bills/${tv.body.id}/payment`, { month: MONTH, paid: false, waived: true });

    for (const offset of [-1, 0, 1, 2, 3]) {
      const overview = await expectSame(s, `/api/bills?month=${addMonths(MONTH, offset)}`);
      if (offset === 0) {
        expect(overview.bills.map((b: any) => [b.name, b.paid, b.waived])).toEqual([
          ['Aluguel', true, false],
          ['TV', false, true],
          ['Academia', false, false],
        ]);
      }
    }

    // Desfazer pelo outro lado.
    await s.node.put(`/api/bills/${rent.body.id}/payment`, { month: MONTH, paid: false });
    await expectSame(s, '/api/bills');
  });

  it('atrasadas iguais pelos dois lados', async () => {
    const s = await sides();
    await sql('UPDATE "user_settings" SET "openingDate"=$2 WHERE "userId"=$1', [s.user.id, `${addMonths(MONTH, -3)}-01`]);
    const water = await s.dotnet.post('/api/bills', { name: 'Água', categoryId: s.house, amountCents: 8000, dueDay: 10 });
    await sql('UPDATE "bills" SET "startMonth"=$2 WHERE id=$1', [water.body.id, `${addMonths(MONTH, -3)}-01`]);
    const power = await s.node.post('/api/bills', { name: 'Luz', categoryId: s.house, amountCents: 12000, dueDay: 28, totalInstallments: 12 });
    await sql('UPDATE "bills" SET "startMonth"=$2 WHERE id=$1', [power.body.id, `${addMonths(MONTH, -2)}-01`]);
    await s.node.put(`/api/bills/${water.body.id}/payment`, { month: addMonths(MONTH, -2), paid: true });
    await s.dotnet.put(`/api/bills/${power.body.id}/payment`, { month: addMonths(MONTH, -1), paid: false, waived: true });

    for (const today of [todayUTC(), addDays(todayUTC(), 40), `${MONTH}-10`, `${MONTH}-11`, '2026-02-31']) {
      await expectSame(s, `/api/bills/overdue?today=${today}`);
    }
  });

  it('a mesma operação grava a mesma linha pelos dois lados (plano.md §7.3)', async () => {
    const [a, b] = [await sides(), await sides()];
    const body = (s: { house: string }) => ({ name: 'Internet', categoryId: s.house, amountCents: 11990, dueDay: 15, totalInstallments: 24 });
    const viaNode = await a.node.post('/api/bills', body(a));
    const viaDotnet = await b.dotnet.post('/api/bills', body(b));
    await a.node.put(`/api/bills/${viaNode.body.id}/payment`, { month: MONTH, paid: true, amountCents: 12500 });
    await b.dotnet.put(`/api/bills/${viaDotnet.body.id}/payment`, { month: MONTH, paid: true, amountCents: 12500 });

    const shape = async (table: string, column: string, id: string) => {
      const [row] = await sql<Record<string, unknown>>(`SELECT * FROM "${table}" WHERE "${column}"=$1`, [id]);
      const { id: rowId, userId: _user, billId: _bill, categoryId: _category, createdAt, updatedAt, paidAt, startMonth, referenceMonth, ...rest } = row!;
      expect(rowId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      for (const instant of [createdAt, updatedAt, paidAt].filter(Boolean)) expect(Math.abs((instant as Date).getTime() - Date.now())).toBeLessThan(60_000);
      return { ...rest, startMonth: String(startMonth), referenceMonth: String(referenceMonth) };
    };
    expect(await shape('bills', 'id', viaDotnet.body.id)).toEqual(await shape('bills', 'id', viaNode.body.id));
    expect(await shape('bill_payments', 'billId', viaDotnet.body.id)).toEqual(await shape('bill_payments', 'billId', viaNode.body.id));
  });
});
