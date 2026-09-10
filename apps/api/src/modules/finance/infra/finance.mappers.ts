import {
  isoDateFromMonthDay,
  percentOf,
  type BillDTO,
  type CategoryDTO,
  type DebtDTO,
  type GoalDTO,
  type IncomeDTO,
  type MonthRef,
  type TransactionDTO,
} from '@grana/shared';
import type {
  BillRecord,
  CategoryRecord,
  DebtRecord,
  GoalRecord,
  IncomeRecord,
  TransactionRecord,
} from '../domain/ports.js';

/** Converte a data `@db.Date` do Postgres para `YYYY-MM-DD` sem sofrer com fuso. */
export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toCategoryDTO(record: CategoryRecord): CategoryDTO {
  return {
    id: record.id,
    name: record.name,
    color: record.color,
    kind: record.kind,
    isSystem: record.isSystem,
    archivedAt: record.archivedAt ? record.archivedAt.toISOString() : null,
  };
}

export function toTransactionDTO(record: TransactionRecord): TransactionDTO {
  return {
    id: record.id,
    type: record.type,
    amountCents: record.amountCents,
    occurredOn: toISODate(record.occurredOn),
    note: record.note,
    category: {
      id: record.category.id,
      name: record.category.name,
      color: record.category.color,
      kind: record.category.kind,
    },
    createdAt: record.createdAt.toISOString(),
  };
}

export function toBillDTO(
  record: BillRecord,
  month: MonthRef,
  payment: { paidAt: Date } | undefined,
): BillDTO {
  return {
    id: record.id,
    name: record.name,
    amountCents: record.amountCents,
    dueDay: record.dueDay,
    active: record.active,
    category: {
      id: record.category.id,
      name: record.category.name,
      color: record.category.color,
      kind: record.category.kind,
    },
    paid: payment !== undefined,
    paidAt: payment ? payment.paidAt.toISOString() : null,
    dueDate: isoDateFromMonthDay(month, record.dueDay),
  };
}

export function toIncomeDTO(record: IncomeRecord): IncomeDTO {
  return {
    id: record.id,
    name: record.name,
    amountCents: record.amountCents,
    receiptDay: record.receiptDay,
    active: record.active,
  };
}

export function toDebtDTO(record: DebtRecord): DebtDTO {
  const remainingInstallments = Math.max(0, record.totalInstallments - record.paidInstallments);
  return {
    id: record.id,
    name: record.name,
    installmentCents: record.installmentCents,
    paidInstallments: record.paidInstallments,
    totalInstallments: record.totalInstallments,
    remainingInstallments,
    remainingCents: remainingInstallments * record.installmentCents,
    progressPercent: percentOf(record.paidInstallments, record.totalInstallments),
    settled: remainingInstallments === 0,
  };
}

export function toGoalDTO(record: GoalRecord): GoalDTO {
  const remaining = Math.max(0, record.targetCents - record.savedCents);
  return {
    id: record.id,
    name: record.name,
    targetCents: record.targetCents,
    savedCents: record.savedCents,
    remainingCents: remaining,
    progressPercent: percentOf(record.savedCents, record.targetCents),
    achieved: remaining === 0,
    featured: record.featured,
    deposits: record.deposits.map((deposit) => ({
      id: deposit.id,
      amountCents: deposit.amountCents,
      createdAt: deposit.createdAt.toISOString(),
    })),
  };
}
