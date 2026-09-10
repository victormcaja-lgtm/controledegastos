import { z } from 'zod';
import { categoryKindSchema, entryTypeSchema } from '../enums.js';
import {
  centsOrZeroSchema,
  centsSchema,
  colorSchema,
  dayOfMonthSchema,
  idSchema,
  isoDateSchema,
  monthRefSchema,
  nameSchema,
  noteSchema,
  paginationQuerySchema,
} from '../primitives.js';

/* ───────────────────────────── Categorias ───────────────────────────── */

export const categorySchema = z.object({
  id: idSchema,
  name: z.string(),
  color: z.string(),
  kind: categoryKindSchema,
  isSystem: z.boolean(),
  archivedAt: z.string().nullable(),
});
export type CategoryDTO = z.infer<typeof categorySchema>;

export const createCategoryRequestSchema = z.object({
  name: nameSchema,
  color: colorSchema.optional(),
  kind: categoryKindSchema.default('EXPENSE'),
});
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z
  .object({
    name: nameSchema.optional(),
    color: colorSchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Nada para atualizar.');
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

/* ──────────────────────────── Lançamentos ───────────────────────────── */

export const transactionSchema = z.object({
  id: idSchema,
  type: entryTypeSchema,
  amountCents: z.number().int(),
  occurredOn: z.string(),
  note: z.string().nullable(),
  category: categorySchema.pick({ id: true, name: true, color: true, kind: true }),
  createdAt: z.string(),
});
export type TransactionDTO = z.infer<typeof transactionSchema>;

export const createTransactionRequestSchema = z.object({
  type: entryTypeSchema,
  amountCents: centsSchema,
  categoryId: idSchema,
  occurredOn: isoDateSchema,
  note: noteSchema.optional(),
});
export type CreateTransactionRequest = z.infer<typeof createTransactionRequestSchema>;

export const updateTransactionRequestSchema = z
  .object({
    amountCents: centsSchema.optional(),
    categoryId: idSchema.optional(),
    occurredOn: isoDateSchema.optional(),
    note: noteSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Nada para atualizar.');
export type UpdateTransactionRequest = z.infer<typeof updateTransactionRequestSchema>;

export const listTransactionsQuerySchema = paginationQuerySchema.extend({
  month: monthRefSchema.optional(),
  categoryId: idSchema.optional(),
  type: entryTypeSchema.optional(),
  search: z.string().trim().max(80).optional(),
});
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

/** Lançamentos agrupados por dia — formato que a tela "Lista" consome. */
export const transactionDayGroupSchema = z.object({
  date: z.string(),
  label: z.string(),
  totalCents: z.number().int(),
  items: z.array(transactionSchema),
});
export type TransactionDayGroup = z.infer<typeof transactionDayGroupSchema>;

/* ─────────────────────────── Contas fixas ───────────────────────────── */

export const billSchema = z.object({
  id: idSchema,
  name: z.string(),
  amountCents: z.number().int(),
  dueDay: z.number().int(),
  active: z.boolean(),
  category: categorySchema.pick({ id: true, name: true, color: true, kind: true }),
  /** Status da competência consultada. */
  paid: z.boolean(),
  paidAt: z.string().nullable(),
  dueDate: z.string(),
});
export type BillDTO = z.infer<typeof billSchema>;

export const createBillRequestSchema = z.object({
  name: nameSchema,
  categoryId: idSchema,
  amountCents: centsSchema,
  dueDay: dayOfMonthSchema,
});
export type CreateBillRequest = z.infer<typeof createBillRequestSchema>;

export const updateBillRequestSchema = z
  .object({
    name: nameSchema.optional(),
    categoryId: idSchema.optional(),
    amountCents: centsSchema.optional(),
    dueDay: dayOfMonthSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Nada para atualizar.');
export type UpdateBillRequest = z.infer<typeof updateBillRequestSchema>;

export const billMonthQuerySchema = z.object({ month: monthRefSchema.optional() });

export const setBillPaymentRequestSchema = z.object({
  month: monthRefSchema,
  paid: z.boolean(),
});
export type SetBillPaymentRequest = z.infer<typeof setBillPaymentRequestSchema>;

/* ───────────────────────────── Entradas ─────────────────────────────── */

export const incomeSchema = z.object({
  id: idSchema,
  name: z.string(),
  amountCents: z.number().int(),
  receiptDay: z.number().int(),
  active: z.boolean(),
});
export type IncomeDTO = z.infer<typeof incomeSchema>;

export const createIncomeRequestSchema = z.object({
  name: nameSchema,
  amountCents: centsSchema,
  receiptDay: dayOfMonthSchema,
});
export type CreateIncomeRequest = z.infer<typeof createIncomeRequestSchema>;

export const updateIncomeRequestSchema = z
  .object({
    name: nameSchema.optional(),
    amountCents: centsSchema.optional(),
    receiptDay: dayOfMonthSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Nada para atualizar.');
export type UpdateIncomeRequest = z.infer<typeof updateIncomeRequestSchema>;

/* ───────────────────────── Dívidas / parcelas ───────────────────────── */

export const debtSchema = z.object({
  id: idSchema,
  name: z.string(),
  installmentCents: z.number().int(),
  paidInstallments: z.number().int(),
  totalInstallments: z.number().int(),
  remainingInstallments: z.number().int(),
  remainingCents: z.number().int(),
  progressPercent: z.number().int(),
  settled: z.boolean(),
});
export type DebtDTO = z.infer<typeof debtSchema>;

export const createDebtRequestSchema = z
  .object({
    name: nameSchema,
    installmentCents: centsSchema,
    totalInstallments: z.number().int().min(1).max(600),
    paidInstallments: z.number().int().min(0).max(600).default(0),
  })
  .refine((data) => data.paidInstallments <= data.totalInstallments, {
    path: ['paidInstallments'],
    message: 'Parcelas pagas não podem passar do total.',
  });
export type CreateDebtRequest = z.infer<typeof createDebtRequestSchema>;

export const updateDebtRequestSchema = z
  .object({
    name: nameSchema.optional(),
    installmentCents: centsSchema.optional(),
    totalInstallments: z.number().int().min(1).max(600).optional(),
    paidInstallments: z.number().int().min(0).max(600).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Nada para atualizar.');
export type UpdateDebtRequest = z.infer<typeof updateDebtRequestSchema>;

export const debtProjectionSchema = z.object({
  month: z.string(),
  label: z.string(),
  totalCents: z.number().int(),
});
export type DebtProjection = z.infer<typeof debtProjectionSchema>;

export const debtOverviewSchema = z.object({
  debts: z.array(debtSchema),
  monthlyTotalCents: z.number().int(),
  projection: z.array(debtProjectionSchema),
  note: z.string(),
});
export type DebtOverview = z.infer<typeof debtOverviewSchema>;

/* ────────────────────────────── Metas ───────────────────────────────── */

export const goalDepositSchema = z.object({
  id: idSchema,
  amountCents: z.number().int(),
  createdAt: z.string(),
});

export const goalSchema = z.object({
  id: idSchema,
  name: z.string(),
  targetCents: z.number().int(),
  savedCents: z.number().int(),
  remainingCents: z.number().int(),
  progressPercent: z.number().int(),
  achieved: z.boolean(),
  featured: z.boolean(),
  deposits: z.array(goalDepositSchema),
});
export type GoalDTO = z.infer<typeof goalSchema>;

export const createGoalRequestSchema = z.object({
  name: nameSchema,
  targetCents: centsSchema,
  savedCents: centsOrZeroSchema.default(0),
  featured: z.boolean().default(false),
});
export type CreateGoalRequest = z.infer<typeof createGoalRequestSchema>;

export const updateGoalRequestSchema = z
  .object({
    name: nameSchema.optional(),
    targetCents: centsSchema.optional(),
    savedCents: centsOrZeroSchema.optional(),
    featured: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Nada para atualizar.');
export type UpdateGoalRequest = z.infer<typeof updateGoalRequestSchema>;

export const createGoalDepositRequestSchema = z.object({ amountCents: centsSchema });
export type CreateGoalDepositRequest = z.infer<typeof createGoalDepositRequestSchema>;

/* ───────────────────────────── Ajustes ──────────────────────────────── */

export const settingsSchema = z.object({
  overspendAlerts: z.boolean(),
  weeklySummary: z.boolean(),
  roundCents: z.boolean(),
  autoDarkMode: z.boolean(),
  showDailyAllowance: z.boolean(),
});
export type SettingsDTO = z.infer<typeof settingsSchema>;

export const updateSettingsRequestSchema = settingsSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Nada para atualizar.');
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

/* ──────────────────────────── Dashboard ─────────────────────────────── */

export const weekBarSchema = z.object({
  index: z.number().int(),
  label: z.string(),
  totalCents: z.number().int(),
  heightPercent: z.number().int(),
  current: z.boolean(),
});

export const upcomingBillSchema = z.object({
  id: idSchema,
  name: z.string(),
  amountCents: z.number().int(),
  dueDay: z.number().int(),
  dueDate: z.string(),
  whenLabel: z.string(),
});

export const dashboardSummarySchema = z.object({
  month: z.string(),
  monthLabel: z.string(),
  isCurrentMonth: z.boolean(),
  incomeCents: z.number().int(),
  billsTotalCents: z.number().int(),
  billsPaidCents: z.number().int(),
  billsDueCents: z.number().int(),
  variableSpentCents: z.number().int(),
  spentCents: z.number().int(),
  leftoverCents: z.number().int(),
  dailyAllowanceCents: z.number().int(),
  daysLeft: z.number().int(),
  bars: z.object({
    spentPercent: z.number().int(),
    duePercent: z.number().int(),
    leftoverPercent: z.number().int(),
  }),
  weeks: z.array(weekBarSchema),
  weekNote: z.string(),
  upcomingBills: z.array(upcomingBillSchema),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const categoryReportItemSchema = z.object({
  categoryId: idSchema.nullable(),
  name: z.string(),
  color: z.string(),
  totalCents: z.number().int(),
  percent: z.number().int(),
  relativeWidth: z.number().int(),
});

export const categoryReportSchema = z.object({
  month: z.string(),
  monthLabel: z.string(),
  totalCents: z.number().int(),
  items: z.array(categoryReportItemSchema),
  comparison: z.string(),
});
export type CategoryReport = z.infer<typeof categoryReportSchema>;

export const calendarDaySchema = z.object({
  day: z.number().int().nullable(),
  isToday: z.boolean(),
  hasBill: z.boolean(),
  allPaid: z.boolean(),
});

export const billsOverviewSchema = z.object({
  month: z.string(),
  monthLabel: z.string(),
  bills: z.array(billSchema),
  paidCents: z.number().int(),
  dueCents: z.number().int(),
  calendar: z.array(calendarDaySchema),
});
export type BillsOverview = z.infer<typeof billsOverviewSchema>;
