import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../src/db.js';
import { addDays, addMonths, currentMonth, todayUTC } from '../src/dates.js';
import { env } from '../src/env.js';
import { client, type Client } from '../src/http.js';
import { categoryId, freshWorld, newUser, type Actor } from '../src/world.js';

/**
 * Comparação do M6 (só leitura): resumo do mês e relatório por categoria calculados
 * pelos dois backends sobre o MESMO dado, em vários meses. Precisa de PARITY_NODE_URL
 * e PARITY_DOTNET_URL; sem elas, o arquivo é pulado.
 */
const enabled = Boolean(env.nodeUrl && env.dotnetUrl);
const MONTH = currentMonth();

describe.skipIf(!enabled)('M6 cruzado: resumo e relatório Node × .NET', () => {
  let admin: Actor;

  beforeAll(async () => {
    ({ admin } = await freshWorld());
  });

  afterAll(() => pool.end());

  it('mesmo dado, mesmos números e frases em 9 competências', async () => {
    const user = await newUser(admin);
    const node: Client = client(user.token, env.nodeUrl);
    const dotnet: Client = client(user.token, env.dotnetUrl);
    const market = await categoryId(user, 'Mercado');
    const leisure = await categoryId(user, 'Lazer');
    const house = await categoryId(user, 'Casa');
    const salary = await categoryId(user, 'Salário', 'INCOME');
    const today = todayUTC();

    await node.post('/api/incomes', { name: 'Salário', amountCents: 520000, receiptDay: 5 });
    const off = await node.post('/api/incomes', { name: 'Bico', amountCents: 9000, receiptDay: 20 });
    await node.patch(`/api/incomes/${off.body.id}`, { active: false });

    const tx = (type: string, amountCents: number, categoryId: string, occurredOn: string) =>
      node.post('/api/transactions', { type, amountCents, categoryId, occurredOn });
    for (const offset of [-4, -3, -2, -1, 0, 1]) {
      const month = addMonths(MONTH, offset);
      await tx('EXPENSE', 10000 + offset * 731, market, `${month}-03`);
      await tx('EXPENSE', 2500 * Math.abs(offset), leisure, `${month}-12`);
      await tx('EXPENSE', 999, market, `${month}-25`);
      await tx('INCOME', 15000, salary, `${month}-15`);
    }
    await tx('EXPENSE', 4321, market, today);
    await tx('EXPENSE', 1234, leisure, addDays(today, -1));

    const bill = (name: string, amountCents: number, dueDay: number, totalInstallments?: number) =>
      node.post('/api/bills', { name, categoryId: house, amountCents, dueDay, ...(totalInstallments ? { totalInstallments } : {}) });
    const rent = await bill('Aluguel', 150000, 5);
    const tv = await bill('TV', 9900, 31, 2);
    const gym = await bill('Academia', 8000, 28);
    const water = await bill('Água', 7000, Number(today.slice(8, 10)));
    await sql('UPDATE "bills" SET "startMonth"=$1 WHERE "userId"=$2', [`${addMonths(MONTH, -3)}-01`, user.id]);
    await node.put(`/api/bills/${rent.body.id}/payment`, { month: MONTH, paid: true, amountCents: 151000 });
    await node.put(`/api/bills/${gym.body.id}/payment`, { month: MONTH, paid: false, waived: true });
    await node.put(`/api/bills/${tv.body.id}/payment`, { month: addMonths(MONTH, -1), paid: true });
    void water;

    const card = await node.post('/api/cards', { name: 'Visa', closingDay: 8, dueDay: 15 });
    await node.post(`/api/cards/${card.body.id}/purchases`, { amountCents: 60001, installments: 6, purchasedOn: `${addMonths(MONTH, -2)}-20`, categoryId: leisure });
    await node.post(`/api/cards/${card.body.id}/purchases`, { amountCents: 3300, purchasedOn: today, categoryId: market });

    for (const offset of [-4, -3, -2, -1, 0, 1, 2, 6]) {
      for (const path of ['/api/dashboard', '/api/reports/categories']) {
        const query = `${path}?month=${addMonths(MONTH, offset)}`;
        const [fromNode, fromDotnet] = await Promise.all([node.get(query), dotnet.get(query)]);
        expect(fromNode.status, query).toBe(200);
        expect(fromDotnet.body, query).toEqual(fromNode.body);
      }
    }
    for (const path of ['/api/dashboard', '/api/reports/categories']) {
      const [fromNode, fromDotnet] = await Promise.all([node.get(path), dotnet.get(path)]);
      expect(fromDotnet.body, path).toEqual(fromNode.body);
    }

    // Antes do ano 1000, o "mês anterior" do relatório fica inválido no Node: 500 nos dois.
    const [brokenNode, brokenDotnet] = await Promise.all([node.get('/api/reports/categories?month=1000-01'), dotnet.get('/api/reports/categories?month=1000-01')]);
    expect([brokenNode.status, brokenDotnet.status]).toEqual([500, 500]);
    expect({ ...brokenDotnet.body, requestId: 'x' }).toEqual({ ...brokenNode.body, requestId: 'x' });
  });
});
