import {
  addMonths,
  isoDateFromMonthDay,
  monthRefFromISODate,
  type InvoiceSummary,
  type MonthRef,
} from '@grana/shared';

/**
 * Regras de fatura de cartão de crédito. Funções puras, sem banco.
 *
 * - Compra feita ANTES do dia de fechamento cai na fatura que fecha no mesmo mês;
 *   no dia do fechamento ou depois, cai na fatura seguinte.
 * - A fatura vence no mesmo mês do fechamento se o dia de vencimento for depois
 *   do fechamento; senão, no mês seguinte.
 * - Parcelada: a parcela N cai N−1 faturas depois da primeira. O centavo que
 *   sobra da divisão vai na primeira parcela, para a soma bater com o total.
 */

export interface CardLike {
  id: string;
  name: string;
  closingDay: number;
  dueDay: number;
}

export interface PurchaseLike {
  id: string;
  amountCents: number;
  installments: number;
  /** YYYY-MM-DD */
  purchasedOn: string;
}

export interface Installment {
  purchaseId: string;
  number: number;
  installments: number;
  amountCents: number;
  /** Competência (mês de fechamento) da fatura. */
  month: MonthRef;
  closingDate: string;
  dueDate: string;
}

export function closingDateOf(card: Pick<CardLike, 'closingDay'>, month: MonthRef): string {
  return isoDateFromMonthDay(month, card.closingDay);
}

export function dueDateOf(card: Pick<CardLike, 'closingDay' | 'dueDay'>, month: MonthRef): string {
  const dueMonth = card.dueDay > card.closingDay ? month : addMonths(month, 1);
  return isoDateFromMonthDay(dueMonth, card.dueDay);
}

/** Fatura (mês de fechamento) em que uma compra feita em `date` entra. */
export function invoiceMonthFor(card: Pick<CardLike, 'closingDay'>, date: string): MonthRef {
  const month = monthRefFromISODate(date);
  return date < closingDateOf(card, month) ? month : addMonths(month, 1);
}

/** Valor de cada parcela; a primeira absorve o resto da divisão. */
export function splitInstallments(amountCents: number, installments: number): number[] {
  const count = Math.max(1, installments);
  const base = Math.floor(amountCents / count);
  const remainder = amountCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index === 0 ? remainder : 0));
}

export function installmentsOf(card: CardLike, purchase: PurchaseLike): Installment[] {
  const firstMonth = invoiceMonthFor(card, purchase.purchasedOn);
  return splitInstallments(purchase.amountCents, purchase.installments).map((amount, index) => {
    const month = addMonths(firstMonth, index);
    return {
      purchaseId: purchase.id,
      number: index + 1,
      installments: purchase.installments,
      amountCents: amount,
      month,
      closingDate: closingDateOf(card, month),
      dueDate: dueDateOf(card, month),
    };
  });
}

export interface Invoice extends InvoiceSummary {
  cardId: string;
  cardName: string;
  items: Installment[];
}

function statusOf(
  card: Pick<CardLike, 'closingDay' | 'dueDay'>,
  month: MonthRef,
  today: string,
): InvoiceSummary['status'] {
  if (dueDateOf(card, month) < today) return 'PAST';
  if (closingDateOf(card, month) <= today) return 'CLOSED';
  return month === invoiceMonthFor(card, today) ? 'OPEN' : 'FUTURE';
}

/** Todas as faturas que têm pelo menos uma parcela, em ordem cronológica. */
export function buildInvoices(card: CardLike, purchases: PurchaseLike[], today: string): Invoice[] {
  const byMonth = new Map<MonthRef, Installment[]>();
  for (const purchase of purchases) {
    for (const installment of installmentsOf(card, purchase)) {
      const bucket = byMonth.get(installment.month);
      if (bucket) bucket.push(installment);
      else byMonth.set(installment.month, [installment]);
    }
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, items]) => {
      const closingDate = closingDateOf(card, month);
      const dueDate = dueDateOf(card, month);
      return {
        cardId: card.id,
        cardName: card.name,
        month,
        closingDate,
        dueDate,
        totalCents: items.reduce((sum, item) => sum + item.amountCents, 0),
        status: statusOf(card, month, today),
        items,
      };
    });
}

/** Uma fatura específica — vazia se não houver parcela naquele mês. */
export function invoiceFor(
  card: CardLike,
  purchases: PurchaseLike[],
  month: MonthRef,
  today: string,
): Invoice {
  const found = buildInvoices(card, purchases, today).find((invoice) => invoice.month === month);
  if (found) return found;
  const closingDate = closingDateOf(card, month);
  const dueDate = dueDateOf(card, month);
  return {
    cardId: card.id,
    cardName: card.name,
    month,
    closingDate,
    dueDate,
    totalCents: 0,
    status: statusOf(card, month, today),
    items: [],
  };
}

/** Fatura aberta hoje (a que recebe uma compra feita hoje). */
export function openInvoiceMonth(card: Pick<CardLike, 'closingDay'>, today: string): MonthRef {
  return invoiceMonthFor(card, today);
}
