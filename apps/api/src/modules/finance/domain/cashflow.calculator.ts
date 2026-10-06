import {
  addMonths,
  daysInMonth,
  formatMoney,
  isoDateFromMonthDay,
  monthLabel,
  monthRefFromISODate,
  monthsBetween,
  type Cashflow,
  type CashflowDay,
  type CashflowEvent,
  type CashflowMonth,
  type MonthRef,
  type OverdueBill,
} from '@grana/shared';

/**
 * Serviço de domínio do SALDO FUTURO. Função pura: entra dado bruto, sai o rio
 * de dinheiro dia a dia. Nada de banco aqui.
 *
 * Regras (as mesmas de `docs/PLANO-SALDO-FUTURO.md`):
 *  • `openingBalanceCents` é o saldo no INÍCIO do dia `openingDate`; tudo antes
 *    dessa data já está embutido nele e é ignorado.
 *  • Até hoje vale o que aconteceu: lançamentos, contas pagas (no dia da baixa),
 *    entradas fixas e faturas (consideradas recebidas/pagas no dia).
 *  • Depois de hoje é previsão: entradas fixas, contas a vencer, faturas e o
 *    gasto médio diário.
 *  • Conta vencida e sem baixa é ATRASADA: entra como saída pendente hoje e
 *    continua lá, dia após dia, até ser paga ou dispensada ("não vou pagar").
 *  • Não existe "fechar o mês": o saldo de 31/10 é o ponto de partida de 01/11.
 */

export interface CashflowInput {
  /** YYYY-MM-DD */
  today: string;
  openingDate: string;
  openingBalanceCents: number;
  transactions: Array<{
    id: string;
    date: string;
    type: 'INCOME' | 'EXPENSE';
    amountCents: number;
    label: string;
  }>;
  incomes: Array<{ id: string; name: string; amountCents: number; receiptDay: number }>;
  /** Só contas ativas. */
  bills: BillScheduleInput[];
  billPayments: BillPaymentInput[];
  cardInvoices: Array<{
    cardId: string;
    cardName: string;
    month: MonthRef;
    dueDate: string;
    totalCents: number;
  }>;
  goalDeposits: Array<{ goalId: string; goalName: string; date: string; amountCents: number }>;
  dailyAverageCents: number;
  /** Eventos hipotéticos (compra simulada). */
  extraEvents?: Array<{ date: string; label: string; amountCents: number }>;
}

export interface BillScheduleInput {
  id: string;
  name: string;
  amountCents: number;
  dueDay: number;
  startMonth: MonthRef;
  totalInstallments: number | null;
}

export interface BillPaymentInput {
  billId: string;
  month: MonthRef;
  status: 'PAID' | 'WAIVED';
  amountCents: number;
  /** Dia em que a baixa foi feita. */
  paidOn: string;
}

/* ───────────────────────────── Datas ISO ────────────────────────────── */

const DAY_MS = 86_400_000;

export function addDaysISO(iso: string, amount: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + amount * DAY_MS).toISOString().slice(0, 10);
}

export function diffDaysISO(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function lastDayOfMonthISO(iso: string): string {
  const month = monthRefFromISODate(iso);
  return isoDateFromMonthDay(month, daysInMonth(month));
}

export function formatShortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function maxISO(...values: string[]): string {
  return values.reduce((a, b) => (b > a ? b : a));
}

/* ──────────────────────────── Contas fixas ──────────────────────────── */

function billLabel(bill: BillScheduleInput, month: MonthRef): string {
  if (bill.totalInstallments === null) return bill.name;
  return `${bill.name} ${monthsBetween(bill.startMonth, month) + 1}/${bill.totalInstallments}`;
}

/** Competências em que a conta vigora, a partir de `fromMonth` até `toMonth`. */
function billMonths(bill: BillScheduleInput, fromMonth: MonthRef, toMonth: MonthRef): MonthRef[] {
  const months: MonthRef[] = [];
  let month = bill.startMonth > fromMonth ? bill.startMonth : fromMonth;
  while (month <= toMonth) {
    if (bill.totalInstallments !== null) {
      const number = monthsBetween(bill.startMonth, month) + 1;
      if (number > bill.totalInstallments) break;
    }
    months.push(month);
    month = addMonths(month, 1);
  }
  return months;
}

function paymentKey(billId: string, month: MonthRef): string {
  return `${billId}|${month}`;
}

/**
 * Contas vencidas (vencimento antes de hoje e a partir do saldo inicial) que
 * não têm baixa nem dispensa. As mais antigas primeiro.
 */
export function findOverdueBills(input: {
  today: string;
  openingDate: string;
  bills: BillScheduleInput[];
  billPayments: BillPaymentInput[];
}): OverdueBill[] {
  const settled = new Set(input.billPayments.map((p) => paymentKey(p.billId, p.month)));
  const overdue: OverdueBill[] = [];
  const openingMonth = monthRefFromISODate(input.openingDate);
  const currentMonth = monthRefFromISODate(input.today);

  for (const bill of input.bills) {
    for (const month of billMonths(bill, openingMonth, currentMonth)) {
      const dueDate = isoDateFromMonthDay(month, bill.dueDay);
      if (dueDate < input.openingDate || dueDate >= input.today) continue;
      if (settled.has(paymentKey(bill.id, month))) continue;
      overdue.push({
        billId: bill.id,
        name: bill.name,
        month,
        dueDate,
        amountCents: bill.amountCents,
        daysLate: diffDaysISO(dueDate, input.today),
        installmentNumber:
          bill.totalInstallments === null ? null : monthsBetween(bill.startMonth, month) + 1,
        totalInstallments: bill.totalInstallments,
      });
    }
  }

  return overdue.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/* ─────────────────────────────── Projeção ───────────────────────────── */

export function projectCashFlow(input: CashflowInput, from: string, to: string): Cashflow {
  const { today, openingDate } = input;
  // Vai até o fim do mês de `to` (e do mês corrente) para o resumo mensal fechar.
  const end = maxISO(lastDayOfMonthISO(to), lastDayOfMonthISO(today), today);
  const openingMonth = monthRefFromISODate(openingDate);
  const endMonth = monthRefFromISODate(end);

  const eventsByDate = new Map<string, CashflowEvent[]>();
  const add = (date: string, event: CashflowEvent) => {
    if (date < openingDate || date > end) return;
    const bucket = eventsByDate.get(date);
    if (bucket) bucket.push(event);
    else eventsByDate.set(date, [event]);
  };

  for (const transaction of input.transactions) {
    add(transaction.date, {
      kind: 'TRANSACTION',
      label: transaction.label,
      amountCents:
        transaction.type === 'INCOME' ? transaction.amountCents : -transaction.amountCents,
      projected: transaction.date > today,
      refId: transaction.id,
      month: null,
    });
  }

  for (let month = openingMonth; month <= endMonth; month = addMonths(month, 1)) {
    for (const income of input.incomes) {
      const date = isoDateFromMonthDay(month, income.receiptDay);
      add(date, {
        kind: 'INCOME',
        label: income.name,
        amountCents: income.amountCents,
        projected: date > today,
        refId: income.id,
        month,
      });
    }
  }

  const payments = new Map(input.billPayments.map((p) => [paymentKey(p.billId, p.month), p]));
  const overdueBills = findOverdueBills(input);
  const overdueKeys = new Set(overdueBills.map((bill) => paymentKey(bill.billId, bill.month)));

  for (const bill of input.bills) {
    for (const month of billMonths(bill, openingMonth, endMonth)) {
      const dueDate = isoDateFromMonthDay(month, bill.dueDay);
      // Conta que venceu antes do saldo inicial já está embutida nele.
      if (dueDate < openingDate) continue;

      const payment = payments.get(paymentKey(bill.id, month));
      const label = billLabel(bill, month);

      if (payment) {
        if (payment.status === 'WAIVED') continue;
        add(payment.paidOn, {
          kind: 'BILL',
          label,
          amountCents: -payment.amountCents,
          projected: payment.paidOn > today,
          refId: bill.id,
          month,
        });
      } else if (overdueKeys.has(paymentKey(bill.id, month))) {
        add(today, {
          kind: 'BILL_OVERDUE',
          label: `${label} · atrasada desde ${formatShortDate(dueDate)}`,
          amountCents: -bill.amountCents,
          projected: true,
          refId: bill.id,
          month,
        });
      } else {
        add(dueDate, {
          kind: 'BILL',
          label,
          amountCents: -bill.amountCents,
          projected: true,
          refId: bill.id,
          month,
        });
      }
    }
  }

  for (const invoice of input.cardInvoices) {
    if (invoice.totalCents === 0) continue;
    add(invoice.dueDate, {
      kind: 'CARD_INVOICE',
      label: `Fatura ${invoice.cardName}`,
      amountCents: -invoice.totalCents,
      projected: invoice.dueDate >= today,
      refId: invoice.cardId,
      month: invoice.month,
    });
  }

  for (const deposit of input.goalDeposits) {
    add(deposit.date, {
      kind: 'GOAL_DEPOSIT',
      label: `Guardado em ${deposit.goalName}`,
      amountCents: -deposit.amountCents,
      projected: deposit.date > today,
      refId: deposit.goalId,
      month: null,
    });
  }

  for (const extra of input.extraEvents ?? []) {
    add(extra.date, {
      kind: 'SIMULATION',
      label: extra.label,
      amountCents: -extra.amountCents,
      projected: true,
      refId: null,
      month: null,
    });
  }

  if (input.dailyAverageCents > 0) {
    for (
      let date = addDaysISO(maxISO(today, addDaysISO(openingDate, -1)), 1);
      date <= end;
      date = addDaysISO(date, 1)
    ) {
      add(date, {
        kind: 'DAILY_AVERAGE',
        label: 'Gasto médio do dia',
        amountCents: -input.dailyAverageCents,
        projected: true,
        refId: null,
        month: null,
      });
    }
  }

  /* ── Caminha dia a dia acumulando o saldo ── */
  const allDays: CashflowDay[] = [];
  let balance = input.openingBalanceCents;
  let todayBalance = today < openingDate ? input.openingBalanceCents : 0;

  for (let date = openingDate; date <= end; date = addDaysISO(date, 1)) {
    const events = eventsByDate.get(date) ?? [];
    let inCents = 0;
    let outCents = 0;
    let realDelta = 0;
    for (const event of events) {
      if (event.amountCents >= 0) inCents += event.amountCents;
      else outCents -= event.amountCents;
      if (!event.projected) realDelta += event.amountCents;
    }

    if (date === today) todayBalance = balance + realDelta;
    balance += inCents - outCents;

    allDays.push({
      date,
      inCents,
      outCents,
      balanceCents: balance,
      projected: date > today,
      events,
    });
  }

  const visible = allDays.filter((day) => day.date >= from && day.date <= to);
  const ahead = allDays.filter((day) => day.date >= today && day.date <= to);

  const lowestDay = ahead.reduce<CashflowDay | null>(
    (lowest, day) => (lowest === null || day.balanceCents < lowest.balanceCents ? day : lowest),
    null,
  );
  const firstNegative = ahead.find((day) => day.balanceCents < 0) ?? null;
  const endOfMonthDay = allDays.find((day) => day.date === lastDayOfMonthISO(today));

  return {
    configured: true,
    today,
    openingDate,
    from,
    to,
    todayBalanceCents: todayBalance,
    endOfMonthCents: endOfMonthDay?.balanceCents ?? balance,
    lowest: lowestDay ? { date: lowestDay.date, balanceCents: lowestDay.balanceCents } : null,
    firstNegativeDate: firstNegative?.date ?? null,
    dailyAverageCents: input.dailyAverageCents,
    overdueBills,
    days: visible,
    months: summarizeMonths(allDays, input.openingBalanceCents, from, to, today),
  };
}

/** Resultado de cada mês que toca o intervalo pedido. */
export function summarizeMonths(
  days: CashflowDay[],
  openingBalanceCents: number,
  from: string,
  to: string,
  today: string,
): CashflowMonth[] {
  const fromMonth = monthRefFromISODate(from);
  const toMonth = monthRefFromISODate(to);
  const currentMonth = monthRefFromISODate(today);

  const byMonth = new Map<MonthRef, CashflowMonth>();
  let previousBalance = openingBalanceCents;

  for (const day of days) {
    const month = monthRefFromISODate(day.date);
    let summary = byMonth.get(month);
    if (!summary) {
      summary = {
        month,
        label: monthLabel(month),
        openingCents: previousBalance,
        inCents: 0,
        outCents: 0,
        savedCents: 0,
        resultCents: 0,
        closingCents: previousBalance,
        closed: month < currentMonth,
      };
      byMonth.set(month, summary);
    }

    for (const event of day.events) {
      if (event.kind === 'GOAL_DEPOSIT') summary.savedCents -= event.amountCents;
      else if (event.amountCents >= 0) summary.inCents += event.amountCents;
      else summary.outCents -= event.amountCents;
    }
    summary.resultCents = summary.inCents - summary.outCents;
    summary.closingCents = day.balanceCents;
    previousBalance = day.balanceCents;
  }

  return [...byMonth.values()].filter((m) => m.month >= fromMonth && m.month <= toMonth);
}

/* ─────────────────────────── Posso comprar? ─────────────────────────── */

export function buildVerdict(
  before: Cashflow,
  after: Cashflow,
): { verdict: string; fits: boolean } {
  const fits = after.firstNegativeDate === null;
  const lowestBefore = before.lowest?.balanceCents ?? before.todayBalanceCents;
  const lowestAfter = after.lowest;

  if (!lowestAfter) {
    return { verdict: 'Não há dias à frente no intervalo para comparar.', fits };
  }

  const drop = `Seu menor saldo vai de ${formatMoney(lowestBefore)} para ${formatMoney(
    lowestAfter.balanceCents,
  )} em ${formatShortDate(lowestAfter.date)}.`;

  if (!fits) {
    const alreadyNegative = before.firstNegativeDate !== null;
    return {
      verdict: alreadyNegative
        ? `${drop} Seu saldo já fica negativo sem essa compra — ela aumenta o buraco.`
        : `${drop} Atenção: com essa compra o saldo fica negativo em ${formatShortDate(
            after.firstNegativeDate!,
          )}.`,
      fits,
    };
  }

  return { verdict: `${drop} Cabe no seu saldo.`, fits };
}
