import {
  daysInMonth,
  formatMoney,
  monthLabel,
  monthNameShort,
  percentOf,
  weekIndexOfDay,
  type MonthRef,
} from '@grana/shared';

/**
 * Serviço de domínio: o CÉREBRO financeiro do app.
 *
 * Tudo aqui é função pura — entra dado bruto, sai o resumo. Sem banco, sem
 * Fastify, sem Prisma. É o pedaço mais valioso do sistema e por isso é o mais
 * fácil de testar: nenhuma regra depende de infraestrutura.
 */

export interface BudgetInput {
  month: MonthRef;
  today: Date;
  /** Soma das entradas fixas cadastradas (salário, freela...). */
  incomeCents: number;
  /** Entradas avulsas lançadas no mês. */
  extraIncomeCents: number;
  /** Gastos variáveis lançados no mês (não inclui contas fixas). */
  variableExpenses: Array<{ day: number; amountCents: number }>;
  /** Contas fixas ativas com o status de pagamento da competência. */
  bills: Array<{ amountCents: number; dueDay: number; paid: boolean }>;
  /** Média histórica de gasto variável, usada para projetar meses futuros. */
  averageVariableCents: number;
}

export interface WeekBar {
  index: number;
  label: string;
  totalCents: number;
  heightPercent: number;
  current: boolean;
}

export interface BudgetResult {
  month: MonthRef;
  monthLabel: string;
  isCurrentMonth: boolean;
  incomeCents: number;
  billsTotalCents: number;
  billsPaidCents: number;
  billsDueCents: number;
  variableSpentCents: number;
  spentCents: number;
  leftoverCents: number;
  dailyAllowanceCents: number;
  daysLeft: number;
  bars: { spentPercent: number; duePercent: number; leftoverPercent: number };
  weeks: WeekBar[];
  weekNote: string;
}

function toMonthRef(date: Date): MonthRef {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function calculateBudget(input: BudgetInput): BudgetResult {
  const currentMonth = toMonthRef(input.today);
  const isCurrentMonth = input.month === currentMonth;
  const isPast = input.month < currentMonth;
  const totalDays = daysInMonth(input.month);

  const income = input.incomeCents + input.extraIncomeCents;
  const variableSpent = input.variableExpenses.reduce((sum, item) => sum + item.amountCents, 0);

  const billsTotal = input.bills.reduce((sum, bill) => sum + bill.amountCents, 0);
  const billsPaid = input.bills
    .filter((bill) => bill.paid)
    .reduce((sum, bill) => sum + bill.amountCents, 0);
  const billsDue = billsTotal - billsPaid;

  // Meses passados e o mês corrente usam o que realmente aconteceu.
  // Meses futuros são PROJEÇÃO: contas fixas + média de gasto variável.
  const projectedVariable = isCurrentMonth || isPast ? variableSpent : input.averageVariableCents;
  const spent = billsPaid + variableSpent;
  const leftover = income - billsTotal - projectedVariable;

  const currentDay = isCurrentMonth ? input.today.getUTCDate() : totalDays;
  const daysLeft = Math.max(1, totalDays - currentDay);
  const dailyAllowance = Math.floor(Math.max(0, leftover) / daysLeft);

  const denominator = Math.max(income, 1);

  const weekTotals = [0, 0, 0, 0];
  for (const expense of input.variableExpenses) {
    weekTotals[weekIndexOfDay(expense.day)]! += expense.amountCents;
  }
  const maxWeek = Math.max(...weekTotals, 1);
  const currentWeek = weekIndexOfDay(currentDay);
  const weeks: WeekBar[] = weekTotals.map((total, index) => ({
    index,
    label: `S${index + 1}`,
    totalCents: total,
    heightPercent: Math.max(6, Math.round((total / maxWeek) * 100)),
    current: isCurrentMonth && index === currentWeek,
  }));

  const thisWeek = weekTotals[currentWeek] ?? 0;
  const previousWeek = currentWeek > 0 ? (weekTotals[currentWeek - 1] ?? 0) : 0;
  const weekNote =
    previousWeek === 0 && thisWeek === 0
      ? 'Ainda não há gastos suficientes nesta semana para comparar.'
      : thisWeek <= previousWeek
        ? `Boa — esta semana você gastou ${formatMoney(previousWeek - thisWeek)} a menos que a passada.`
        : `Esta semana está ${formatMoney(thisWeek - previousWeek)} acima da semana passada.`;

  return {
    month: input.month,
    monthLabel: monthLabel(input.month),
    isCurrentMonth,
    incomeCents: income,
    billsTotalCents: billsTotal,
    billsPaidCents: billsPaid,
    billsDueCents: billsDue,
    variableSpentCents: variableSpent,
    spentCents: spent,
    leftoverCents: leftover,
    dailyAllowanceCents: dailyAllowance,
    daysLeft,
    bars: {
      spentPercent: percentOf(spent, denominator),
      duePercent: percentOf(billsDue, denominator),
      leftoverPercent: percentOf(Math.max(0, leftover), denominator),
    },
    weeks,
    weekNote,
  };
}

/* ───────────────────────── Projeção de parcelas ─────────────────────── */

export interface DebtLike {
  installmentCents: number;
  paidInstallments: number;
  totalInstallments: number;
}

export interface DebtProjectionResult {
  months: Array<{ month: MonthRef; label: string; totalCents: number }>;
  note: string;
  monthlyTotalCents: number;
}

/**
 * Projeta quanto de parcela cai nos próximos N meses e detecta o primeiro mês
 * em que uma dívida termina — a informação que realmente muda o comportamento
 * de quem está endividado ("em março sobra X a mais").
 */
export function projectDebts(
  debts: DebtLike[],
  fromMonth: MonthRef,
  horizon = 6,
): DebtProjectionResult {
  const months: Array<{ month: MonthRef; label: string; totalCents: number }> = [];

  const addMonthsLocal = (month: MonthRef, amount: number): MonthRef => {
    const [year, monthNumber] = month.split('-').map(Number) as [number, number];
    const absolute = year * 12 + (monthNumber - 1) + amount;
    return `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}`;
  };

  for (let offset = 0; offset < horizon; offset += 1) {
    const month = addMonthsLocal(fromMonth, offset);
    const totalCents = debts.reduce(
      (sum, debt) =>
        sum + (debt.totalInstallments - debt.paidInstallments > offset ? debt.installmentCents : 0),
      0,
    );
    months.push({ month, label: monthNameShort(month), totalCents });
  }

  const first = months[0]?.totalCents ?? 0;
  const freeIndex = months.findIndex((entry) => entry.totalCents < first);
  const note =
    freeIndex > 0
      ? `Em ${monthLabel(months[freeIndex]!.month).toLowerCase()} sobram ${formatMoney(
          first - months[freeIndex]!.totalCents,
        )} a mais no seu bolso: uma parcela acaba.`
      : first === 0
        ? 'Você não tem parcelas em aberto. 👏'
        : 'As parcelas seguem iguais nos próximos meses.';

  return { months, note, monthlyTotalCents: first };
}
