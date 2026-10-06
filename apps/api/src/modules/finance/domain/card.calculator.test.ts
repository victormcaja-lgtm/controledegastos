import { describe, expect, it } from 'vitest';
import {
  buildInvoices,
  dueDateOf,
  installmentsOf,
  invoiceMonthFor,
  splitInstallments,
} from './card.calculator.js';

const card = { id: 'c1', name: 'Nubank', closingDay: 3, dueDay: 10 };

describe('fatura do cartão', () => {
  it('compra antes do fechamento cai na fatura do mês; no dia ou depois, na seguinte', () => {
    expect(invoiceMonthFor(card, '2026-10-02')).toBe('2026-10');
    expect(invoiceMonthFor(card, '2026-10-03')).toBe('2026-11');
    expect(invoiceMonthFor(card, '2026-12-25')).toBe('2027-01');
  });

  it('vencimento depois do fechamento é no mesmo mês; antes, no seguinte', () => {
    expect(dueDateOf(card, '2026-10')).toBe('2026-10-10');
    expect(dueDateOf({ closingDay: 25, dueDay: 5 }, '2026-10')).toBe('2026-11-05');
  });

  it('parcelas somam o total e o resto vai na primeira', () => {
    expect(splitInstallments(10_000, 3)).toEqual([3_334, 3_333, 3_333]);
  });

  it('parcelada espalha uma parcela por fatura', () => {
    const items = installmentsOf(card, {
      id: 'p1',
      amountCents: 30_000,
      installments: 3,
      purchasedOn: '2026-10-05',
    });
    expect(items.map((i) => [i.month, i.dueDate, i.amountCents])).toEqual([
      ['2026-11', '2026-11-10', 10_000],
      ['2026-12', '2026-12-10', 10_000],
      ['2027-01', '2027-01-10', 10_000],
    ]);
  });

  it('agrupa as parcelas por fatura e marca o status', () => {
    const invoices = buildInvoices(
      card,
      [
        { id: 'p1', amountCents: 20_000, installments: 2, purchasedOn: '2026-10-05' },
        { id: 'p2', amountCents: 5_000, installments: 1, purchasedOn: '2026-11-01' },
      ],
      '2026-11-05',
    );
    expect(invoices.map((i) => [i.month, i.totalCents, i.status])).toEqual([
      ['2026-11', 15_000, 'CLOSED'],
      ['2026-12', 10_000, 'OPEN'],
    ]);

    const later = buildInvoices(
      card,
      [{ id: 'p3', amountCents: 30_000, installments: 3, purchasedOn: '2026-10-05' }],
      '2026-10-05',
    );
    expect(later.map((i) => i.status)).toEqual(['OPEN', 'FUTURE', 'FUTURE']);
  });
});
