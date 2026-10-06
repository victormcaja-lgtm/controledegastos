import { describe, expect, it } from 'vitest';
import {
  addDaysISO,
  buildVerdict,
  findOverdueBills,
  projectCashFlow,
  type CashflowInput,
} from './cashflow.calculator.js';

function baseInput(overrides: Partial<CashflowInput> = {}): CashflowInput {
  return {
    today: '2026-10-15',
    openingDate: '2026-10-01',
    openingBalanceCents: 100_000,
    transactions: [],
    incomes: [],
    bills: [],
    billPayments: [],
    cardInvoices: [],
    goalDeposits: [],
    dailyAverageCents: 0,
    ...overrides,
  };
}

const balanceOn = (result: ReturnType<typeof projectCashFlow>, date: string) =>
  result.days.find((day) => day.date === date)?.balanceCents;

describe('projectCashFlow — saldo contínuo', () => {
  it('parte do saldo inicial e soma lançamentos reais', () => {
    const result = projectCashFlow(
      baseInput({
        transactions: [
          { id: 't1', date: '2026-10-03', type: 'EXPENSE', amountCents: 20_000, label: 'Mercado' },
          { id: 't2', date: '2026-10-10', type: 'INCOME', amountCents: 5_000, label: 'Pix' },
        ],
      }),
      '2026-10-01',
      '2026-10-31',
    );

    expect(balanceOn(result, '2026-10-02')).toBe(100_000);
    expect(balanceOn(result, '2026-10-03')).toBe(80_000);
    expect(result.todayBalanceCents).toBe(85_000);
  });

  it('a sobra de um mês vira o ponto de partida do outro', () => {
    const result = projectCashFlow(
      baseInput({ incomes: [{ id: 'i1', name: 'Salário', amountCents: 300_000, receiptDay: 5 }] }),
      '2026-10-01',
      '2026-11-30',
    );

    const october = result.months.find((m) => m.month === '2026-10')!;
    const november = result.months.find((m) => m.month === '2026-11')!;
    expect(october.closingCents).toBe(400_000);
    expect(november.openingCents).toBe(october.closingCents);
    expect(november.closingCents).toBe(700_000);
  });

  it('ignora tudo que aconteceu antes do saldo inicial', () => {
    const result = projectCashFlow(
      baseInput({
        openingDate: '2026-10-10',
        transactions: [
          { id: 't1', date: '2026-10-05', type: 'EXPENSE', amountCents: 50_000, label: 'Antes' },
        ],
        incomes: [{ id: 'i1', name: 'Salário', amountCents: 300_000, receiptDay: 5 }],
      }),
      '2026-10-01',
      '2026-10-31',
    );

    expect(result.days[0]!.date).toBe('2026-10-10');
    expect(result.todayBalanceCents).toBe(100_000);
  });

  it('projeta o gasto médio diário só nos dias futuros', () => {
    const result = projectCashFlow(
      baseInput({ dailyAverageCents: 1_000 }),
      '2026-10-01',
      '2026-10-31',
    );

    expect(result.todayBalanceCents).toBe(100_000);
    // 16 a 31 de outubro = 16 dias.
    expect(result.endOfMonthCents).toBe(100_000 - 16 * 1_000);
    expect(result.days.find((d) => d.date === '2026-10-15')!.events).toHaveLength(0);
  });

  it('acha o menor saldo e o primeiro dia negativo dali para frente', () => {
    const result = projectCashFlow(
      baseInput({
        openingBalanceCents: 10_000,
        bills: [
          {
            id: 'b1',
            name: 'Aluguel',
            amountCents: 50_000,
            dueDay: 20,
            startMonth: '2026-01',
            totalInstallments: null,
          },
        ],
        incomes: [{ id: 'i1', name: 'Salário', amountCents: 300_000, receiptDay: 25 }],
      }),
      '2026-10-01',
      '2026-10-31',
    );

    expect(result.lowest).toEqual({ date: '2026-10-20', balanceCents: -40_000 });
    expect(result.firstNegativeDate).toBe('2026-10-20');
  });
});

describe('projectCashFlow — contas fixas', () => {
  const rent = {
    id: 'b1',
    name: 'Aluguel',
    amountCents: 150_000,
    dueDay: 10,
    startMonth: '2026-01',
    totalInstallments: null,
  };

  it('conta vencida e sem baixa aparece hoje como atrasada', () => {
    const result = projectCashFlow(baseInput({ bills: [rent] }), '2026-10-01', '2026-10-31');

    const today = result.days.find((d) => d.date === '2026-10-15')!;
    expect(today.events[0]).toMatchObject({ kind: 'BILL_OVERDUE', amountCents: -150_000 });
    expect(result.overdueBills).toHaveLength(1);
    expect(result.overdueBills[0]).toMatchObject({ month: '2026-10', daysLate: 5 });
    // Pendência de hoje não entra no saldo real de hoje, mas entra na projeção.
    expect(result.todayBalanceCents).toBe(100_000);
    expect(balanceOn(result, '2026-10-15')).toBe(-50_000);
  });

  it('conta não paga ACUMULA: setembro atrasado + outubro atrasado', () => {
    const result = projectCashFlow(
      baseInput({ openingDate: '2026-09-01', bills: [rent] }),
      '2026-10-01',
      '2026-10-31',
    );

    expect(result.overdueBills.map((b) => b.month)).toEqual(['2026-09', '2026-10']);
    expect(balanceOn(result, '2026-10-15')).toBe(100_000 - 300_000);
  });

  it('baixa atrasada sai da projeção e debita no dia em que foi paga', () => {
    const result = projectCashFlow(
      baseInput({
        bills: [rent],
        billPayments: [
          {
            billId: 'b1',
            month: '2026-10',
            status: 'PAID',
            amountCents: 155_000,
            paidOn: '2026-10-12',
          },
        ],
      }),
      '2026-10-01',
      '2026-10-31',
    );

    expect(result.overdueBills).toHaveLength(0);
    expect(balanceOn(result, '2026-10-12')).toBe(100_000 - 155_000);
    expect(result.todayBalanceCents).toBe(-55_000);
  });

  it('"não vou pagar" tira a competência sem mexer no saldo', () => {
    const result = projectCashFlow(
      baseInput({
        bills: [rent],
        billPayments: [
          {
            billId: 'b1',
            month: '2026-10',
            status: 'WAIVED',
            amountCents: 150_000,
            paidOn: '2026-10-12',
          },
        ],
      }),
      '2026-10-01',
      '2026-10-31',
    );

    expect(result.overdueBills).toHaveLength(0);
    expect(result.endOfMonthCents).toBe(100_000);
  });

  it('conta que venceu antes do saldo inicial já está embutida nele', () => {
    const result = projectCashFlow(
      baseInput({ openingDate: '2026-10-12', bills: [rent] }),
      '2026-10-01',
      '2026-10-31',
    );
    expect(result.overdueBills).toHaveLength(0);
    expect(result.endOfMonthCents).toBe(100_000);
  });

  it('conta com prazo para de aparecer depois da última parcela', () => {
    const result = projectCashFlow(
      baseInput({
        today: '2026-10-01',
        bills: [{ ...rent, dueDay: 5, startMonth: '2026-09', totalInstallments: 2 }],
      }),
      '2026-10-01',
      '2026-12-31',
    );

    const billEvents = result.days.flatMap((d) => d.events).filter((e) => e.kind === 'BILL');
    expect(billEvents).toHaveLength(1);
    expect(billEvents[0]!.label).toBe('Aluguel 2/2');
  });

  it('vencimento no dia 31 cai no último dia de fevereiro', () => {
    const result = projectCashFlow(
      baseInput({
        today: '2027-02-01',
        openingDate: '2027-02-01',
        bills: [{ ...rent, dueDay: 31 }],
      }),
      '2027-02-01',
      '2027-02-28',
    );
    expect(result.days.find((d) => d.date === '2027-02-28')!.events[0]!.kind).toBe('BILL');
  });
});

describe('projectCashFlow — cartões, metas e simulação', () => {
  it('fatura sai inteira no vencimento', () => {
    const result = projectCashFlow(
      baseInput({
        cardInvoices: [
          {
            cardId: 'c1',
            cardName: 'Nubank',
            month: '2026-10',
            dueDate: '2026-10-20',
            totalCents: 30_000,
          },
        ],
      }),
      '2026-10-01',
      '2026-10-31',
    );
    expect(balanceOn(result, '2026-10-19')).toBe(100_000);
    expect(balanceOn(result, '2026-10-20')).toBe(70_000);
  });

  it('dinheiro guardado em meta sai do saldo e conta como guardado no mês', () => {
    const result = projectCashFlow(
      baseInput({
        goalDeposits: [
          { goalId: 'g1', goalName: 'Viagem', date: '2026-10-05', amountCents: 10_000 },
        ],
      }),
      '2026-10-01',
      '2026-10-31',
    );
    const october = result.months[0]!;
    expect(october.savedCents).toBe(10_000);
    expect(october.outCents).toBe(0);
    expect(october.closingCents).toBe(90_000);
  });

  it('veredito avisa quando a compra deixa o saldo negativo', () => {
    const input = baseInput({ openingBalanceCents: 20_000 });
    const before = projectCashFlow(input, '2026-10-01', '2026-10-31');
    const after = projectCashFlow(
      { ...input, extraEvents: [{ date: '2026-10-16', label: 'TV', amountCents: 30_000 }] },
      '2026-10-01',
      '2026-10-31',
    );
    const { verdict, fits } = buildVerdict(before, after);
    expect(fits).toBe(false);
    expect(verdict).toContain('fica negativo em 16/10');
  });
});

describe('findOverdueBills', () => {
  it('não marca como atrasada a conta que vence hoje', () => {
    const overdue = findOverdueBills({
      today: '2026-10-10',
      openingDate: '2026-10-01',
      bills: [
        {
          id: 'b1',
          name: 'Luz',
          amountCents: 100,
          dueDay: 10,
          startMonth: '2026-10',
          totalInstallments: null,
        },
      ],
      billPayments: [],
    });
    expect(overdue).toHaveLength(0);
  });
});

describe('addDaysISO', () => {
  it('atravessa meses e anos', () => {
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
  });
});
