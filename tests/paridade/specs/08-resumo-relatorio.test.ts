import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { addMonths, currentMonth, dayOf, daysInMonth, todayUTC } from '../src/dates.js';
import { categoryId, freshWorld, newUser, type Actor } from '../src/world.js';

/**
 * Resumo do mês (dashboard) e relatório por categoria — analise.md §4.8
 * (RN-110 a RN-117). O cenário principal usa um mês PASSADO (junho/2025):
 * nele o cálculo não depende do relógio.
 */
let admin: Actor;
let user: Actor;
const JUNE = '2025-06';

beforeAll(async () => {
  ({ admin } = await freshWorld());
  user = await newUser(admin);
  const cat = async (name: string, kind = 'EXPENSE') => categoryId(user, name, kind);
  const [market, leisure, transport, house, subs, clothes, salary] = await Promise.all([
    cat('Mercado'), cat('Lazer'), cat('Transporte'), cat('Casa'), cat('Assinaturas'), cat('Roupa'), cat('Salário', 'INCOME'),
  ]);
  const tx = (type: string, amountCents: number, categoryId: string, occurredOn: string) =>
    user.api.post('/api/transactions', { type, amountCents, categoryId, occurredOn });

  await user.api.post('/api/incomes', { name: 'Salário', amountCents: 500000, receiptDay: 5 });
  const bonus = await user.api.post('/api/incomes', { name: 'Inativa', amountCents: 99999, receiptDay: 1 });
  await user.api.patch(`/api/incomes/${bonus.body.id}`, { active: false });

  await tx('INCOME', 20000, salary, '2025-06-15');
  await tx('EXPENSE', 10000, market, '2025-06-02');
  await tx('EXPENSE', 5000, market, '2025-06-09');
  await tx('EXPENSE', 3000, leisure, '2025-06-23');
  await tx('EXPENSE', 1000, transport, '2025-06-30');
  // Mês anterior, só para a comparação do relatório.
  await tx('EXPENSE', 20000, market, '2025-05-10');
  await tx('EXPENSE', 1000, leisure, '2025-05-11');

  const bill = async (name: string, categoryId: string, amountCents: number, dueDay: number) =>
    (await user.api.post('/api/bills', { name, categoryId, amountCents, dueDay })).body.id as string;
  const rent = await bill('Aluguel', house, 150000, 10);
  await bill('Internet', subs, 10000, 20);
  const streaming = await bill('Streaming', subs, 4000, 5);
  const old = await bill('Desativada', house, 7777, 1);
  await user.api.patch(`/api/bills/${old}`, { active: false });
  await user.api.put(`/api/bills/${rent}/payment`, { month: JUNE, paid: true, amountCents: 160000 });
  await user.api.put(`/api/bills/${streaming}/payment`, { month: JUNE, paid: false, waived: true });

  // Cartão (fecha 3, vence 10): compra de 20/05 cai na fatura de junho.
  const card = (await user.api.post('/api/cards', { name: 'Cartão', closingDay: 3, dueDay: 10 })).body.id;
  await user.api.post(`/api/cards/${card}/purchases`, { amountCents: 7000, purchasedOn: '2025-05-20', categoryId: clothes });
  // 2x de 90,01: 45,01 em maio e 45,00 em junho.
  await user.api.post(`/api/cards/${card}/purchases`, {
    amountCents: 9001, installments: 2, purchasedOn: '2025-04-20', categoryId: clothes,
  });
});

afterAll(() => pool.end());

describe('resumo de um mês passado (RN-110 a RN-114)', () => {
  it('fórmulas, barras, semanas e próximas contas', async () => {
    const response = await user.api.get(`/api/dashboard?month=${JUNE}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      month: JUNE,
      monthLabel: 'Junho 2025',
      isCurrentMonth: false,
      // RN-110: entrada fixa ativa (mesmo criada depois) + entrada avulsa do mês.
      incomeCents: 520000,
      // RN-097 ⚠️ + RN-110: contas criadas hoje valem em 2025; dispensada e inativa ficam de fora.
      billsTotalCents: 160000,
      // RN-111: soma o valor da conta, não o pago (1.600,00).
      billsPaidCents: 150000,
      billsDueCents: 10000,
      variableSpentCents: 19000,
      // RN-114 ⚠️: compras no cartão não entram no resumo.
      spentCents: 169000,
      leftoverCents: 341000,
      // Mês passado: "hoje" é o último dia → daysLeft = max(1, 0).
      dailyAllowanceCents: 341000,
      daysLeft: 1,
      // R-03: 169000/520000 = 32,5% → 33 (meio para cima, como o Math.round do JS).
      bars: { spentPercent: 33, duePercent: 2, leftoverPercent: 66 },
      weeks: [
        { index: 0, label: 'S1', totalCents: 10000, heightPercent: 100, current: false },
        { index: 1, label: 'S2', totalCents: 5000, heightPercent: 50, current: false },
        { index: 2, label: 'S3', totalCents: 0, heightPercent: 6, current: false },
        { index: 3, label: 'S4', totalCents: 4000, heightPercent: 40, current: false },
      ],
      // Fora do mês atual, compara S4 com S3.
      weekNote: 'Esta semana está R$ 40,00 acima da semana passada.',
      upcomingBills: [
        { id: expect.any(String), name: 'Internet', amountCents: 10000, dueDay: 20, dueDate: '2025-06-20', whenLabel: 'vence dia 20' },
      ],
    });
  });

  it('competência padrão é o mês atual (UTC)', async () => {
    const response = await user.api.get('/api/dashboard');
    expect(response.body).toMatchObject({ month: currentMonth(), isCurrentMonth: true });
  });
});

describe('resumo do mês atual e de um mês futuro (RN-111 a RN-113)', () => {
  it('mês atual: dias restantes e rótulos "vence hoje" / "em N dias" / "venceu há N dias"', async () => {
    const person = await newUser(admin);
    const house = await categoryId(person, 'Casa');
    const month = currentMonth();
    const day = Number(todayUTC().slice(8, 10));
    const total = daysInMonth(month);
    await person.api.post('/api/incomes', { name: 'Salário', amountCents: 300000, receiptDay: 1 });
    await person.api.post('/api/bills', { name: 'Hoje', categoryId: house, amountCents: 1000, dueDay: day });
    if (day < total) await person.api.post('/api/bills', { name: 'Amanhã', categoryId: house, amountCents: 1000, dueDay: day + 1 });
    if (day > 2) await person.api.post('/api/bills', { name: 'Anteontem', categoryId: house, amountCents: 1000, dueDay: day - 2 });

    const response = await person.api.get(`/api/dashboard?month=${month}`);
    const labels = Object.fromEntries(response.body.upcomingBills.map((b: any) => [b.name, b.whenLabel]));
    expect(labels['Hoje']).toBe('vence hoje');
    if (day < total) expect(labels['Amanhã']).toBe('em 1 dia');
    if (day > 2) expect(labels['Anteontem']).toBe('venceu há 2 dias');

    const bills = day < total ? (day > 2 ? 3000 : 2000) : day > 2 ? 2000 : 1000;
    const leftover = 300000 - bills;
    const daysLeft = Math.max(1, total - day);
    expect(response.body).toMatchObject({
      isCurrentMonth: true,
      daysLeft,
      leftoverCents: leftover,
      dailyAllowanceCents: Math.floor(leftover / daysLeft),
    });
    const currentWeek = Math.min(3, Math.floor((day - 1) / 7));
    expect(response.body.weeks.map((w: any) => w.current)).toEqual([0, 1, 2, 3].map((i) => i === currentWeek));
    expect(response.body.weekNote).toBe('Ainda não há gastos suficientes nesta semana para comparar.');
  });

  it('mês futuro: gasto variável projetado pela média dos 3 últimos meses fechados (÷ 3, sempre)', async () => {
    const person = await newUser(admin);
    const market = await categoryId(person, 'Mercado');
    const lastMonth = addMonths(currentMonth(), -1);
    await person.api.post('/api/incomes', { name: 'Salário', amountCents: 100000, receiptDay: 1 });
    await person.api.post('/api/transactions', { type: 'EXPENSE', amountCents: 9001, categoryId: market, occurredOn: dayOf(lastMonth, 10) });
    // Gasto de 4 meses atrás fica fora da janela.
    await person.api.post('/api/transactions', {
      type: 'EXPENSE', amountCents: 50000, categoryId: market, occurredOn: dayOf(addMonths(currentMonth(), -4), 10),
    });

    const future = addMonths(currentMonth(), 2);
    const response = await person.api.get(`/api/dashboard?month=${future}`);
    expect(response.body).toMatchObject({
      isCurrentMonth: false,
      incomeCents: 100000,
      variableSpentCents: 0,
      spentCents: 0,
      // round(9001 / 3) = 3000
      leftoverCents: 100000 - 3000,
      daysLeft: 1,
    });
  });

  it('negativo: sobra pode ser menor que zero e o "por dia" fica 0', async () => {
    const person = await newUser(admin);
    const house = await categoryId(person, 'Casa');
    await person.api.post('/api/bills', { name: 'Cara', categoryId: house, amountCents: 50000, dueDay: 1 });
    const response = await person.api.get(`/api/dashboard?month=${JUNE}`);
    expect(response.body).toMatchObject({
      incomeCents: 0,
      leftoverCents: -50000,
      dailyAllowanceCents: 0,
      // Sem renda, o denominador vira 1: as barras saturam em 100 / 0.
      bars: { spentPercent: 0, duePercent: 100, leftoverPercent: 0 },
    });
    expect(response.body.weekNote).toBe('Ainda não há gastos suficientes nesta semana para comparar.');
  });
});

describe('relatório por categoria (RN-115 a RN-117)', () => {
  it('lançamentos + todas as contas em vigor (inclusive dispensada ⚠️) + parcelas de cartão do mês', async () => {
    const response = await user.api.get(`/api/reports/categories?month=${JUNE}`);
    expect(response.status).toBe(200);
    const items = response.body.items.map((i: any) => [i.name, i.totalCents, i.percent, i.relativeWidth]);
    expect(items).toEqual([
      ['Casa', 150000, 77, 100],
      ['Mercado', 15000, 8, 10],
      ['Assinaturas', 14000, 7, 9], // RN-116 ⚠️: Internet 100,00 + Streaming dispensado 40,00
      ['Roupa', 11500, 6, 8], // RN-115: 70,00 + 2ª parcela de 45,00
      ['Lazer', 3000, 2, 3],
      ['Transporte', 1000, 1, 3],
    ]);
    expect(response.body).toMatchObject({ month: JUNE, monthLabel: 'Junho 2025', totalCents: 194500 });
    expect(response.body.items[0]).toEqual({
      categoryId: expect.any(String),
      name: 'Casa',
      color: 'oklch(0.62 0.10 250)',
      totalCents: 150000,
      percent: 77,
      relativeWidth: 100,
    });
  });

  it('RN-117: comparação com o mês anterior usa só lançamentos', async () => {
    const response = await user.api.get(`/api/reports/categories?month=${JUNE}`);
    expect(response.body.comparison).toBe('Você gastou R$ 50,00 a menos em mercado, mas R$ 20,00 a mais em lazer.');
    const may = await user.api.get('/api/reports/categories?month=2025-05');
    expect(may.body.comparison).toBe('Ainda não há mês anterior suficiente para comparar.');
  });

  it('RN-117: só aumento, só queda e estável', async () => {
    const person = await newUser(admin);
    const market = await categoryId(person, 'Mercado');
    const tx = (amountCents: number, occurredOn: string) =>
      person.api.post('/api/transactions', { type: 'EXPENSE', amountCents, categoryId: market, occurredOn });
    await tx(1000, '2024-01-10');
    await tx(2500, '2024-02-10');
    await tx(500, '2024-03-10');
    await tx(500, '2024-04-10');
    const comparison = async (month: string) =>
      (await person.api.get(`/api/reports/categories?month=${month}`)).body.comparison;
    expect(await comparison('2024-02')).toBe('O maior aumento veio de mercado: R$ 15,00 a mais que no mês passado.');
    expect(await comparison('2024-03')).toBe('Você economizou R$ 20,00 em mercado em relação ao mês passado.');
    expect(await comparison('2024-04')).toBe('Seus gastos ficaram estáveis em relação ao mês passado.');
  });

  it('mês sem nada → lista vazia', async () => {
    const person = await newUser(admin);
    const response = await person.api.get('/api/reports/categories?month=2024-01');
    expect(response.body).toMatchObject({ items: [], totalCents: 0 });
  });
});
