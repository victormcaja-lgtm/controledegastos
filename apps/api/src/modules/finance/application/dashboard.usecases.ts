import {
  currentMonthRef,
  formatMoney,
  isoDateFromMonthDay,
  monthLabel,
  percentOf,
  type CategoryReport,
  type DashboardSummary,
  type MonthRef,
  type SettingsDTO,
  type UpdateSettingsRequest,
} from '@grana/shared';
import { calculateBudget } from '../domain/budget.calculator.js';
import type {
  BillRepository,
  IncomeRepository,
  SettingsRepository,
  TransactionRepository,
} from '../domain/ports.js';

/**
 * Este caso de uso é o coração da tela inicial. Ele reúne o dado de quatro
 * agregados e delega TODO o cálculo para `calculateBudget` — a orquestração
 * fica aqui, a regra fica no domínio.
 */
export class GetDashboardSummaryUseCase {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly bills: BillRepository,
    private readonly incomes: IncomeRepository,
  ) {}

  async execute(userId: string, month: MonthRef = currentMonthRef()): Promise<DashboardSummary> {
    const [monthTransactions, activeBills, payments, incomes, average] = await Promise.all([
      this.transactions.listForMonth(userId, month),
      this.bills.listActive(userId),
      this.bills.paymentsForMonth(userId, month),
      this.incomes.listActive(userId),
      this.transactions.averageMonthlyExpense(userId, 3),
    ]);

    const paidBillIds = new Set(payments.map((payment) => payment.billId));

    const budget = calculateBudget({
      month,
      today: new Date(),
      incomeCents: incomes.reduce((sum, income) => sum + income.amountCents, 0),
      extraIncomeCents: monthTransactions
        .filter((transaction) => transaction.type === 'INCOME')
        .reduce((sum, transaction) => sum + transaction.amountCents, 0),
      variableExpenses: monthTransactions
        .filter((transaction) => transaction.type === 'EXPENSE')
        .map((transaction) => ({
          day: transaction.occurredOn.getUTCDate(),
          amountCents: transaction.amountCents,
        })),
      bills: activeBills.map((bill) => ({
        amountCents: bill.amountCents,
        dueDay: bill.dueDay,
        paid: paidBillIds.has(bill.id),
      })),
      averageVariableCents: average,
    });

    const today = new Date();
    const currentDay = budget.isCurrentMonth ? today.getUTCDate() : 1;

    const upcomingBills = activeBills
      .filter((bill) => !paidBillIds.has(bill.id))
      .sort((a, b) => a.dueDay - b.dueDay)
      .slice(0, 3)
      .map((bill) => {
        const distance = bill.dueDay - currentDay;
        return {
          id: bill.id,
          name: bill.name,
          amountCents: bill.amountCents,
          dueDay: bill.dueDay,
          dueDate: isoDateFromMonthDay(month, bill.dueDay),
          whenLabel: !budget.isCurrentMonth
            ? `vence dia ${bill.dueDay}`
            : distance < 0
              ? `venceu há ${Math.abs(distance)} dia${Math.abs(distance) === 1 ? '' : 's'}`
              : distance === 0
                ? 'vence hoje'
                : `em ${distance} dia${distance === 1 ? '' : 's'}`,
        };
      });

    return { ...budget, upcomingBills };
  }
}

/**
 * Relatório por categoria: soma gastos variáveis + contas fixas da competência.
 * Ignorar as contas fixas aqui daria a impressão falsa de que o mercado é o
 * maior gasto do mês quando, na prática, o aluguel é.
 */
export class GetCategoryReportUseCase {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly bills: BillRepository,
  ) {}

  async execute(userId: string, month: MonthRef = currentMonthRef()): Promise<CategoryReport> {
    const [monthTransactions, activeBills, previousTransactions] = await Promise.all([
      this.transactions.listForMonth(userId, month),
      this.bills.listActive(userId),
      this.transactions.listForMonth(userId, previousMonth(month)),
    ]);

    const totals = new Map<string, { name: string; color: string; totalCents: number }>();

    const add = (id: string, name: string, color: string, amountCents: number) => {
      const entry = totals.get(id) ?? { name, color, totalCents: 0 };
      entry.totalCents += amountCents;
      totals.set(id, entry);
    };

    for (const transaction of monthTransactions) {
      if (transaction.type !== 'EXPENSE') continue;
      add(
        transaction.category.id,
        transaction.category.name,
        transaction.category.color,
        transaction.amountCents,
      );
    }
    for (const bill of activeBills) {
      add(bill.category.id, bill.category.name, bill.category.color, bill.amountCents);
    }

    const sorted = [...totals.entries()].sort((a, b) => b[1].totalCents - a[1].totalCents);
    const grandTotal = sorted.reduce((sum, [, entry]) => sum + entry.totalCents, 0);
    const largest = sorted[0]?.[1].totalCents ?? 1;

    return {
      month,
      monthLabel: monthLabel(month),
      totalCents: grandTotal,
      items: sorted.map(([categoryId, entry]) => ({
        categoryId,
        name: entry.name,
        color: entry.color,
        totalCents: entry.totalCents,
        percent: percentOf(entry.totalCents, Math.max(grandTotal, 1)),
        relativeWidth: Math.max(3, percentOf(entry.totalCents, largest)),
      })),
      comparison: buildComparison(monthTransactions, previousTransactions),
    };
  }
}

function previousMonth(month: MonthRef): MonthRef {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const absolute = year * 12 + (monthNumber - 1) - 1;
  return `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}`;
}

/** Compara com o mês anterior e devolve a diferença mais relevante em uma frase. */
function buildComparison(
  current: Array<{ type: string; amountCents: number; category: { name: string } }>,
  previous: Array<{ type: string; amountCents: number; category: { name: string } }>,
): string {
  const sumByCategory = (
    items: Array<{ type: string; amountCents: number; category: { name: string } }>,
  ) => {
    const map = new Map<string, number>();
    for (const item of items) {
      if (item.type !== 'EXPENSE') continue;
      map.set(item.category.name, (map.get(item.category.name) ?? 0) + item.amountCents);
    }
    return map;
  };

  const currentTotals = sumByCategory(current);
  const previousTotals = sumByCategory(previous);
  if (previousTotals.size === 0) return 'Ainda não há mês anterior suficiente para comparar.';

  const deltas = [...new Set([...currentTotals.keys(), ...previousTotals.keys()])].map((name) => ({
    name,
    delta: (currentTotals.get(name) ?? 0) - (previousTotals.get(name) ?? 0),
  }));

  const worst = deltas.reduce((a, b) => (b.delta > a.delta ? b : a));
  const best = deltas.reduce((a, b) => (b.delta < a.delta ? b : a));

  if (worst.delta <= 0 && best.delta >= 0)
    return 'Seus gastos ficaram estáveis em relação ao mês passado.';
  if (best.delta < 0 && worst.delta > 0) {
    return `Você gastou ${formatMoney(Math.abs(best.delta))} a menos em ${best.name.toLowerCase()}, mas ${formatMoney(worst.delta)} a mais em ${worst.name.toLowerCase()}.`;
  }
  if (worst.delta > 0) {
    return `O maior aumento veio de ${worst.name.toLowerCase()}: ${formatMoney(worst.delta)} a mais que no mês passado.`;
  }
  return `Você economizou ${formatMoney(Math.abs(best.delta))} em ${best.name.toLowerCase()} em relação ao mês passado.`;
}

/* ───────────────────────────── Ajustes ──────────────────────────────── */

export class GetSettingsUseCase {
  constructor(private readonly settings: SettingsRepository) {}

  async execute(userId: string): Promise<SettingsDTO> {
    return this.settings.get(userId);
  }
}

export class UpdateSettingsUseCase {
  constructor(private readonly settings: SettingsRepository) {}

  async execute(userId: string, data: UpdateSettingsRequest): Promise<SettingsDTO> {
    return this.settings.update(userId, data);
  }
}
