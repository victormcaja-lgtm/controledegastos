import { describe, expect, it } from 'vitest';
import { calculateBudget, projectDebts } from './budget.calculator.js';

/**
 * O cálculo do orçamento é a regra de negócio mais crítica do produto: é o
 * número grande que o usuário lê na tela inicial e usa para decidir se pode
 * gastar. Por ser função pura, dá para testar cada cenário sem banco algum.
 */

const base = {
  today: new Date('2026-09-15T12:00:00Z'),
  incomeCents: 480_000,
  extraIncomeCents: 0,
  variableExpenses: [] as Array<{ day: number; amountCents: number }>,
  bills: [] as Array<{ amountCents: number; dueDay: number; paid: boolean }>,
  averageVariableCents: 118_000,
};

describe('calculateBudget', () => {
  it('sobra = entradas − contas fixas − gastos variáveis', () => {
    const result = calculateBudget({
      ...base,
      month: '2026-09',
      variableExpenses: [{ day: 3, amountCents: 20_000 }],
      bills: [
        { amountCents: 120_000, dueDay: 10, paid: true },
        { amountCents: 80_000, dueDay: 20, paid: false },
      ],
    });

    expect(result.billsTotalCents).toBe(200_000);
    expect(result.billsPaidCents).toBe(120_000);
    expect(result.billsDueCents).toBe(80_000);
    expect(result.leftoverCents).toBe(480_000 - 200_000 - 20_000);
  });

  it('considera entradas avulsas do mês', () => {
    const result = calculateBudget({ ...base, month: '2026-09', extraIncomeCents: 15_000 });
    expect(result.incomeCents).toBe(495_000);
  });

  it('projeta meses futuros com a média histórica, não com o realizado', () => {
    const futuro = calculateBudget({
      ...base,
      month: '2026-12',
      variableExpenses: [{ day: 1, amountCents: 999_999 }],
      bills: [{ amountCents: 100_000, dueDay: 5, paid: false }],
    });

    expect(futuro.isCurrentMonth).toBe(false);
    // Usa a média (118.000), não o lançamento absurdo daquele mês.
    expect(futuro.leftoverCents).toBe(480_000 - 100_000 - 118_000);
  });

  it('permite sobra negativa quando as contas passam da renda', () => {
    const result = calculateBudget({
      ...base,
      month: '2026-09',
      bills: [{ amountCents: 600_000, dueDay: 10, paid: false }],
    });
    expect(result.leftoverCents).toBeLessThan(0);
    // A barra nunca fica negativa, mesmo com sobra negativa.
    expect(result.bars.leftoverPercent).toBe(0);
  });

  it('nunca divide por zero quando não há renda cadastrada', () => {
    const result = calculateBudget({ ...base, month: '2026-09', incomeCents: 0 });
    expect(Number.isFinite(result.dailyAllowanceCents)).toBe(true);
    expect(result.bars.spentPercent).toBe(0);
  });

  it('distribui os gastos nas quatro semanas do mês', () => {
    const result = calculateBudget({
      ...base,
      month: '2026-09',
      variableExpenses: [
        { day: 2, amountCents: 10_000 },
        { day: 9, amountCents: 30_000 },
        { day: 16, amountCents: 5_000 },
        { day: 30, amountCents: 1_000 },
      ],
    });

    expect(result.weeks.map((week) => week.totalCents)).toEqual([10_000, 30_000, 5_000, 1_000]);
    expect(result.weeks[1]!.heightPercent).toBe(100);
  });

  it('o valor diário respeita os dias restantes do mês', () => {
    const result = calculateBudget({
      ...base,
      month: '2026-09',
      today: new Date('2026-09-20T12:00:00Z'),
    });
    expect(result.daysLeft).toBe(10);
    expect(result.dailyAllowanceCents).toBe(Math.floor(result.leftoverCents / 10));
  });
});

describe('projectDebts', () => {
  it('detecta o mês em que uma parcela acaba e sobra dinheiro', () => {
    const result = projectDebts(
      [
        { installmentCents: 43_000, paidInstallments: 34, totalInstallments: 36 }, // acaba em 2 meses
        { installmentCents: 64_000, paidInstallments: 3, totalInstallments: 8 },
      ],
      '2026-09',
    );

    expect(result.monthlyTotalCents).toBe(107_000);
    expect(result.months).toHaveLength(6);
    expect(result.months[0]!.totalCents).toBe(107_000);
    expect(result.months[2]!.totalCents).toBe(64_000);
    expect(result.note).toContain('a mais no seu bolso');
  });

  it('reconhece quando não há parcelas em aberto', () => {
    const result = projectDebts([], '2026-09');
    expect(result.monthlyTotalCents).toBe(0);
    expect(result.note).toContain('não tem parcelas');
  });

  it('vira o ano corretamente na projeção', () => {
    const result = projectDebts(
      [{ installmentCents: 10_000, paidInstallments: 0, totalInstallments: 24 }],
      '2026-11',
    );
    expect(result.months.map((entry) => entry.month)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
    ]);
  });
});
