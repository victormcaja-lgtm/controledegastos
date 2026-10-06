import {
  addMonths,
  isoDateFromMonthDay,
  monthRefFromISODate,
  toMonthRef,
  type Cashflow,
  type CashflowQuery,
  type OverdueBill,
  type SimulatePurchaseRequest,
  type SimulationResult,
} from '@grana/shared';
import { BusinessRuleError, NotFoundError } from '../../../shared/domain/errors.js';
import { buildInvoices, installmentsOf, splitInstallments } from '../domain/card.calculator.js';
import {
  buildVerdict,
  findOverdueBills,
  formatShortDate,
  projectCashFlow,
  type CashflowInput,
} from '../domain/cashflow.calculator.js';
import type {
  BillRepository,
  CardRecord,
  CardRepository,
  GoalRepository,
  IncomeRepository,
  SettingsRepository,
  TransactionRepository,
} from '../domain/ports.js';
import { toISODate } from '../infra/finance.mappers.js';

/** "Hoje" em UTC, quando o cliente não manda o dele. */
export function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseISODate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

type LoadedInput =
  | { configured: false }
  | { configured: true; input: CashflowInput; cards: CardRecord[] };

/**
 * Junta o dado de seis agregados no formato que `projectCashFlow` entende.
 * A regra fica no domínio; aqui é só leitura e tradução.
 */
export class CashflowInputLoader {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly bills: BillRepository,
    private readonly incomes: IncomeRepository,
    private readonly cards: CardRepository,
    private readonly goals: GoalRepository,
    private readonly settings: SettingsRepository,
  ) {}

  async load(userId: string, today: string): Promise<LoadedInput> {
    const settings = await this.settings.get(userId);
    if (!settings.openingDate) return { configured: false };

    const openingDate = settings.openingDate;
    const openingMonth = monthRefFromISODate(openingDate);
    // Lançamentos futuros (agendados) também entram — por isso o teto bem à frente.
    const until = parseISODate(isoDateFromMonthDay(addMonths(monthRefFromISODate(today), 14), 1));

    const [transactions, bills, payments, incomes, cards, purchases, deposits, average] =
      await Promise.all([
        this.transactions.listBetween(userId, parseISODate(openingDate), until),
        this.bills.listActive(userId),
        this.bills.paymentsSince(userId, openingMonth),
        this.incomes.listActive(userId),
        this.cards.listByUser(userId),
        this.cards.listPurchases(userId),
        this.goals.depositsSince(userId, parseISODate(openingDate)),
        settings.dailyBudgetCents === null
          ? this.transactions.averageDailyExpense(userId, parseISODate(today), 90)
          : Promise.resolve(settings.dailyBudgetCents),
      ]);

    const input: CashflowInput = {
      today,
      openingDate,
      openingBalanceCents: settings.openingBalanceCents,
      transactions: transactions.map((transaction) => ({
        id: transaction.id,
        date: toISODate(transaction.occurredOn),
        type: transaction.type,
        amountCents: transaction.amountCents,
        label: transaction.note ?? transaction.category.name,
      })),
      incomes: incomes.map((income) => ({
        id: income.id,
        name: income.name,
        amountCents: income.amountCents,
        receiptDay: income.receiptDay,
      })),
      bills: bills.map((bill) => ({
        id: bill.id,
        name: bill.name,
        amountCents: bill.amountCents,
        dueDay: bill.dueDay,
        startMonth: toMonthRef(bill.startMonth),
        totalInstallments: bill.totalInstallments,
      })),
      billPayments: payments.map((payment) => ({
        billId: payment.billId,
        month: payment.month,
        status: payment.status,
        amountCents: payment.amountCents,
        paidOn: toISODate(payment.paidAt),
      })),
      cardInvoices: cards.flatMap((card) =>
        buildInvoices(
          card,
          purchases
            .filter((purchase) => purchase.cardId === card.id)
            .map((purchase) => ({
              id: purchase.id,
              amountCents: purchase.amountCents,
              installments: purchase.installments,
              purchasedOn: toISODate(purchase.purchasedOn),
            })),
          today,
        ).map((invoice) => ({
          cardId: card.id,
          cardName: card.name,
          month: invoice.month,
          dueDate: invoice.dueDate,
          totalCents: invoice.totalCents,
        })),
      ),
      goalDeposits: deposits.map((deposit) => ({
        goalId: deposit.goalId,
        goalName: deposit.goalName,
        date: toISODate(deposit.createdAt),
        amountCents: deposit.amountCents,
      })),
      dailyAverageCents: average,
    };

    return { configured: true, input, cards };
  }
}

function emptyCashflow(from: string, to: string, today: string): Cashflow {
  return {
    configured: false,
    today,
    openingDate: null,
    from,
    to,
    todayBalanceCents: 0,
    endOfMonthCents: 0,
    lowest: null,
    firstNegativeDate: null,
    dailyAverageCents: 0,
    overdueBills: [],
    days: [],
    months: [],
  };
}

export class GetCashflowUseCase {
  constructor(private readonly loader: CashflowInputLoader) {}

  async execute(userId: string, query: CashflowQuery): Promise<Cashflow> {
    const today = query.today ?? serverToday();
    const loaded = await this.loader.load(userId, today);
    if (!loaded.configured) return emptyCashflow(query.from, query.to, today);
    return projectCashFlow(loaded.input, query.from, query.to);
  }
}

/**
 * "Posso comprar?": projeta duas vezes — sem e com a compra — e responde em
 * uma frase. Nada é gravado.
 */
export class SimulatePurchaseUseCase {
  constructor(private readonly loader: CashflowInputLoader) {}

  async execute(userId: string, request: SimulatePurchaseRequest): Promise<SimulationResult> {
    const today = request.today ?? serverToday();
    const loaded = await this.loader.load(userId, today);
    if (!loaded.configured) {
      throw new BusinessRuleError('Informe seu saldo atual na tela inicial antes de simular.');
    }

    let extraEvents: NonNullable<CashflowInput['extraEvents']>;

    if (request.method === 'CARD') {
      const card = loaded.cards.find((item) => item.id === request.cardId);
      if (!card) throw new NotFoundError('Cartão');
      extraEvents = installmentsOf(card, {
        id: 'simulacao',
        amountCents: request.amountCents,
        installments: request.installments,
        purchasedOn: request.date,
      }).map((installment) => ({
        date: installment.dueDate,
        label: `Compra simulada · ${card.name}${
          installment.installments > 1 ? ` ${installment.number}/${installment.installments}` : ''
        } (fatura ${formatShortDate(installment.dueDate)})`,
        amountCents: installment.amountCents,
      }));
    } else {
      const startMonth = monthRefFromISODate(request.date);
      const day = Number(request.date.slice(8, 10));
      extraEvents = splitInstallments(request.amountCents, request.installments).map(
        (amount, index) => ({
          date: isoDateFromMonthDay(addMonths(startMonth, index), day),
          label:
            request.installments > 1
              ? `Compra simulada ${index + 1}/${request.installments}`
              : 'Compra simulada',
          amountCents: amount,
        }),
      );
    }

    const before = projectCashFlow(loaded.input, request.from, request.to);
    const after = projectCashFlow({ ...loaded.input, extraEvents }, request.from, request.to);
    return { before, after, ...buildVerdict(before, after) };
  }
}

export class GetOverdueBillsUseCase {
  constructor(private readonly loader: CashflowInputLoader) {}

  async execute(userId: string, today: string = serverToday()): Promise<OverdueBill[]> {
    const loaded = await this.loader.load(userId, today);
    if (!loaded.configured) return [];
    return findOverdueBills(loaded.input);
  }
}
