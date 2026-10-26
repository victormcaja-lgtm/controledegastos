import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../src/db.js';
import { addDays, todayUTC } from '../src/dates.js';
import { env } from '../src/env.js';
import { client, type Client } from '../src/http.js';
import { freshWorld, newUser, type Actor } from '../src/world.js';

/**
 * Testes cruzados do M1 (T-013, plano.md §7.2 e §7.3): o que o .NET grava, o Node
 * lê igual, e vice-versa — ajustes, entradas fixas e categorias. Precisam das duas
 * APIs no MESMO banco: PARITY_NODE_URL (Node direto) e PARITY_DOTNET_URL (fachada
 * com o M1 em `dotnet`). Sem elas, o arquivo é pulado.
 */
const enabled = Boolean(env.nodeUrl && env.dotnetUrl);

interface Sides {
  user: Actor;
  node: Client;
  dotnet: Client;
}

describe.skipIf(!enabled)('M1 cruzado: Node × .NET no mesmo banco', () => {
  let admin: Actor;

  beforeAll(async () => {
    ({ admin } = await freshWorld());
  });

  afterAll(() => pool.end());

  async function sides(): Promise<Sides> {
    const user = await newUser(admin);
    return { user, node: client(user.token, env.nodeUrl), dotnet: client(user.token, env.dotnetUrl) };
  }

  /** Lista igual pelos dois lados (mesma ordem, mesmos campos). */
  async function expectSameList(s: Sides, path: string) {
    const [fromNode, fromDotnet] = await Promise.all([s.node.get(path), s.dotnet.get(path)]);
    expect(fromNode.status).toBe(200);
    expect(fromDotnet.body).toEqual(fromNode.body);
    return fromNode.body;
  }

  describe('categorias', () => {
    it('.NET cria, arquiva e renomeia → Node lê igual; Node edita → .NET lê igual', async () => {
      const s = await sides();
      const created = await s.dotnet.post('/api/categories', { name: 'Pets' });
      expect(created.status).toBe(201);
      await expectSameList(s, '/api/categories');

      const archived = await s.dotnet.patch(`/api/categories/${created.body.id}`, { archived: true, name: 'Bichos' });
      const all = await expectSameList(s, '/api/categories?includeArchived=true');
      expect(all).toContainEqual(archived.body);
      expect((await expectSameList(s, '/api/categories')).some((c: any) => c.id === created.body.id)).toBe(false);

      const fromNode = await s.node.patch(`/api/categories/${created.body.id}`, { archived: false, color: '#123456' });
      expect((await s.dotnet.get('/api/categories')).body).toContainEqual(fromNode.body);

      // Nome repetido é checado contra o que o outro lado gravou.
      expect((await s.node.post('/api/categories', { name: 'bichos' })).status).toBe(409);
      expect((await s.dotnet.post('/api/categories', { name: 'BICHOS' })).status).toBe(409);
    });

    it('a cor da paleta conta as categorias gravadas pelos dois lados', async () => {
      const s = await sides();
      const first = await s.node.post('/api/categories', { name: 'Um' });
      const second = await s.dotnet.post('/api/categories', { name: 'Dois' });
      const third = await s.node.post('/api/categories', { name: 'Três' });
      expect([first.body.color, second.body.color, third.body.color]).toEqual([
        'oklch(0.62 0.10 145)',
        'oklch(0.62 0.10 300)',
        'oklch(0.62 0.10 20)',
      ]);
    });

    it('exclusão por um lado some do outro; uso gravado pelo Node bloqueia a exclusão no .NET', async () => {
      const s = await sides();
      const temp = await s.node.post('/api/categories', { name: 'Temporária' });
      expect((await s.dotnet.delete(`/api/categories/${temp.body.id}`)).status).toBe(204);
      expect((await s.node.delete(`/api/categories/${temp.body.id}`)).status).toBe(404);

      const used = await s.dotnet.post('/api/categories', { name: 'Usada' });
      await s.node.post('/api/transactions', { type: 'EXPENSE', amountCents: 100, categoryId: used.body.id, occurredOn: todayUTC() });
      const blocked = await s.dotnet.delete(`/api/categories/${used.body.id}`);
      expect(blocked.status).toBe(422);
      expect(blocked.body.message).toBe('Esta categoria está em 1 registro(s). Arquive-a em vez de excluir.');
    });
  });

  describe('entradas fixas', () => {
    it('gravadas pelos dois lados saem na mesma ordem pelos dois', async () => {
      const s = await sides();
      const late = await s.dotnet.post('/api/incomes', { name: 'Aluguel recebido', amountCents: 90000, receiptDay: 20 });
      const early = await s.node.post('/api/incomes', { name: 'Salário', amountCents: 500000, receiptDay: 5 });
      await s.dotnet.post('/api/incomes', { name: 'Freela', amountCents: 30000, receiptDay: 12 });
      await s.node.patch(`/api/incomes/${early.body.id}`, { active: false });
      await s.dotnet.patch(`/api/incomes/${late.body.id}`, { amountCents: 95000 });

      const list = await expectSameList(s, '/api/incomes');
      expect(list.map((i: any) => [i.name, i.amountCents, i.active])).toEqual([
        ['Freela', 30000, true],
        ['Aluguel recebido', 95000, true],
        ['Salário', 500000, false],
      ]);

      expect((await s.node.delete(`/api/incomes/${late.body.id}`)).status).toBe(204);
      const gone = await s.dotnet.patch(`/api/incomes/${late.body.id}`, { name: 'Volta' });
      expect(gone.status).toBe(404);
    });
  });

  describe('ajustes', () => {
    it('PATCH por um lado, GET pelo outro — inclusive o upsert sem linha', async () => {
      const s = await sides();
      await sql('DELETE FROM "user_settings" WHERE "userId"=$1', [s.user.id]);

      const created = await s.dotnet.patch('/api/settings', { roundCents: true, openingBalanceCents: -12345, openingDate: addDays(todayUTC(), 1) });
      expect(created.status).toBe(200);
      expect((await s.node.get('/api/settings')).body).toEqual(created.body);

      const fromNode = await s.node.patch('/api/settings', { openingDate: null, dailyBudgetCents: 4500, weeklySummary: false });
      expect((await s.dotnet.get('/api/settings')).body).toEqual(fromNode.body);

      // Data inexistente: os dois rolam igual (RN-004) e gravam o mesmo dia.
      await s.dotnet.patch('/api/settings', { openingDate: '2026-02-31' });
      expect((await s.node.get('/api/settings')).body.openingDate).toBe('2026-03-03');
    });
  });

  describe('forma do dado gravado (plano.md §7.3)', () => {
    const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    /** A linha sem o que pode diferir (ids e instantes), com os instantes conferidos à parte. */
    async function rowShape(table: string, id: string) {
      const [row] = await sql<Record<string, unknown>>(`SELECT * FROM "${table}" WHERE "id"=$1`, [id]);
      expect(row, `${table} ${id}`).toBeDefined();
      const { id: rowId, userId, createdAt, updatedAt, archivedAt, ...rest } = row!;
      expect(rowId).toMatch(UUID_V4);
      expect(typeof userId).toBe('string');
      for (const instant of [createdAt, updatedAt, archivedAt].filter((value) => value !== null && value !== undefined)) {
        // Gravado em UTC: perto de agora (um deslocamento de fuso daria horas de diferença).
        expect(Math.abs((instant as Date).getTime() - Date.now())).toBeLessThan(60_000);
      }
      return { ...rest, archived: archivedAt !== null && archivedAt !== undefined };
    }

    it('a mesma operação grava a mesma linha pelos dois lados', async () => {
      const [a, b] = [await sides(), await sides()];

      for (const body of [{ name: 'Pets' }, { name: 'Bico', kind: 'INCOME', color: '#ABCDEF' }]) {
        const viaNode = await a.node.post('/api/categories', body);
        const viaDotnet = await b.dotnet.post('/api/categories', body);
        expect(await rowShape('categories', viaDotnet.body.id)).toEqual(await rowShape('categories', viaNode.body.id));

        await a.node.patch(`/api/categories/${viaNode.body.id}`, { archived: true });
        await b.dotnet.patch(`/api/categories/${viaDotnet.body.id}`, { archived: true });
        expect(await rowShape('categories', viaDotnet.body.id)).toEqual(await rowShape('categories', viaNode.body.id));
      }

      const incomeNode = await a.node.post('/api/incomes', { name: 'Salário', amountCents: 500000, receiptDay: 31 });
      const incomeDotnet = await b.dotnet.post('/api/incomes', { name: 'Salário', amountCents: 500000, receiptDay: 31 });
      expect(await rowShape('incomes', incomeDotnet.body.id)).toEqual(await rowShape('incomes', incomeNode.body.id));

      const settings = { roundCents: true, openingBalanceCents: -1, openingDate: todayUTC(), dailyBudgetCents: 0 };
      await sql('DELETE FROM "user_settings" WHERE "userId" IN ($1,$2)', [a.user.id, b.user.id]);
      await a.node.patch('/api/settings', settings);
      await b.dotnet.patch('/api/settings', settings);
      const rows = await sql<Record<string, unknown>>(
        'SELECT * FROM "user_settings" WHERE "userId" IN ($1,$2) ORDER BY ("userId" = $1) DESC',
        [a.user.id, b.user.id],
      );
      const [fromNode, fromDotnet] = rows.map(({ userId: _userId, updatedAt, ...rest }) => {
        expect(Math.abs((updatedAt as Date).getTime() - Date.now())).toBeLessThan(60_000);
        return rest;
      });
      expect(fromDotnet).toEqual(fromNode);
    });
  });
});
