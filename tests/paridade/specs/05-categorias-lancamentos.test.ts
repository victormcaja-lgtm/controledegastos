import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { addDays, todayUTC } from '../src/dates.js';
import { categoryId, freshWorld, newUser, type Actor } from '../src/world.js';

/** Categorias e lançamentos — analise.md §4.4 e §4.5 (RN-070 a RN-087). */
let admin: Actor;

beforeAll(async () => {
  ({ admin } = await freshWorld());
});

afterAll(() => pool.end());

const PALETTE = [
  'oklch(0.62 0.10 145)',
  'oklch(0.62 0.10 300)',
  'oklch(0.62 0.10 20)',
  'oklch(0.62 0.10 70)',
  'oklch(0.62 0.10 250)',
  'oklch(0.62 0.10 200)',
  'oklch(0.62 0.10 330)',
  'oklch(0.62 0.10 40)',
  'oklch(0.62 0.10 160)',
  'oklch(0.62 0.10 120)',
  'oklch(0.62 0.10 90)',
];

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

describe('categorias', () => {
  it('RN-072: criar — tipo padrão despesa e cor pela posição na paleta (contando arquivadas)', async () => {
    const user = await newUser(admin);
    const first = await user.api.post('/api/categories', { name: 'Farmácia' });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      id: expect.any(String),
      name: 'Farmácia',
      color: PALETTE[11 % 11],
      kind: 'EXPENSE',
      isSystem: false,
      archivedAt: null,
    });
    await user.api.patch(`/api/categories/${first.body.id}`, { archived: true });
    const second = await user.api.post('/api/categories', { name: 'Pets', kind: 'EXPENSE' });
    expect(second.body.color).toBe(PALETTE[12 % 11]);
    const custom = await user.api.post('/api/categories', { name: 'Presentes', color: '#ABCDEF' });
    expect(custom.body.color).toBe('#ABCDEF');
  });

  it('RN-072: nome repetido no mesmo tipo (sem diferenciar maiúsculas, inclusive arquivada) → 409', async () => {
    const user = await newUser(admin);
    const clash = await user.api.post('/api/categories', { name: 'mercado' });
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ code: 'CONFLICT', message: 'Você já tem uma categoria com esse nome.' });
    expect((await user.api.post('/api/categories', { name: 'Mercado', kind: 'INCOME' })).status).toBe(201);

    const archived = await user.api.post('/api/categories', { name: 'Hobby' });
    await user.api.patch(`/api/categories/${archived.body.id}`, { archived: true });
    expect((await user.api.post('/api/categories', { name: 'HOBBY' })).status).toBe(409);
  });

  it('cor inválida → mensagem própria', async () => {
    const user = await newUser(admin);
    const response = await user.api.post('/api/categories', { name: 'Cores', color: 'azul' });
    expect(response.status).toBe(400);
    expect(response.body.details).toContainEqual({
      path: 'color',
      message: 'Cor inválida. Use hex, oklch(), rgb() ou hsl().',
    });
  });

  it('RN-073: renomear, recolorir, arquivar (também as do sistema) e desarquivar', async () => {
    const user = await newUser(admin);
    const id = await categoryId(user, 'Lazer');

    expect((await user.api.patch(`/api/categories/${id}`, { name: 'LAZER' })).body.name).toBe('LAZER');
    const clash = await user.api.patch(`/api/categories/${id}`, { name: 'Casa' });
    expect(clash.status).toBe(409);

    const archived = await user.api.patch(`/api/categories/${id}`, { archived: true });
    expect(archived.body).toMatchObject({ isSystem: true, archivedAt: expect.stringMatching(/Z$/) });
    const again = await user.api.patch(`/api/categories/${id}`, { archived: true });
    expect(Date.parse(again.body.archivedAt)).toBeGreaterThanOrEqual(Date.parse(archived.body.archivedAt));
    expect((await user.api.patch(`/api/categories/${id}`, { archived: false })).body.archivedAt).toBeNull();
  });

  it('RN-070: arquivadas ficam fora da lista padrão', async () => {
    const user = await newUser(admin);
    const id = await categoryId(user, 'Roupa');
    await user.api.patch(`/api/categories/${id}`, { archived: true });
    const visible = await user.api.get('/api/categories');
    expect(visible.body.some((c: any) => c.id === id)).toBe(false);
    const all = await user.api.get('/api/categories?includeArchived=true');
    expect(all.body.some((c: any) => c.id === id)).toBe(true);
  });

  it('RN-071 ⚠️: includeArchived=false também devolve as arquivadas', async () => {
    const user = await newUser(admin);
    const id = await categoryId(user, 'Roupa');
    await user.api.patch(`/api/categories/${id}`, { archived: true });
    const response = await user.api.get('/api/categories?includeArchived=false');
    expect(response.body.some((c: any) => c.id === id)).toBe(true);
  });

  it('RN-074: em uso → 422 com a contagem (lançamentos + contas + compras no cartão), antes da regra de sistema', async () => {
    const user = await newUser(admin);
    const market = await categoryId(user, 'Mercado');
    await user.api.post('/api/transactions', { type: 'EXPENSE', amountCents: 100, categoryId: market, occurredOn: todayUTC() });
    await user.api.post('/api/bills', { name: 'Feira mensal', categoryId: market, amountCents: 100, dueDay: 5 });
    const card = await user.api.post('/api/cards', { name: 'Cartão', closingDay: 3, dueDay: 10 });
    await user.api.post(`/api/cards/${card.body.id}/purchases`, { amountCents: 100, purchasedOn: todayUTC(), categoryId: market });

    const response = await user.api.delete(`/api/categories/${market}`);
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'BUSINESS_RULE',
      message: 'Esta categoria está em 3 registro(s). Arquive-a em vez de excluir.',
    });
  });

  it('RN-074: do sistema sem uso → 422; personalizada sem uso → 204', async () => {
    const user = await newUser(admin);
    const system = await user.api.delete(`/api/categories/${await categoryId(user, 'Educação')}`);
    expect(system.status).toBe(422);
    expect(system.body.message).toBe('Categorias padrão não podem ser excluídas — apenas arquivadas.');

    const custom = await user.api.post('/api/categories', { name: 'Temporária' });
    expect((await user.api.delete(`/api/categories/${custom.body.id}`)).status).toBe(204);
  });
});

describe('lançamentos', () => {
  let user: Actor;
  let market: string;
  let salary: string;

  beforeAll(async () => {
    user = await newUser(admin);
    market = await categoryId(user, 'Mercado');
    salary = await categoryId(user, 'Salário', 'INCOME');
  });

  it('RN-080: criar — formato da resposta, data futura aceita, observação aparada', async () => {
    const future = addDays(todayUTC(), 40);
    const response = await user.api.post('/api/transactions', {
      type: 'EXPENSE',
      amountCents: 1250,
      categoryId: market,
      occurredOn: future,
      note: '  feira do mês  ',
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      type: 'EXPENSE',
      amountCents: 1250,
      occurredOn: future,
      note: 'feira do mês',
      category: { id: market, name: 'Mercado', color: PALETTE[0], kind: 'EXPENSE' },
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
  });

  it('RN-080: categoria arquivada, de tipo errado ou de outra pessoa', async () => {
    const other = await newUser(admin);
    const foreign = await categoryId(other, 'Mercado');
    const notFound = await user.api.post('/api/transactions', {
      type: 'EXPENSE', amountCents: 100, categoryId: foreign, occurredOn: todayUTC(),
    });
    expect(notFound.status).toBe(404);
    expect(notFound.body.message).toBe('Categoria não encontrado.');

    const wrongExpense = await user.api.post('/api/transactions', {
      type: 'EXPENSE', amountCents: 100, categoryId: salary, occurredOn: todayUTC(),
    });
    expect(wrongExpense.status).toBe(422);
    expect(wrongExpense.body.message).toBe('Escolha uma categoria de despesa para um gasto.');
    const wrongIncome = await user.api.post('/api/transactions', {
      type: 'INCOME', amountCents: 100, categoryId: market, occurredOn: todayUTC(),
    });
    expect(wrongIncome.body.message).toBe('Escolha uma categoria de entrada para um recebimento.');

    const archived = await user.api.post('/api/categories', { name: 'Arquivada' });
    await user.api.patch(`/api/categories/${archived.body.id}`, { archived: true });
    const blocked = await user.api.post('/api/transactions', {
      type: 'EXPENSE', amountCents: 100, categoryId: archived.body.id, occurredOn: todayUTC(),
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body.message).toBe('Esta categoria está arquivada. Escolha outra.');
  });

  it('RN-004 ⚠️: 31/02 é aceito e vira 03/03; dia 32 é recusado', async () => {
    const rolled = await user.api.post('/api/transactions', {
      type: 'EXPENSE', amountCents: 100, categoryId: market, occurredOn: '2026-02-31',
    });
    expect(rolled.status).toBe(201);
    expect(rolled.body.occurredOn).toBe('2026-03-03');

    const invalid = await user.api.post('/api/transactions', {
      type: 'EXPENSE', amountCents: 100, categoryId: market, occurredOn: '2026-02-32',
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.details).toContainEqual({ path: 'occurredOn', message: 'Data inexistente.' });
  });

  it('RN-081 ⚠️: observação só com espaços é gravada como texto vazio', async () => {
    const response = await user.api.post('/api/transactions', {
      type: 'EXPENSE', amountCents: 100, categoryId: market, occurredOn: todayUTC(), note: '   ',
    });
    expect(response.body.note).toBe('');
  });

  it('RN-082/083: editar — tipo não muda, categoria do outro tipo é recusada, arquivada é aceita ⚠️', async () => {
    const created = await user.api.post('/api/transactions', {
      type: 'EXPENSE', amountCents: 100, categoryId: market, occurredOn: todayUTC(), note: 'antes',
    });
    const id = created.body.id;

    const wrong = await user.api.patch(`/api/transactions/${id}`, { categoryId: salary });
    expect(wrong.status).toBe(422);
    expect(wrong.body.message).toBe('A categoria escolhida não combina com o tipo do lançamento.');

    const archived = await user.api.post('/api/categories', { name: 'Arquivada Edição' });
    await user.api.patch(`/api/categories/${archived.body.id}`, { archived: true });
    const moved = await user.api.patch(`/api/transactions/${id}`, { categoryId: archived.body.id, amountCents: 999 });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ amountCents: 999, category: { id: archived.body.id } });

    expect((await user.api.patch(`/api/transactions/${id}`, { note: null })).body.note).toBeNull();
    // `type` não é campo editável: é descartado, o corpo fica vazio → "Nada para atualizar."
    expect((await user.api.patch(`/api/transactions/${id}`, { type: 'INCOME' })).status).toBe(400);
  });

  it('excluir: 204 e depois 404', async () => {
    const created = await user.api.post('/api/transactions', {
      type: 'EXPENSE', amountCents: 100, categoryId: market, occurredOn: todayUTC(),
    });
    expect((await user.api.delete(`/api/transactions/${created.body.id}`)).status).toBe(204);
    expect((await user.api.delete(`/api/transactions/${created.body.id}`)).status).toBe(404);
  });
});

describe('listagem de lançamentos (RN-084 a RN-086)', () => {
  let user: Actor;
  const month = '2025-03';

  beforeAll(async () => {
    user = await newUser(admin);
    const market = await categoryId(user, 'Mercado');
    const leisure = await categoryId(user, 'Lazer');
    const salary = await categoryId(user, 'Salário', 'INCOME');
    const add = (type: string, amountCents: number, categoryId: string, occurredOn: string, note?: string) =>
      user.api.post('/api/transactions', { type, amountCents, categoryId, occurredOn, ...(note ? { note } : {}) });
    await add('EXPENSE', 1000, market, '2025-03-05', 'Feira da Semana');
    await add('EXPENSE', 2000, leisure, '2025-03-05', 'cinema');
    await add('INCOME', 500000, salary, '2025-03-05');
    await add('EXPENSE', 3000, market, '2025-03-20');
    await add('EXPENSE', 4000, market, '2025-04-01');
  });

  it('agrupa por dia (mais recente primeiro), com rótulo e total despesas − entradas', async () => {
    const response = await user.api.get(`/api/transactions?month=${month}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 1, perPage: 20, total: 4, totalPages: 1 });
    expect(response.body.groups.map((g: any) => [g.date, g.label, g.totalCents, g.items.length])).toEqual([
      ['2025-03-20', '20 de março', 3000, 1],
      ['2025-03-05', '05 de março', 1000 + 2000 - 500000, 3],
    ]);
    // Dentro do dia: o criado por último primeiro.
    expect(response.body.groups[1].items.map((t: any) => t.amountCents)).toEqual([500000, 2000, 1000]);
    expect(response.body.items).toHaveLength(4);
  });

  it('rótulos "Hoje" e "Ontem" pela data UTC do servidor', async () => {
    const market = await categoryId(user, 'Mercado');
    const today = todayUTC();
    await user.api.post('/api/transactions', { type: 'EXPENSE', amountCents: 1, categoryId: market, occurredOn: today });
    await user.api.post('/api/transactions', { type: 'EXPENSE', amountCents: 1, categoryId: market, occurredOn: addDays(today, -1) });
    const response = await user.api.get(`/api/transactions?search=`);
    const labels = Object.fromEntries(response.body.groups.map((g: any) => [g.date, g.label]));
    expect(labels[today]).toBe('Hoje');
    expect(labels[addDays(today, -1)]).toBe('Ontem');
    const older = response.body.groups.find((g: any) => g.date === '2025-04-01');
    expect(older.label).toBe(`01 de ${MONTHS[3]}`);
  });

  it('filtros: categoria, tipo e busca na observação (sem diferenciar maiúsculas)', async () => {
    const leisure = await categoryId(user, 'Lazer');
    expect((await user.api.get(`/api/transactions?month=${month}&categoryId=${leisure}`)).body.total).toBe(1);
    expect((await user.api.get(`/api/transactions?month=${month}&type=INCOME`)).body.total).toBe(1);
    const search = await user.api.get(`/api/transactions?search=FEIRA`);
    expect(search.body.items.map((t: any) => t.note)).toEqual(['Feira da Semana']);
    // A busca não olha o nome da categoria.
    expect((await user.api.get(`/api/transactions?search=mercado`)).body.total).toBe(0);
  });

  it('RN-086 ⚠️: summary conta todos os resultados, mas soma só os gastos da página', async () => {
    const page1 = await user.api.get(`/api/transactions?month=${month}&perPage=2`);
    expect(page1.body).toMatchObject({ total: 4, totalPages: 2 });
    // Página 1: 3000 (20/03) e o salário de 5.000 (05/03) — só 30,00 de gasto.
    expect(page1.body.summary).toBe('4 lançamentos · R$ 30,00 em gastos');
    const page2 = await user.api.get(`/api/transactions?month=${month}&perPage=2&page=2`);
    expect(page2.body.summary).toBe('4 lançamentos · R$ 30,00 em gastos');
    const single = await user.api.get(`/api/transactions?month=${month}&type=INCOME`);
    expect(single.body.summary).toBe('1 lançamento · R$ 0,00 em gastos');
  });
});
