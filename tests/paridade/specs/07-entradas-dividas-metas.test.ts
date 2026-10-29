import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../src/db.js';
import { addMonths, currentMonth } from '../src/dates.js';
import { categoryId, freshWorld, newUser, type Actor } from '../src/world.js';

/** Entradas fixas, dívidas e metas — analise.md §4.7 (RN-105 a RN-109). */
let admin: Actor;
const MONTH = currentMonth();
const SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const shortName = (month: string) => SHORT[Number(month.slice(5, 7)) - 1];
const longLabel = (month: string) => `${LONG[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

beforeAll(async () => {
  ({ admin } = await freshWorld());
});

afterAll(() => pool.end());

describe('entradas fixas (RN-105)', () => {
  it('CRUD e ordem: ativas primeiro, depois pelo dia', async () => {
    const user = await newUser(admin);
    const create = (name: string, receiptDay: number) =>
      user.api.post('/api/incomes', { name, amountCents: 1000 * receiptDay, receiptDay });
    const late = await create('Aluguel recebido', 20);
    const early = await create('Salário', 5);
    const mid = await create('Freela', 12);
    expect(late.body).toEqual({ id: expect.any(String), name: 'Aluguel recebido', amountCents: 20000, receiptDay: 20, active: true });

    await user.api.patch(`/api/incomes/${early.body.id}`, { active: false });
    const list = await user.api.get('/api/incomes');
    expect(list.body.map((i: any) => [i.name, i.active])).toEqual([
      ['Freela', true],
      ['Aluguel recebido', true],
      ['Salário', false],
    ]);

    expect((await user.api.delete(`/api/incomes/${mid.body.id}`)).status).toBe(204);
    const gone = await user.api.patch(`/api/incomes/${mid.body.id}`, { name: 'Volta' });
    expect(gone.status).toBe(404);
    expect(gone.body.message).toBe('Entrada não encontrado.');
  });
});

describe('dívidas (RN-106 a RN-108)', () => {
  it('criar e derivados; pagas acima do total: 400 na criação, 422 na edição', async () => {
    const user = await newUser(admin);
    const response = await user.api.post('/api/debts', { name: 'Notebook', installmentCents: 30000, totalInstallments: 3 });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: 'Notebook',
      installmentCents: 30000,
      paidInstallments: 0,
      totalInstallments: 3,
      remainingInstallments: 3,
      remainingCents: 90000,
      progressPercent: 0,
      settled: false,
    });

    const one = await user.api.patch(`/api/debts/${response.body.id}`, { paidInstallments: 1 });
    expect(one.body).toMatchObject({ remainingInstallments: 2, remainingCents: 60000, progressPercent: 33 });
    const two = await user.api.patch(`/api/debts/${response.body.id}`, { paidInstallments: 2 });
    expect(two.body.progressPercent).toBe(67);

    const over = await user.api.patch(`/api/debts/${response.body.id}`, { paidInstallments: 4 });
    expect(over.status).toBe(422);
    expect(over.body.message).toBe('As parcelas pagas não podem passar do total de parcelas.');
    const shrink = await user.api.patch(`/api/debts/${response.body.id}`, { totalInstallments: 1 });
    expect(shrink.status).toBe(422);

    const invalid = await user.api.post('/api/debts', {
      name: 'Errada', installmentCents: 100, totalInstallments: 2, paidInstallments: 3,
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.details).toContainEqual({ path: 'paidInstallments', message: 'Parcelas pagas não podem passar do total.' });

    const settled = await user.api.patch(`/api/debts/${response.body.id}`, { paidInstallments: 3 });
    expect(settled.body).toMatchObject({ remainingInstallments: 0, remainingCents: 0, progressPercent: 100, settled: true });
  });

  it('RN-107: sem parcelas em aberto', async () => {
    const user = await newUser(admin);
    const overview = await user.api.get('/api/debts');
    expect(overview.body).toEqual({
      debts: [],
      monthlyTotalCents: 0,
      projection: Array.from({ length: 6 }, (_, offset) => ({
        month: addMonths(MONTH, offset),
        label: shortName(addMonths(MONTH, offset)),
        totalCents: 0,
      })),
      note: 'Você não tem parcelas em aberto. 👏',
    });
  });

  it('RN-107: projeção de 6 meses e o mês em que sobra dinheiro', async () => {
    const user = await newUser(admin);
    await user.api.post('/api/debts', { name: 'Celular', installmentCents: 10000, totalInstallments: 12, paidInstallments: 10 }); // faltam 2
    await user.api.post('/api/debts', { name: 'Moto', installmentCents: 5000, totalInstallments: 24 });
    const overview = await user.api.get('/api/debts');
    expect(overview.body.debts.map((d: any) => d.name)).toEqual(['Celular', 'Moto']); // ordem de criação
    expect(overview.body.monthlyTotalCents).toBe(15000);
    expect(overview.body.projection.map((p: any) => p.totalCents)).toEqual([15000, 15000, 5000, 5000, 5000, 5000]);
    expect(overview.body.note).toBe(
      `Em ${longLabel(addMonths(MONTH, 2))} sobram R$ 100,00 a mais no seu bolso: uma parcela acaba.`,
    );
  });

  it('RN-107: parcelas que seguem iguais', async () => {
    const user = await newUser(admin);
    await user.api.post('/api/debts', { name: 'Longa', installmentCents: 5000, totalInstallments: 24 });
    expect((await user.api.get('/api/debts')).body.note).toBe('As parcelas seguem iguais nos próximos meses.');
  });

  it('RN-108: converter em conta fixa com o que falta; quitada e categoria de entrada são recusadas', async () => {
    const user = await newUser(admin);
    const house = await categoryId(user, 'Casa');
    const debt = await user.api.post('/api/debts', { name: 'Sofá', installmentCents: 25000, totalInstallments: 10, paidInstallments: 4 });

    const salary = await categoryId(user, 'Salário', 'INCOME');
    const wrong = await user.api.post(`/api/debts/${debt.body.id}/convert`, { categoryId: salary, dueDay: 15 });
    expect(wrong.status).toBe(422);
    expect(wrong.body.message).toBe('Contas fixas precisam de uma categoria de despesa.');

    const converted = await user.api.post(`/api/debts/${debt.body.id}/convert`, { categoryId: house, dueDay: 15 });
    expect(converted.status).toBe(201);
    expect(converted.body).toMatchObject({
      name: 'Sofá',
      amountCents: 25000,
      dueDay: 15,
      totalInstallments: 6,
      installmentNumber: 1,
      paid: false,
      category: { id: house },
    });
    expect((await user.api.get('/api/debts')).body.debts).toEqual([]);

    const paidOff = await user.api.post('/api/debts', { name: 'Quitada', installmentCents: 100, totalInstallments: 1, paidInstallments: 1 });
    const refused = await user.api.post(`/api/debts/${paidOff.body.id}/convert`, { categoryId: house, dueDay: 1 });
    expect(refused.status).toBe(422);
    expect(refused.body.message).toBe('Esta dívida já está quitada.');
  });
});

describe('metas (RN-109)', () => {
  it('criar, destaque único, guardar e extrato', async () => {
    const user = await newUser(admin);
    const first = await user.api.post('/api/goals', { name: 'Viagem', targetCents: 100000, featured: true });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      id: expect.any(String),
      name: 'Viagem',
      targetCents: 100000,
      savedCents: 0,
      remainingCents: 100000,
      progressPercent: 0,
      achieved: false,
      featured: true,
      deposits: [],
    });
    const second = await user.api.post('/api/goals', { name: 'Reserva', targetCents: 50000, savedCents: 10000, featured: true });
    expect(second.body).toMatchObject({ savedCents: 10000, progressPercent: 20, deposits: [] }); // valor inicial não é depósito

    let list = await user.api.get('/api/goals');
    expect(list.body.map((g: any) => [g.name, g.featured])).toEqual([
      ['Reserva', true],
      ['Viagem', false],
    ]);

    const deposit = await user.api.post(`/api/goals/${first.body.id}/deposits`, { amountCents: 2500 });
    expect(deposit.status).toBe(200);
    expect(deposit.body).toMatchObject({ savedCents: 2500, remainingCents: 97500, progressPercent: 3 });
    expect(deposit.body.deposits).toEqual([{ id: expect.any(String), amountCents: 2500, createdAt: expect.stringMatching(/Z$/) }]);

    await user.api.patch(`/api/goals/${first.body.id}`, { featured: true });
    list = await user.api.get('/api/goals');
    expect(list.body.map((g: any) => [g.name, g.featured])).toEqual([
      ['Viagem', true],
      ['Reserva', false],
    ]);
    // featured:false pode deixar ninguém em destaque.
    await user.api.patch(`/api/goals/${first.body.id}`, { featured: false });
    expect((await user.api.get('/api/goals')).body.every((g: any) => !g.featured)).toBe(true);
  });

  it('extrato traz os 10 depósitos mais recentes; acima do alvo: alcançada e 100%', async () => {
    const user = await newUser(admin);
    const goal = await user.api.post('/api/goals', { name: 'Pequena', targetCents: 1000 });
    for (let index = 1; index <= 12; index += 1) {
      await user.api.post(`/api/goals/${goal.body.id}/deposits`, { amountCents: index * 100 });
    }
    const response = (await user.api.get('/api/goals')).body[0];
    expect(response).toMatchObject({ savedCents: 7800, remainingCents: 0, progressPercent: 100, achieved: true });
    expect(response.deposits.map((d: any) => d.amountCents)).toEqual([1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300]);

    // Editar o guardado direto não cria depósito.
    const edited = await user.api.patch(`/api/goals/${goal.body.id}`, { savedCents: 0 });
    expect(edited.body).toMatchObject({ savedCents: 0, achieved: false });
    expect((await sql('SELECT 1 FROM "goal_deposits" WHERE "goalId"=$1', [goal.body.id])).length).toBe(12);

    expect((await user.api.delete(`/api/goals/${goal.body.id}`)).status).toBe(204);
    expect((await sql('SELECT 1 FROM "goal_deposits" WHERE "goalId"=$1', [goal.body.id])).length).toBe(0);
  });
});
