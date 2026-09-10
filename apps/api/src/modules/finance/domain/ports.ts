import type { CategoryKind, EntryType, MonthRef } from '@grana/shared';

/* ──────────────────────────── Modelos de leitura ─────────────────────── */

export interface CategoryRecord {
  id: string;
  userId: string;
  name: string;
  color: string;
  kind: CategoryKind;
  isSystem: boolean;
  archivedAt: Date | null;
}

export interface TransactionRecord {
  id: string;
  userId: string;
  type: EntryType;
  amountCents: number;
  occurredOn: Date;
  note: string | null;
  createdAt: Date;
  category: Pick<CategoryRecord, 'id' | 'name' | 'color' | 'kind'>;
}

export interface BillRecord {
  id: string;
  userId: string;
  name: string;
  amountCents: number;
  dueDay: number;
  active: boolean;
  category: Pick<CategoryRecord, 'id' | 'name' | 'color' | 'kind'>;
}

export interface IncomeRecord {
  id: string;
  userId: string;
  name: string;
  amountCents: number;
  receiptDay: number;
  active: boolean;
}

export interface DebtRecord {
  id: string;
  userId: string;
  name: string;
  installmentCents: number;
  paidInstallments: number;
  totalInstallments: number;
}

export interface GoalRecord {
  id: string;
  userId: string;
  name: string;
  targetCents: number;
  savedCents: number;
  featured: boolean;
  deposits: Array<{ id: string; amountCents: number; createdAt: Date }>;
}

export interface SettingsRecord {
  overspendAlerts: boolean;
  weeklySummary: boolean;
  roundCents: boolean;
  autoDarkMode: boolean;
  showDailyAllowance: boolean;
}

/* ─────────────────────────────── Portas ──────────────────────────────── */

export interface CategoryRepository {
  listByUser(userId: string, options?: { includeArchived?: boolean }): Promise<CategoryRecord[]>;
  findById(userId: string, id: string): Promise<CategoryRecord | null>;
  findByName(userId: string, name: string, kind: CategoryKind): Promise<CategoryRecord | null>;
  create(data: {
    userId: string;
    name: string;
    color: string;
    kind: CategoryKind;
  }): Promise<CategoryRecord>;
  update(
    userId: string,
    id: string,
    data: { name?: string; color?: string; archivedAt?: Date | null },
  ): Promise<CategoryRecord>;
  delete(userId: string, id: string): Promise<void>;
  countUsages(userId: string, id: string): Promise<number>;
}

export interface TransactionRepository {
  list(params: {
    userId: string;
    month?: MonthRef | undefined;
    categoryId?: string | undefined;
    type?: EntryType | undefined;
    search?: string | undefined;
    page: number;
    perPage: number;
  }): Promise<{ items: TransactionRecord[]; total: number }>;
  listForMonth(userId: string, month: MonthRef): Promise<TransactionRecord[]>;
  findById(userId: string, id: string): Promise<TransactionRecord | null>;
  create(data: {
    userId: string;
    categoryId: string;
    type: EntryType;
    amountCents: number;
    occurredOn: Date;
    note?: string | null;
    billId?: string | null;
  }): Promise<TransactionRecord>;
  update(
    userId: string,
    id: string,
    data: {
      categoryId?: string;
      amountCents?: number;
      occurredOn?: Date;
      note?: string | null;
    },
  ): Promise<TransactionRecord>;
  delete(userId: string, id: string): Promise<void>;
  /** Média mensal de gasto variável dos últimos `months` meses fechados. */
  averageMonthlyExpense(userId: string, months: number): Promise<number>;
}

export interface BillRepository {
  listActive(userId: string): Promise<BillRecord[]>;
  listAll(userId: string): Promise<BillRecord[]>;
  findById(userId: string, id: string): Promise<BillRecord | null>;
  create(data: {
    userId: string;
    categoryId: string;
    name: string;
    amountCents: number;
    dueDay: number;
  }): Promise<BillRecord>;
  update(
    userId: string,
    id: string,
    data: {
      categoryId?: string;
      name?: string;
      amountCents?: number;
      dueDay?: number;
      active?: boolean;
    },
  ): Promise<BillRecord>;
  delete(userId: string, id: string): Promise<void>;
  paymentsForMonth(
    userId: string,
    month: MonthRef,
  ): Promise<Array<{ billId: string; amountCents: number; paidAt: Date }>>;
  markPaid(params: {
    userId: string;
    billId: string;
    month: MonthRef;
    amountCents: number;
  }): Promise<void>;
  markUnpaid(userId: string, billId: string, month: MonthRef): Promise<void>;
}

export interface IncomeRepository {
  listActive(userId: string): Promise<IncomeRecord[]>;
  listAll(userId: string): Promise<IncomeRecord[]>;
  findById(userId: string, id: string): Promise<IncomeRecord | null>;
  create(data: {
    userId: string;
    name: string;
    amountCents: number;
    receiptDay: number;
  }): Promise<IncomeRecord>;
  update(
    userId: string,
    id: string,
    data: { name?: string; amountCents?: number; receiptDay?: number; active?: boolean },
  ): Promise<IncomeRecord>;
  delete(userId: string, id: string): Promise<void>;
}

export interface DebtRepository {
  listByUser(userId: string): Promise<DebtRecord[]>;
  findById(userId: string, id: string): Promise<DebtRecord | null>;
  create(data: {
    userId: string;
    name: string;
    installmentCents: number;
    paidInstallments: number;
    totalInstallments: number;
  }): Promise<DebtRecord>;
  update(
    userId: string,
    id: string,
    data: {
      name?: string;
      installmentCents?: number;
      paidInstallments?: number;
      totalInstallments?: number;
    },
  ): Promise<DebtRecord>;
  delete(userId: string, id: string): Promise<void>;
}

export interface GoalRepository {
  listByUser(userId: string): Promise<GoalRecord[]>;
  findById(userId: string, id: string): Promise<GoalRecord | null>;
  create(data: {
    userId: string;
    name: string;
    targetCents: number;
    savedCents: number;
    featured: boolean;
  }): Promise<GoalRecord>;
  update(
    userId: string,
    id: string,
    data: { name?: string; targetCents?: number; savedCents?: number; featured?: boolean },
  ): Promise<GoalRecord>;
  delete(userId: string, id: string): Promise<void>;
  addDeposit(userId: string, goalId: string, amountCents: number): Promise<GoalRecord>;
  clearFeatured(userId: string, exceptGoalId: string): Promise<void>;
}

export interface SettingsRepository {
  get(userId: string): Promise<SettingsRecord>;
  update(userId: string, data: Partial<SettingsRecord>): Promise<SettingsRecord>;
}
