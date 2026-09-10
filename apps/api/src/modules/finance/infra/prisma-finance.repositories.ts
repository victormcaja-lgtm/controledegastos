import type { Prisma, PrismaClient } from '../../../shared/infra/database/client.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import { monthEnd, monthStart, type MonthRef } from '@grana/shared';
import type {
  BillRecord,
  BillRepository,
  CategoryRecord,
  CategoryRepository,
  DebtRecord,
  DebtRepository,
  GoalRecord,
  GoalRepository,
  IncomeRecord,
  IncomeRepository,
  SettingsRecord,
  SettingsRepository,
  TransactionRecord,
  TransactionRepository,
} from '../domain/ports.js';

/**
 * Implementações Prisma das portas do domínio financeiro.
 *
 * Regra de ouro deste arquivo: TODA consulta filtra por `userId`. O isolamento
 * multiusuário não pode depender de quem chama lembrar de passar o filtro — ele
 * está embutido na assinatura de cada método.
 */

const CATEGORY_SELECT = { id: true, name: true, color: true, kind: true } as const;

/* ─────────────────────────── Categorias ─────────────────────────────── */

export class PrismaCategoryRepository implements CategoryRepository {
  constructor(private readonly db: PrismaClient) {}

  async listByUser(userId: string, options?: { includeArchived?: boolean }) {
    return this.db.category.findMany({
      where: { userId, ...(options?.includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    }) as Promise<CategoryRecord[]>;
  }

  async findById(userId: string, id: string) {
    return this.db.category.findFirst({ where: { id, userId } }) as Promise<CategoryRecord | null>;
  }

  async findByName(userId: string, name: string, kind: CategoryRecord['kind']) {
    return this.db.category.findFirst({
      where: { userId, kind, name: { equals: name, mode: 'insensitive' } },
    }) as Promise<CategoryRecord | null>;
  }

  async create(data: {
    userId: string;
    name: string;
    color: string;
    kind: CategoryRecord['kind'];
  }) {
    return this.db.category.create({ data }) as Promise<CategoryRecord>;
  }

  async update(
    userId: string,
    id: string,
    data: { name?: string; color?: string; archivedAt?: Date | null },
  ) {
    const result = await this.db.category.updateMany({ where: { id, userId }, data });
    if (result.count === 0) throw new NotFoundError('Categoria');
    return (await this.findById(userId, id))!;
  }

  async delete(userId: string, id: string) {
    await this.db.category.deleteMany({ where: { id, userId } });
  }

  async countUsages(userId: string, id: string) {
    const [transactions, bills] = await this.db.$transaction([
      this.db.transaction.count({ where: { userId, categoryId: id } }),
      this.db.bill.count({ where: { userId, categoryId: id } }),
    ]);
    return transactions + bills;
  }
}

/* ─────────────────────────── Lançamentos ────────────────────────────── */

export class PrismaTransactionRepository implements TransactionRepository {
  constructor(private readonly db: PrismaClient) {}

  private where(params: {
    userId: string;
    month?: MonthRef | undefined;
    categoryId?: string | undefined;
    type?: TransactionRecord['type'] | undefined;
    search?: string | undefined;
  }): Prisma.TransactionWhereInput {
    return {
      userId: params.userId,
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.type ? { type: params.type } : {}),
      ...(params.search ? { note: { contains: params.search, mode: 'insensitive' } } : {}),
      ...(params.month
        ? { occurredOn: { gte: monthStart(params.month), lt: monthEnd(params.month) } }
        : {}),
    };
  }

  async list(params: {
    userId: string;
    month?: MonthRef | undefined;
    categoryId?: string | undefined;
    type?: TransactionRecord['type'] | undefined;
    search?: string | undefined;
    page: number;
    perPage: number;
  }) {
    const where = this.where(params);
    const [items, total] = await this.db.$transaction([
      this.db.transaction.findMany({
        where,
        include: { category: { select: CATEGORY_SELECT } },
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        skip: (params.page - 1) * params.perPage,
        take: params.perPage,
      }),
      this.db.transaction.count({ where }),
    ]);
    return { items: items as unknown as TransactionRecord[], total };
  }

  async listForMonth(userId: string, month: MonthRef) {
    const items = await this.db.transaction.findMany({
      where: this.where({ userId, month }),
      include: { category: { select: CATEGORY_SELECT } },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
    });
    return items as unknown as TransactionRecord[];
  }

  async findById(userId: string, id: string) {
    const found = await this.db.transaction.findFirst({
      where: { id, userId },
      include: { category: { select: CATEGORY_SELECT } },
    });
    return (found as unknown as TransactionRecord) ?? null;
  }

  async create(data: {
    userId: string;
    categoryId: string;
    type: TransactionRecord['type'];
    amountCents: number;
    occurredOn: Date;
    note?: string | null;
    billId?: string | null;
  }) {
    const created = await this.db.transaction.create({
      data: {
        userId: data.userId,
        categoryId: data.categoryId,
        type: data.type,
        amountCents: data.amountCents,
        occurredOn: data.occurredOn,
        note: data.note ?? null,
        billId: data.billId ?? null,
      },
      include: { category: { select: CATEGORY_SELECT } },
    });
    return created as unknown as TransactionRecord;
  }

  async update(
    userId: string,
    id: string,
    data: { categoryId?: string; amountCents?: number; occurredOn?: Date; note?: string | null },
  ) {
    const result = await this.db.transaction.updateMany({ where: { id, userId }, data });
    if (result.count === 0) throw new NotFoundError('Lançamento');
    return (await this.findById(userId, id))!;
  }

  async delete(userId: string, id: string) {
    await this.db.transaction.deleteMany({ where: { id, userId } });
  }

  async averageMonthlyExpense(userId: string, months: number): Promise<number> {
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
    const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const aggregate = await this.db.transaction.aggregate({
      where: { userId, type: 'EXPENSE', occurredOn: { gte: since, lt: until } },
      _sum: { amountCents: true },
    });

    return Math.round((aggregate._sum.amountCents ?? 0) / months);
  }
}

/* ─────────────────────────── Contas fixas ───────────────────────────── */

export class PrismaBillRepository implements BillRepository {
  constructor(private readonly db: PrismaClient) {}

  async listActive(userId: string) {
    const items = await this.db.bill.findMany({
      where: { userId, active: true },
      include: { category: { select: CATEGORY_SELECT } },
      orderBy: { dueDay: 'asc' },
    });
    return items as unknown as BillRecord[];
  }

  async listAll(userId: string) {
    const items = await this.db.bill.findMany({
      where: { userId },
      include: { category: { select: CATEGORY_SELECT } },
      orderBy: [{ active: 'desc' }, { dueDay: 'asc' }],
    });
    return items as unknown as BillRecord[];
  }

  async findById(userId: string, id: string) {
    const found = await this.db.bill.findFirst({
      where: { id, userId },
      include: { category: { select: CATEGORY_SELECT } },
    });
    return (found as unknown as BillRecord) ?? null;
  }

  async create(data: {
    userId: string;
    categoryId: string;
    name: string;
    amountCents: number;
    dueDay: number;
  }) {
    const created = await this.db.bill.create({
      data,
      include: { category: { select: CATEGORY_SELECT } },
    });
    return created as unknown as BillRecord;
  }

  async update(
    userId: string,
    id: string,
    data: {
      categoryId?: string;
      name?: string;
      amountCents?: number;
      dueDay?: number;
      active?: boolean;
    },
  ) {
    const result = await this.db.bill.updateMany({ where: { id, userId }, data });
    if (result.count === 0) throw new NotFoundError('Conta');
    return (await this.findById(userId, id))!;
  }

  async delete(userId: string, id: string) {
    await this.db.bill.deleteMany({ where: { id, userId } });
  }

  async paymentsForMonth(userId: string, month: MonthRef) {
    const payments = await this.db.billPayment.findMany({
      where: { userId, referenceMonth: monthStart(month) },
      select: { billId: true, amountCents: true, paidAt: true },
    });
    return payments;
  }

  async markPaid(params: { userId: string; billId: string; month: MonthRef; amountCents: number }) {
    const referenceMonth = monthStart(params.month);
    // upsert torna a operação idempotente: clicar duas vezes não duplica a baixa.
    await this.db.billPayment.upsert({
      where: { billId_referenceMonth: { billId: params.billId, referenceMonth } },
      create: {
        billId: params.billId,
        userId: params.userId,
        referenceMonth,
        amountCents: params.amountCents,
      },
      update: { amountCents: params.amountCents, paidAt: new Date() },
    });
  }

  async markUnpaid(userId: string, billId: string, month: MonthRef) {
    await this.db.billPayment.deleteMany({
      where: { userId, billId, referenceMonth: monthStart(month) },
    });
  }
}

/* ───────────────────────────── Entradas ─────────────────────────────── */

export class PrismaIncomeRepository implements IncomeRepository {
  constructor(private readonly db: PrismaClient) {}

  async listActive(userId: string) {
    return this.db.income.findMany({
      where: { userId, active: true },
      orderBy: { receiptDay: 'asc' },
    }) as Promise<IncomeRecord[]>;
  }

  async listAll(userId: string) {
    return this.db.income.findMany({
      where: { userId },
      orderBy: [{ active: 'desc' }, { receiptDay: 'asc' }],
    }) as Promise<IncomeRecord[]>;
  }

  async findById(userId: string, id: string) {
    return this.db.income.findFirst({ where: { id, userId } }) as Promise<IncomeRecord | null>;
  }

  async create(data: { userId: string; name: string; amountCents: number; receiptDay: number }) {
    return this.db.income.create({ data }) as Promise<IncomeRecord>;
  }

  async update(
    userId: string,
    id: string,
    data: { name?: string; amountCents?: number; receiptDay?: number; active?: boolean },
  ) {
    const result = await this.db.income.updateMany({ where: { id, userId }, data });
    if (result.count === 0) throw new NotFoundError('Entrada');
    return (await this.findById(userId, id))!;
  }

  async delete(userId: string, id: string) {
    await this.db.income.deleteMany({ where: { id, userId } });
  }
}

/* ───────────────────────────── Dívidas ──────────────────────────────── */

export class PrismaDebtRepository implements DebtRepository {
  constructor(private readonly db: PrismaClient) {}

  async listByUser(userId: string) {
    return this.db.debt.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }) as Promise<DebtRecord[]>;
  }

  async findById(userId: string, id: string) {
    return this.db.debt.findFirst({ where: { id, userId } }) as Promise<DebtRecord | null>;
  }

  async create(data: {
    userId: string;
    name: string;
    installmentCents: number;
    paidInstallments: number;
    totalInstallments: number;
  }) {
    return this.db.debt.create({ data }) as Promise<DebtRecord>;
  }

  async update(
    userId: string,
    id: string,
    data: {
      name?: string;
      installmentCents?: number;
      paidInstallments?: number;
      totalInstallments?: number;
    },
  ) {
    const result = await this.db.debt.updateMany({ where: { id, userId }, data });
    if (result.count === 0) throw new NotFoundError('Dívida');
    return (await this.findById(userId, id))!;
  }

  async delete(userId: string, id: string) {
    await this.db.debt.deleteMany({ where: { id, userId } });
  }
}

/* ────────────────────────────── Metas ───────────────────────────────── */

const GOAL_INCLUDE = {
  deposits: {
    select: { id: true, amountCents: true, createdAt: true },
    orderBy: { createdAt: 'desc' as const },
    take: 10,
  },
} as const;

export class PrismaGoalRepository implements GoalRepository {
  constructor(private readonly db: PrismaClient) {}

  async listByUser(userId: string) {
    const items = await this.db.goal.findMany({
      where: { userId },
      include: GOAL_INCLUDE,
      orderBy: [{ featured: 'desc' }, { createdAt: 'asc' }],
    });
    return items as unknown as GoalRecord[];
  }

  async findById(userId: string, id: string) {
    const found = await this.db.goal.findFirst({ where: { id, userId }, include: GOAL_INCLUDE });
    return (found as unknown as GoalRecord) ?? null;
  }

  async create(data: {
    userId: string;
    name: string;
    targetCents: number;
    savedCents: number;
    featured: boolean;
  }) {
    const created = await this.db.goal.create({ data, include: GOAL_INCLUDE });
    return created as unknown as GoalRecord;
  }

  async update(
    userId: string,
    id: string,
    data: { name?: string; targetCents?: number; savedCents?: number; featured?: boolean },
  ) {
    const result = await this.db.goal.updateMany({ where: { id, userId }, data });
    if (result.count === 0) throw new NotFoundError('Meta');
    return (await this.findById(userId, id))!;
  }

  async delete(userId: string, id: string) {
    await this.db.goal.deleteMany({ where: { id, userId } });
  }

  /**
   * Depósito e saldo mudam juntos ou não mudam: transação. Sem isso, uma falha
   * entre as duas escritas deixaria o saldo divergente do extrato.
   */
  async addDeposit(userId: string, goalId: string, amountCents: number) {
    await this.db.$transaction([
      this.db.goalDeposit.create({ data: { goalId, amountCents } }),
      this.db.goal.updateMany({
        where: { id: goalId, userId },
        data: { savedCents: { increment: amountCents } },
      }),
    ]);
    return (await this.findById(userId, goalId))!;
  }

  async clearFeatured(userId: string, exceptGoalId: string) {
    await this.db.goal.updateMany({
      where: { userId, featured: true, NOT: { id: exceptGoalId } },
      data: { featured: false },
    });
  }
}

/* ───────────────────────────── Ajustes ──────────────────────────────── */

const DEFAULT_SETTINGS: SettingsRecord = {
  overspendAlerts: true,
  weeklySummary: true,
  roundCents: false,
  autoDarkMode: false,
  showDailyAllowance: true,
};

export class PrismaSettingsRepository implements SettingsRepository {
  constructor(private readonly db: PrismaClient) {}

  async get(userId: string): Promise<SettingsRecord> {
    const found = await this.db.userSettings.findUnique({ where: { userId } });
    if (!found) return { ...DEFAULT_SETTINGS };
    return {
      overspendAlerts: found.overspendAlerts,
      weeklySummary: found.weeklySummary,
      roundCents: found.roundCents,
      autoDarkMode: found.autoDarkMode,
      showDailyAllowance: found.showDailyAllowance,
    };
  }

  async update(userId: string, data: Partial<SettingsRecord>): Promise<SettingsRecord> {
    const saved = await this.db.userSettings.upsert({
      where: { userId },
      create: { userId, ...DEFAULT_SETTINGS, ...data },
      update: data,
    });
    return {
      overspendAlerts: saved.overspendAlerts,
      weeklySummary: saved.weeklySummary,
      roundCents: saved.roundCents,
      autoDarkMode: saved.autoDarkMode,
      showDailyAllowance: saved.showDailyAllowance,
    };
  }
}
