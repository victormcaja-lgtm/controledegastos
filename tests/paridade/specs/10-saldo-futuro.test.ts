import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../src/db.js';
import { addDays, todayUTC } from '../src/dates.js';
import { categoryId, freshWorld, newUser, type Actor } from '../src/world.js';

/**
 * Saldo futuro e "Posso comprar?" — analise.md §4.10 (RN-140 a RN-149).
 *
 * Cenário com "hoje" = 15/06/2025 (enviado em `today`) e saldo inicial de
 * R$ 1.000,00 no início de 01/06/2025. Datas gravadas pelo relógio do servidor
 * (baixa, depósito, início de vigência) são ajustadas direto no banco.
 */
let admin: Actor;
let user: Actor;
const TODAY = '2025-06-15';
const ids: Record<string, string> = {};

const setStartMonth = (billId: string, month: string) =>
  sql(`UPDATE "bills" SET "startMonth"=$2::date WHERE id=$1`, [billId, `${month}-01`]);
const setPaidAt = (billId: string, month: string, paidAt: string) =>
  sql(`UPDATE "bill_payments" SET "paidAt"=$3::timestamp WHERE "billId"=$1 AND "referenceMonth"=$2::date`, [
    billId,
    `${month}-01`,
    paidAt,
  ]);

const cashflow = (u: Actor, from: string, to: string, today = TODAY) =>
  u.api.get(`/api/cashflow?from=${from}&to=${to}&today=${today}`);

beforeAll(async () => {
  ({ admin } = await freshWorld());
  user = await newUser(admin);
  const cat = (name: string, kind = 'EXPENSE') => categoryId(user, name, kind);
  const [market, extra, house, clothes] = await Promise.all([
    cat('Mercado'), cat('Renda extra', 'INCOME'), cat('Casa'), cat('Roupa'),
  ]);

  await user.api.patch('/api/settings', { openingBalanceCents: 100000, openingDate: '2025-06-01', dailyBudgetCents: 1000 });
  ids.salary = (await user.api.post('/api/incomes', { name: 'Salário', amountCents: 300000, receiptDay: 5 })).body.id;

  const tx = (type: string, amountCents: number, categoryId: string, occurredOn: string, note?: string) =>
    user.api.post('/api/transactions', { type, amountCents, categoryId, occurredOn, ...(note ? { note } : {}) });
  await tx('EXPENSE', 99999, market, '2025-05-30', 'Antes do saldo inicial');
  ids.feira = (await tx('EXPENSE', 20000, market, '2025-06-03', 'Feira')).body.id;
  await tx('INCOME', 5000, extra, '2025-06-10');
  await tx('EXPENSE', 7000, market, '2025-06-20', 'Agendado');

  const bill = async (name: string, amountCents: number, dueDay: number, totalInstallments?: number) => {
    const id = (await user.api.post('/api/bills', { name, categoryId: house, amountCents, dueDay, totalInstallments })).body.id;
    await setStartMonth(id, '2025-05');
    return id as string;
  };
  ids.streaming = await bill('Streaming', 3000, 2);
  ids.luz = await bill('Luz', 20000, 8);
  ids.aluguel = await bill('Aluguel', 150000, 10);
  ids.agua = await bill('Água', 5000, 15);
  ids.parcelada = await bill('Parcelada', 1000, 20, 1);
  await setStartMonth(ids.parcelada, '2025-06');
  ids.inativa = await bill('Inativa', 99999, 1);
  await user.api.patch(`/api/bills/${ids.inativa}`, { active: false });

  await user.api.put(`/api/bills/${ids.aluguel}/payment`, { month: '2025-06', paid: true, amountCents: 155000 });
  await setPaidAt(ids.aluguel, '2025-06', '2025-06-12 14:00:00');
  await user.api.put(`/api/bills/${ids.streaming}/payment`, { month: '2025-06', paid: false, waived: true });

  ids.card = (await user.api.post('/api/cards', { name: 'Visa', closingDay: 3, dueDay: 10 })).body.id;
  await user.api.post(`/api/cards/${ids.card}/purchases`, { amountCents: 12000, purchasedOn: '2025-05-20', categoryId: clothes });
  await user.api.post(`/api/cards/${ids.card}/purchases`, {
    amountCents: 8000, installments: 2, purchasedOn: '2025-06-14', categoryId: clothes,
  });

  ids.goal = (await user.api.post('/api/goals', { name: 'Viagem', targetCents: 100000 })).body.id;
  await user.api.post(`/api/goals/${ids.goal}/deposits`, { amountCents: 2500 });
  await sql(`UPDATE "goal_deposits" SET "createdAt"='2025-06-11 09:00:00' WHERE "goalId"=$1`, [ids.goal]);
});

afterAll(() => pool.end());

describe('projeção dia a dia (RN-141 a RN-145)', () => {
  it('saldo de hoje, fim do mês, menor saldo e atrasadas', async () => {
    const response = await cashflow(user, '2025-06-01', '2025-07-31');
    expect(response.status).toBe(200);
    const body = response.body;
    expect(body).toMatchObject({
      configured: true,
      today: TODAY,
      openingDate: '2025-06-01',
      from: '2025-06-01',
      to: '2025-07-31',
      // Até ontem: 1.000 − 200 + 3.000 + 50 − 120 − 25 − 1.550. Hoje só tem previstos.
      todayBalanceCents: 215500,
      endOfMonthCents: 167500,
      lowest: { date: '2025-07-04', balanceCents: 160500 },
      firstNegativeDate: null,
      dailyAverageCents: 1000,
    });
    expect(body.overdueBills).toEqual([
      {
        billId: ids.luz, name: 'Luz', month: '2025-06', dueDate: '2025-06-08', amountCents: 20000,
        daysLate: 7, installmentNumber: null, totalInstallments: null,
      },
    ]);
    expect(body.days).toHaveLength(61);
    expect(body.days[0].date).toBe('2025-06-01');
    expect(body.days.at(-1)).toMatchObject({ date: '2025-07-31', balanceCents: 254500, projected: true });
  });

  it('eventos de cada dia, na ordem: lançamentos, entradas fixas, contas, faturas, metas, gasto médio', async () => {
    const days = Object.fromEntries((await cashflow(user, '2025-06-01', '2025-07-31')).body.days.map((d: any) => [d.date, d]));
    const event = (kind: string, label: string, amountCents: number, projected: boolean, refId: string | null, month: string | null) =>
      ({ kind, label, amountCents, projected, refId, month });

    expect(days['2025-06-02'].events).toEqual([]); // Streaming dispensado não aparece
    expect(days['2025-06-03']).toEqual({
      date: '2025-06-03', inCents: 0, outCents: 20000, balanceCents: 80000, projected: false,
      events: [event('TRANSACTION', 'Feira', -20000, false, ids.feira!, null)],
    });
    expect(days['2025-06-05'].events).toEqual([event('INCOME', 'Salário', 300000, false, ids.salary!, '2025-06')]);
    expect(days['2025-06-10']).toMatchObject({ inCents: 5000, outCents: 12000, balanceCents: 373000 });
    expect(days['2025-06-10'].events).toEqual([
      event('TRANSACTION', 'Renda extra', 5000, false, expect.any(String), null), // sem observação → categoria
      event('CARD_INVOICE', 'Fatura Visa', -12000, false, ids.card!, '2025-06'),
    ]);
    expect(days['2025-06-11'].events).toEqual([event('GOAL_DEPOSIT', 'Guardado em Viagem', -2500, false, ids.goal!, null)]);
    // Paga com juros: sai no dia da baixa, com o valor pago.
    expect(days['2025-06-12'].events).toEqual([event('BILL', 'Aluguel', -155000, false, ids.aluguel!, '2025-06')]);
    // Hoje: atrasada entra hoje; a que vence hoje é prevista, não atrasada. Sem gasto médio hoje.
    expect(days[TODAY]).toEqual({
      date: TODAY, inCents: 0, outCents: 25000, balanceCents: 190500, projected: false,
      events: [
        event('BILL_OVERDUE', 'Luz · atrasada desde 08/06', -20000, true, ids.luz!, '2025-06'),
        event('BILL', 'Água', -5000, true, ids.agua!, '2025-06'),
      ],
    });
    expect(days['2025-06-20'].events).toEqual([
      event('TRANSACTION', 'Agendado', -7000, true, expect.any(String), null),
      event('BILL', 'Parcelada 1/1', -1000, true, ids.parcelada!, '2025-06'),
      event('DAILY_AVERAGE', 'Gasto médio do dia', -1000, true, null, null),
    ]);
    expect(days['2025-06-20']).toMatchObject({ projected: true, balanceCents: 177500 });
    expect(days['2025-07-02'].events.map((e: any) => [e.kind, e.label])).toEqual([
      ['BILL', 'Streaming'],
      ['DAILY_AVERAGE', 'Gasto médio do dia'],
    ]);
    expect(days['2025-07-10'].events.map((e: any) => [e.kind, e.label, e.amountCents])).toEqual([
      ['BILL', 'Aluguel', -150000],
      ['CARD_INVOICE', 'Fatura Visa', -4000],
      ['DAILY_AVERAGE', 'Gasto médio do dia', -1000],
    ]);
    // Parcela única: não volta em julho. Inativa nunca aparece. Antes do saldo inicial: ignorado.
    const all = Object.values(days).flatMap((d: any) => d.events.map((e: any) => e.label));
    expect(all.filter((label: string) => label.startsWith('Parcelada'))).toHaveLength(1);
    expect(all).not.toContain('Inativa');
    expect(all).not.toContain('Antes do saldo inicial');
  });

  it('RN-145: resultado de cada mês — guardado em meta fica à parte das saídas', async () => {
    const response = await cashflow(user, '2025-06-01', '2025-07-31');
    expect(response.body.months).toEqual([
      {
        month: '2025-06', label: 'Junho 2025', openingCents: 100000, inCents: 305000, outCents: 235000,
        savedCents: 2500, resultCents: 70000, closingCents: 167500, closed: false,
      },
      {
        month: '2025-07', label: 'Julho 2025', openingCents: 167500, inCents: 300000, outCents: 213000,
        savedCents: 0, resultCents: 87000, closingCents: 254500, closed: false,
      },
    ]);
  });

  it('intervalo menor: `days` recortado, mas o saldo continua vindo desde o saldo inicial', async () => {
    const response = await cashflow(user, '2025-07-01', '2025-07-05');
    expect(response.body.days.map((d: any) => [d.date, d.balanceCents])).toEqual([
      ['2025-07-01', 166500],
      ['2025-07-02', 162500],
      ['2025-07-03', 161500],
      ['2025-07-04', 160500],
      ['2025-07-05', 459500],
    ]);
    // A projeção vai até o fim do mês de `to`; os meses listados são os que tocam o intervalo.
    expect(response.body.months.map((m: any) => m.month)).toEqual(['2025-07']);
    expect(response.body.endOfMonthCents).toBe(167500);
    expect(response.body.lowest).toEqual({ date: '2025-07-04', balanceCents: 160500 });
  });

  it('RN-140: validação do intervalo', async () => {
    const backwards = await user.api.get(`/api/cashflow?from=2025-06-10&to=2025-06-01&today=${TODAY}`);
    expect(backwards.status).toBe(400);
    expect(backwards.body.details).toContainEqual({ path: 'to', message: 'A data final precisa ser depois da inicial.' });
    const tooLong = await user.api.get(`/api/cashflow?from=2025-01-01&to=2026-02-06&today=${TODAY}`);
    expect(tooLong.body.details).toContainEqual({ path: 'to', message: 'Peça no máximo 400 dias por vez.' });
    expect((await user.api.get(`/api/cashflow?from=2025-01-01&to=2026-02-05&today=${TODAY}`)).status).toBe(200);
  });

  it('RN-140: sem `today`, vale a data UTC do servidor', async () => {
    const today = todayUTC();
    const response = await user.api.get(`/api/cashflow?from=${today}&to=${addDays(today, 3)}`);
    expect(response.body.today).toBe(today);
  });
});

describe('casos à parte', () => {
  it('RN-140: sem saldo inicial → configured false e estrutura vazia', async () => {
    const person = await newUser(admin);
    const response = await cashflow(person, '2025-06-01', '2025-06-30');
    expect(response.body).toEqual({
      configured: false, today: TODAY, openingDate: null, from: '2025-06-01', to: '2025-06-30',
      todayBalanceCents: 0, endOfMonthCents: 0, lowest: null, firstNegativeDate: null,
      dailyAverageCents: 0, overdueBills: [], days: [], months: [],
    });
  });

  it('RN-144: hoje antes do saldo inicial → saldo de hoje = saldo inicial', async () => {
    const person = await newUser(admin);
    await person.api.patch('/api/settings', { openingBalanceCents: 4242, openingDate: '2025-06-20' });
    const response = await cashflow(person, '2025-06-20', '2025-06-25');
    expect(response.body).toMatchObject({ todayBalanceCents: 4242, dailyAverageCents: 0 });
    expect(response.body.days[0].date).toBe('2025-06-20');
  });

  it('RN-141: média diária pelo histórico de 90 dias (mínimo de 7 dias de janela)', async () => {
    const person = await newUser(admin);
    const market = await categoryId(person, 'Mercado');
    await person.api.patch('/api/settings', { openingBalanceCents: 0, openingDate: '2025-06-01' });
    const tx = (amountCents: number, occurredOn: string) =>
      person.api.post('/api/transactions', { type: 'EXPENSE', amountCents, categoryId: market, occurredOn });

    await tx(7000, '2025-06-10');
    await tx(5555, TODAY); // o dia de hoje fica fora da média
    expect((await cashflow(person, TODAY, '2025-06-20')).body.dailyAverageCents).toBe(1000); // 7000 / 7

    await tx(5000, '2025-05-16'); // 30 dias antes de hoje → janela de 30 dias
    expect((await cashflow(person, TODAY, '2025-06-20')).body.dailyAverageCents).toBe(400); // 12000 / 30

    await person.api.patch('/api/settings', { dailyBudgetCents: 0 });
    const none = await cashflow(person, TODAY, '2025-06-20');
    expect(none.body.dailyAverageCents).toBe(0);
    expect(none.body.days.flatMap((d: any) => d.events).some((e: any) => e.kind === 'DAILY_AVERAGE')).toBe(false);
  });

  it('RN-143: fatura que vence hoje ainda é prevista (regra ≥, diferente das outras)', async () => {
    const person = await newUser(admin);
    const clothes = await categoryId(person, 'Roupa');
    await person.api.patch('/api/settings', { openingBalanceCents: 10000, openingDate: '2025-06-01', dailyBudgetCents: 0 });
    const card = (await person.api.post('/api/cards', { name: 'Hoje', closingDay: 5, dueDay: 15 })).body.id;
    await person.api.post(`/api/cards/${card}/purchases`, { amountCents: 3000, purchasedOn: '2025-06-01', categoryId: clothes });
    const response = await cashflow(person, '2025-06-01', '2025-06-30');
    const today = response.body.days.find((d: any) => d.date === TODAY);
    expect(today.events).toEqual([
      { kind: 'CARD_INVOICE', label: 'Fatura Hoje', amountCents: -3000, projected: true, refId: card, month: '2025-06' },
    ]);
    expect(response.body.todayBalanceCents).toBe(10000);
  });

  it('RN-149 ⚠️: baixa feita antes do saldo inicial faz a conta sumir do fluxo', async () => {
    const person = await newUser(admin);
    const house = await categoryId(person, 'Casa');
    await person.api.patch('/api/settings', { openingBalanceCents: 0, openingDate: '2025-06-10', dailyBudgetCents: 0 });
    const bill = (await person.api.post('/api/bills', { name: 'Adiantada', categoryId: house, amountCents: 900, dueDay: 20 })).body.id;
    await setStartMonth(bill, '2025-06');
    await person.api.put(`/api/bills/${bill}/payment`, { month: '2025-06', paid: true });
    await setPaidAt(bill, '2025-06', '2025-06-05 12:00:00');
    const response = await cashflow(person, '2025-06-10', '2025-06-30');
    expect(response.body.days.flatMap((d: any) => d.events)).toEqual([]);
    expect(response.body.overdueBills).toEqual([]);
  });
});

describe('"Posso comprar?" (RN-146, RN-147)', () => {
  const simulate = (u: Actor, body: Record<string, unknown>) =>
    u.api.post('/api/cashflow/simulate', { from: TODAY, to: '2025-07-31', today: TODAY, installments: 1, ...body });

  it('na conta, à vista: deixa o saldo negativo', async () => {
    const response = await simulate(user, { amountCents: 200000, date: '2025-06-16', method: 'ACCOUNT' });
    expect(response.status).toBe(200);
    expect(response.body.fits).toBe(false);
    expect(response.body.verdict).toBe(
      'Seu menor saldo vai de R$ 1.605,00 para −R$ 395,00 em 04/07. Atenção: com essa compra o saldo fica negativo em 16/06.',
    );
    expect(response.body.before.lowest).toEqual({ date: '2025-07-04', balanceCents: 160500 });
    expect(response.body.after).toMatchObject({ firstNegativeDate: '2025-06-16', lowest: { date: '2025-07-04', balanceCents: -39500 } });
    const simulated = response.body.after.days.find((d: any) => d.date === '2025-06-16').events;
    expect(simulated).toContainEqual({
      kind: 'SIMULATION', label: 'Compra simulada', amountCents: -200000, projected: true, refId: null, month: null,
    });
    // Nada é gravado.
    expect((await cashflow(user, TODAY, '2025-07-31')).body.lowest.balanceCents).toBe(160500);
  });

  it('na conta, cabe; parcelado: uma parcela por mês no mesmo dia, resto na 1ª', async () => {
    const fits = await simulate(user, { amountCents: 1000, date: '2025-06-16', method: 'ACCOUNT' });
    expect(fits.body).toMatchObject({ fits: true, verdict: 'Seu menor saldo vai de R$ 1.605,00 para R$ 1.595,00 em 04/07. Cabe no seu saldo.' });

    const split = await simulate(user, { amountCents: 1001, installments: 2, date: '2025-06-30', method: 'ACCOUNT' });
    const simulated = split.body.after.days.flatMap((d: any) =>
      d.events.filter((e: any) => e.kind === 'SIMULATION').map((e: any) => [d.date, e.label, e.amountCents]),
    );
    expect(simulated).toEqual([
      ['2025-06-30', 'Compra simulada 1/2', -501],
      ['2025-07-30', 'Compra simulada 2/2', -500],
    ]);
  });

  it('no cartão: parcelas nos vencimentos das faturas', async () => {
    const response = await simulate(user, { amountCents: 9000, installments: 3, date: '2025-06-16', method: 'CARD', cardId: ids.card });
    const simulated = response.body.after.days.flatMap((d: any) =>
      d.events.filter((e: any) => e.kind === 'SIMULATION').map((e: any) => [d.date, e.label, e.amountCents]),
    );
    // Só a 1ª parcela cai dentro do intervalo pedido.
    expect(simulated).toEqual([['2025-07-10', 'Compra simulada · Visa 1/3 (fatura 10/07)', -3000]]);
    const single = await simulate(user, { amountCents: 500, date: '2025-06-16', method: 'CARD', cardId: ids.card });
    expect(
      single.body.after.days.flatMap((d: any) => d.events).find((e: any) => e.kind === 'SIMULATION').label,
    ).toBe('Compra simulada · Visa (fatura 10/07)');
  });

  it('saldo que já fica negativo; nenhum dia à frente', async () => {
    const person = await newUser(admin);
    const house = await categoryId(person, 'Casa');
    await person.api.patch('/api/settings', { openingBalanceCents: 1000, openingDate: '2025-06-01', dailyBudgetCents: 0 });
    const bill = (await person.api.post('/api/bills', { name: 'Grande', categoryId: house, amountCents: 5000, dueDay: 16 })).body.id;
    await setStartMonth(bill, '2025-06');

    const already = await simulate(person, { amountCents: 100, date: '2025-06-20', method: 'ACCOUNT', to: '2025-06-30' });
    expect(already.body.verdict).toBe(
      'Seu menor saldo vai de −R$ 40,00 para −R$ 41,00 em 20/06. Seu saldo já fica negativo sem essa compra — ela aumenta o buraco.',
    );

    const none = await simulate(person, { amountCents: 100, date: '2025-06-02', method: 'ACCOUNT', from: '2025-06-01', to: '2025-06-10' });
    expect(none.body).toMatchObject({ fits: true, verdict: 'Não há dias à frente no intervalo para comparar.' });
  });

  it('erros: sem saldo inicial, sem cartão, cartão inexistente', async () => {
    const person = await newUser(admin);
    const unconfigured = await simulate(person, { amountCents: 100, date: TODAY, method: 'ACCOUNT' });
    expect(unconfigured.status).toBe(422);
    expect(unconfigured.body.message).toBe('Informe seu saldo atual na tela inicial antes de simular.');

    const noCard = await simulate(user, { amountCents: 100, date: TODAY, method: 'CARD' });
    expect(noCard.status).toBe(400);
    expect(noCard.body.details).toContainEqual({ path: 'cardId', message: 'Escolha o cartão.' });

    const unknown = await simulate(user, { amountCents: 100, date: TODAY, method: 'CARD', cardId: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toBe('Cartão não encontrado.');
  });
});

describe('RN-148 ⚠️: desativar reescreve o passado (roda por último: altera o cenário)', () => {
  it('desativar a entrada fixa tira recebimentos já passados do saldo de hoje', async () => {
    await user.api.patch(`/api/incomes/${ids.salary}`, { active: false });
    expect((await cashflow(user, '2025-06-01', '2025-06-30')).body.todayBalanceCents).toBe(215500 - 300000);
  });

  it('desativar a conta paga devolve o pagamento ao saldo de hoje', async () => {
    await user.api.patch(`/api/bills/${ids.aluguel}`, { active: false });
    expect((await cashflow(user, '2025-06-01', '2025-06-30')).body.todayBalanceCents).toBe(215500 - 300000 + 155000);
  });
});
