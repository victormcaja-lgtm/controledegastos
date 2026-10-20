import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../src/db.js';
import { addMonths, currentMonth, dayOf, daysInMonth, todayUTC } from '../src/dates.js';
import { categoryId, freshWorld, newUser, type Actor } from '../src/world.js';

/** Contas fixas por competência — analise.md §4.6 (RN-090 a RN-101). */
let admin: Actor;
const MONTH = currentMonth();

beforeAll(async () => {
  ({ admin } = await freshWorld());
});

afterAll(() => pool.end());

async function setup() {
  const user = await newUser(admin);
  const house = await categoryId(user, 'Casa');
  const createBill = async (body: Record<string, unknown>) => {
    const response = await user.api.post('/api/bills', { categoryId: house, ...body });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as any;
  };
  return { user, house, createBill };
}

/** Competência em que a conta começa a valer (a API grava a do dia da criação). */
const setStartMonth = (billId: string, month: string) =>
  sql(`UPDATE "bills" SET "startMonth"=$2::date WHERE id=$1`, [billId, `${month}-01`]);

describe('cadastro e edição (RN-090, RN-091)', () => {
  it('criar: vigora a partir do mês atual (UTC) e responde o DTO do mês', async () => {
    const { user, house, createBill } = await setup();
    const bill = await createBill({ name: 'Aluguel', amountCents: 120000, dueDay: 31 });
    expect(bill).toEqual({
      id: expect.any(String),
      name: 'Aluguel',
      amountCents: 120000,
      dueDay: 31,
      active: true,
      category: { id: house, name: 'Casa', color: 'oklch(0.62 0.10 250)', kind: 'EXPENSE' },
      paid: false,
      waived: false,
      paidAt: null,
      dueDate: dayOf(MONTH, 31),
      totalInstallments: null,
      installmentNumber: null,
    });
    const [row] = await sql<any>(`SELECT to_char("startMonth",'YYYY-MM-DD') AS start FROM "bills" WHERE id=$1`, [bill.id]);
    expect(row.start).toBe(`${MONTH}-01`);

    const installments = await createBill({ name: 'Curso', amountCents: 9000, dueDay: 10, totalInstallments: 6 });
    expect(installments).toMatchObject({ totalInstallments: 6, installmentNumber: 1 });

    const salary = await categoryId(user, 'Salário', 'INCOME');
    const wrong = await user.api.post('/api/bills', { name: 'Errada', categoryId: salary, amountCents: 1, dueDay: 1 });
    expect(wrong.status).toBe(422);
    expect(wrong.body.message).toBe('Contas fixas precisam de uma categoria de despesa.');
  });

  it('categoria arquivada é aceita na criação; prazo de 1 a 600', async () => {
    const { user, house, createBill } = await setup();
    await user.api.patch(`/api/categories/${house}`, { archived: true });
    await createBill({ name: 'Ainda vale', amountCents: 100, dueDay: 1 });
    const tooLong = await user.api.post('/api/bills', { name: 'X', categoryId: house, amountCents: 1, dueDay: 1, totalInstallments: 601 });
    expect(tooLong.status).toBe(400);
  });

  it('editar responde o DTO do ?month pedido; startMonth não muda', async () => {
    const { user, createBill } = await setup();
    const bill = await createBill({ name: 'Internet', amountCents: 10000, dueDay: 10, totalInstallments: 12 });
    const next = addMonths(MONTH, 3);
    const response = await user.api.patch(`/api/bills/${bill.id}?month=${next}`, { amountCents: 11000, active: false });
    expect(response.body).toMatchObject({
      amountCents: 11000,
      active: false,
      installmentNumber: 4,
      dueDate: dayOf(next, 10),
    });
  });
});

describe('visão do mês (RN-093, RN-096 a RN-100)', () => {
  it('ordem ativas primeiro e por dia; pagas e a pagar; calendário', async () => {
    const { user, createBill } = await setup();
    const rent = await createBill({ name: 'Aluguel', amountCents: 100000, dueDay: 15 });
    const gym = await createBill({ name: 'Academia', amountCents: 10000, dueDay: 5 });
    const tv = await createBill({ name: 'TV', amountCents: 5000, dueDay: 1 });
    const old = await createBill({ name: 'Antiga', amountCents: 7000, dueDay: 2 });
    await user.api.patch(`/api/bills/${old.id}`, { active: false });

    await user.api.put(`/api/bills/${rent.id}/payment`, { month: MONTH, paid: true, amountCents: 105000 });
    await user.api.put(`/api/bills/${tv.id}/payment`, { month: MONTH, paid: false, waived: true });

    const response = await user.api.get(`/api/bills?month=${MONTH}`);
    expect(response.body.month).toBe(MONTH);
    expect(response.body.bills.map((b: any) => [b.name, b.active, b.paid, b.waived])).toEqual([
      ['TV', true, false, true],
      ['Academia', true, false, false],
      ['Aluguel', true, true, false],
      ['Antiga', false, false, false],
    ]);
    // RN-098 ⚠️: "pagas" soma o valor da conta (1.000,00), não o pago (1.050,00).
    expect(response.body.paidCents).toBe(100000);
    // A pagar: só ativa, nem paga nem dispensada.
    expect(response.body.dueCents).toBe(10000);
    expect(response.body.bills.find((b: any) => b.name === 'Aluguel').paidAt).toMatch(/Z$/);
    expect(response.body.bills.find((b: any) => b.name === 'TV').paidAt).toBeNull();

    const firstWeekday = new Date(`${MONTH}-01T00:00:00Z`).getUTCDay();
    const calendar = response.body.calendar;
    expect(calendar).toHaveLength(firstWeekday + daysInMonth(MONTH));
    expect(calendar.slice(0, firstWeekday).every((c: any) => c.day === null && !c.hasBill)).toBe(true);
    const cell = (day: number) => calendar[firstWeekday + day - 1];
    expect(cell(1)).toMatchObject({ day: 1, hasBill: true, allPaid: true }); // dispensada conta como resolvida
    expect(cell(5)).toMatchObject({ hasBill: true, allPaid: false });
    expect(cell(2)).toMatchObject({ hasBill: false }); // inativa não marca o calendário
    expect(cell(Number(todayUTC().slice(8, 10))).isToday).toBe(true);
  });

  it('RN-100 ⚠️: conta do dia 31 não aparece no calendário de meses curtos', async () => {
    const { user, createBill } = await setup();
    await createBill({ name: 'Fim do mês', amountCents: 100, dueDay: 31 });
    let month = MONTH;
    while (daysInMonth(month) === 31) month = addMonths(month, 1);
    const response = await user.api.get(`/api/bills?month=${month}`);
    expect(response.body.bills[0].dueDate).toBe(dayOf(month, 31));
    expect(response.body.calendar.some((c: any) => c.hasBill)).toBe(false);
  });

  it('RN-093: conta com prazo some depois da última parcela', async () => {
    const { user, createBill } = await setup();
    await createBill({ name: 'Parcelada', amountCents: 100, dueDay: 10, totalInstallments: 2 });
    const second = await user.api.get(`/api/bills?month=${addMonths(MONTH, 1)}`);
    expect(second.body.bills.map((b: any) => b.installmentNumber)).toEqual([2]);
    const after = await user.api.get(`/api/bills?month=${addMonths(MONTH, 2)}`);
    expect(after.body.bills).toEqual([]);
  });

  it('RN-097 ⚠️: conta aparece em meses ANTERIORES à criação, com parcela ≤ 0', async () => {
    const { user, createBill } = await setup();
    await createBill({ name: 'Nova', amountCents: 100, dueDay: 10, totalInstallments: 3 });
    const before = await user.api.get(`/api/bills?month=${addMonths(MONTH, -2)}`);
    expect(before.body.bills.map((b: any) => [b.name, b.installmentNumber])).toEqual([['Nova', -1]]);
  });
});

describe('baixa por competência (RN-094, RN-095)', () => {
  it('pagar, pagar de novo com outro valor, dispensar e desfazer', async () => {
    const { user, createBill } = await setup();
    const bill = await createBill({ name: 'Luz', amountCents: 20000, dueDay: 10 });
    const payment = async (body: Record<string, unknown>) =>
      (await user.api.put(`/api/bills/${bill.id}/payment`, { month: MONTH, ...body })).body;
    const rows = () =>
      sql<any>(`SELECT status, "amountCents", "paidAt" FROM "bill_payments" WHERE "billId"=$1`, [bill.id]);

    const paid = await payment({ paid: true });
    expect(paid).toMatchObject({ paid: true, waived: false, paidAt: expect.stringMatching(/Z$/) });
    const [first] = await rows();
    expect(first).toMatchObject({ status: 'PAID', amountCents: 20000 });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await payment({ paid: true, amountCents: 21500 });
    const [second] = await rows();
    expect(second.amountCents).toBe(21500);
    expect(second.paidAt.getTime()).toBeGreaterThan(first.paidAt.getTime()); // refazer atualiza paidAt

    // waived ignora `paid` e grava o valor da conta.
    const waived = await payment({ paid: true, waived: true, amountCents: 1 });
    expect(waived).toMatchObject({ paid: false, waived: true, paidAt: null });
    const [third] = await rows();
    expect(third).toMatchObject({ status: 'WAIVED', amountCents: 20000 });

    const undone = await payment({ paid: false });
    expect(undone).toMatchObject({ paid: false, waived: false });
    expect(await rows()).toEqual([]);
  });

  it('RN-095 ⚠️: aceita competência fora da vigência e conta inativa', async () => {
    const { user, createBill } = await setup();
    const bill = await createBill({ name: 'Curta', amountCents: 100, dueDay: 10, totalInstallments: 1 });
    await user.api.patch(`/api/bills/${bill.id}`, { active: false });
    const past = await user.api.put(`/api/bills/${bill.id}/payment`, { month: addMonths(MONTH, -5), paid: true });
    expect(past.status).toBe(200);
    const future = await user.api.put(`/api/bills/${bill.id}/payment`, { month: addMonths(MONTH, 7), paid: true });
    expect(future.status).toBe(200);
    expect((await sql(`SELECT 1 FROM "bill_payments" WHERE "billId"=$1`, [bill.id])).length).toBe(2);
  });

  it('RN-092: excluir a conta leva as baixas junto', async () => {
    const { user, createBill } = await setup();
    const bill = await createBill({ name: 'Some', amountCents: 100, dueDay: 10 });
    await user.api.put(`/api/bills/${bill.id}/payment`, { month: MONTH, paid: true });
    expect((await user.api.delete(`/api/bills/${bill.id}`)).status).toBe(204);
    expect((await sql(`SELECT 1 FROM "bill_payments" WHERE "billId"=$1`, [bill.id])).length).toBe(0);
    expect((await user.api.delete(`/api/bills/${bill.id}`)).body.message).toBe('Conta não encontrado.');
  });
});

describe('contas em atraso (RN-101)', () => {
  const previous = addMonths(MONTH, -1);
  const today = `${MONTH}-20`;

  it('sem saldo inicial → lista vazia', async () => {
    const { user, createBill } = await setup();
    const bill = await createBill({ name: 'Água', amountCents: 100, dueDay: 5 });
    await setStartMonth(bill.id, previous);
    expect((await user.api.get(`/api/bills/overdue?today=${today}`)).body).toEqual([]);
  });

  it('acumula meses vencidos sem baixa; baixa, dispensa, inativa e vencimento no dia não entram', async () => {
    const { user, createBill } = await setup();
    await user.api.patch('/api/settings', { openingBalanceCents: 0, openingDate: `${previous}-01` });

    const water = await createBill({ name: 'Água', amountCents: 8000, dueDay: 5, totalInstallments: 10 });
    const phone = await createBill({ name: 'Telefone', amountCents: 6000, dueDay: 8 });
    const club = await createBill({ name: 'Clube', amountCents: 4000, dueDay: 9 });
    const today20 = await createBill({ name: 'Hoje', amountCents: 1000, dueDay: 20 });
    const inactive = await createBill({ name: 'Inativa', amountCents: 1000, dueDay: 3 });
    for (const bill of [water, phone, club, today20, inactive]) await setStartMonth(bill.id, previous);
    await user.api.patch(`/api/bills/${inactive.id}`, { active: false });
    await user.api.put(`/api/bills/${phone.id}/payment`, { month: previous, paid: true });
    await user.api.put(`/api/bills/${club.id}/payment`, { month: MONTH, paid: false, waived: true });

    const response = await user.api.get(`/api/bills/overdue?today=${today}`);
    const daysLate = (due: string) => Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);
    expect(response.body).toEqual([
      {
        billId: water.id, name: 'Água', month: previous, dueDate: `${previous}-05`, amountCents: 8000,
        daysLate: daysLate(`${previous}-05`), installmentNumber: 1, totalInstallments: 10,
      },
      {
        billId: club.id, name: 'Clube', month: previous, dueDate: `${previous}-09`, amountCents: 4000,
        daysLate: daysLate(`${previous}-09`), installmentNumber: null, totalInstallments: null,
      },
      {
        billId: today20.id, name: 'Hoje', month: previous, dueDate: `${previous}-20`, amountCents: 1000,
        daysLate: daysLate(`${previous}-20`), installmentNumber: null, totalInstallments: null,
      },
      {
        billId: water.id, name: 'Água', month: MONTH, dueDate: `${MONTH}-05`, amountCents: 8000,
        daysLate: 15, installmentNumber: 2, totalInstallments: 10,
      },
      {
        billId: phone.id, name: 'Telefone', month: MONTH, dueDate: `${MONTH}-08`, amountCents: 6000,
        daysLate: 12, installmentNumber: null, totalInstallments: null,
      },
    ]);
  });

  it('vencimento antes do saldo inicial já está embutido nele', async () => {
    const { user, createBill } = await setup();
    await user.api.patch('/api/settings', { openingBalanceCents: 0, openingDate: `${MONTH}-10` });
    const bill = await createBill({ name: 'Antes', amountCents: 100, dueDay: 5 });
    await setStartMonth(bill.id, previous);
    expect((await user.api.get(`/api/bills/overdue?today=${today}`)).body).toEqual([]);
  });
});
