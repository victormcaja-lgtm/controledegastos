import { z } from 'zod';
import { categorySchema } from './finance.contract.js';
import {
  centsSchema,
  dayOfMonthSchema,
  idSchema,
  isoDateSchema,
  monthRefSchema,
  nameSchema,
  noteSchema,
} from '../primitives.js';

/**
 * Saldo futuro: o dinheiro visto como um rio contínuo, dia a dia.
 *
 * Do saldo inicial até hoje vale o que aconteceu; de amanhã em diante, o que
 * está previsto (entradas fixas, contas, faturas, gasto médio diário). A sobra
 * de um mês vira o ponto de partida do outro, e conta não paga continua
 * puxando o saldo para baixo até ser paga.
 */

/** Maior intervalo que uma consulta de saldo futuro pode pedir. */
export const CASHFLOW_MAX_RANGE_DAYS = 400;

function daysBetweenISO(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const rangeShape = {
  from: isoDateSchema,
  to: isoDateSchema,
  /** "Hoje" no fuso do usuário. Sem ele, vale a data UTC do servidor. */
  today: isoDateSchema.optional(),
};

function refineRange<T extends { from: string; to: string }>(schema: z.ZodType<T>) {
  return schema
    .refine((data) => data.to >= data.from, {
      path: ['to'],
      message: 'A data final precisa ser depois da inicial.',
    })
    .refine((data) => daysBetweenISO(data.from, data.to) <= CASHFLOW_MAX_RANGE_DAYS, {
      path: ['to'],
      message: `Peça no máximo ${CASHFLOW_MAX_RANGE_DAYS} dias por vez.`,
    });
}

export const cashflowQuerySchema = refineRange(z.object(rangeShape));
export type CashflowQuery = z.infer<typeof cashflowQuerySchema>;

export const cashflowEventKindSchema = z.enum([
  /** Lançamento avulso (gasto ou entrada). */
  'TRANSACTION',
  /** Entrada fixa (salário...). */
  'INCOME',
  /** Conta fixa paga ou prevista. */
  'BILL',
  /** Conta fixa vencida e não paga: aparece hoje até ser paga. */
  'BILL_OVERDUE',
  'CARD_INVOICE',
  /** Dinheiro guardado numa meta: sai do saldo. */
  'GOAL_DEPOSIT',
  /** Projeção do gasto variável do dia. */
  'DAILY_AVERAGE',
  /** Compra simulada no "Posso comprar?". */
  'SIMULATION',
]);
export type CashflowEventKind = z.infer<typeof cashflowEventKindSchema>;

export const cashflowEventSchema = z.object({
  kind: cashflowEventKindSchema,
  label: z.string(),
  /** Positivo = entra; negativo = sai. */
  amountCents: z.number().int(),
  /** Previsto (ainda não aconteceu). */
  projected: z.boolean(),
  /** Id do registro de origem (lançamento, conta, cartão, meta...). */
  refId: z.string().nullable(),
  /** Competência da conta fixa, quando o evento é uma conta. */
  month: z.string().nullable(),
});
export type CashflowEvent = z.infer<typeof cashflowEventSchema>;

export const cashflowDaySchema = z.object({
  date: z.string(),
  inCents: z.number().int(),
  outCents: z.number().int(),
  /** Saldo ao fim do dia, contando tudo (real + previsto). */
  balanceCents: z.number().int(),
  /** Dia futuro. */
  projected: z.boolean(),
  events: z.array(cashflowEventSchema),
});
export type CashflowDay = z.infer<typeof cashflowDaySchema>;

export const overdueBillSchema = z.object({
  billId: idSchema,
  name: z.string(),
  month: z.string(),
  dueDate: z.string(),
  amountCents: z.number().int(),
  daysLate: z.number().int(),
  installmentNumber: z.number().int().nullable(),
  totalInstallments: z.number().int().nullable(),
});
export type OverdueBill = z.infer<typeof overdueBillSchema>;

export const cashflowMonthSchema = z.object({
  month: z.string(),
  label: z.string(),
  /** Saldo no início do mês (ou no dia do saldo inicial). */
  openingCents: z.number().int(),
  inCents: z.number().int(),
  /** Saídas, sem contar o que foi guardado em metas. */
  outCents: z.number().int(),
  savedCents: z.number().int(),
  /** Entradas − saídas (lucro ou prejuízo do mês). */
  resultCents: z.number().int(),
  closingCents: z.number().int(),
  /** Mês que já acabou. */
  closed: z.boolean(),
});
export type CashflowMonth = z.infer<typeof cashflowMonthSchema>;

export const cashflowSchema = z.object({
  /** `false` enquanto o usuário não informou o saldo inicial. */
  configured: z.boolean(),
  today: z.string(),
  openingDate: z.string().nullable(),
  from: z.string(),
  to: z.string(),
  /** Saldo real ao fim de hoje (sem as pendências previstas para hoje). */
  todayBalanceCents: z.number().int(),
  /** Saldo previsto para o último dia do mês corrente. */
  endOfMonthCents: z.number().int(),
  /** Menor saldo previsto de hoje até o fim do intervalo. */
  lowest: z.object({ date: z.string(), balanceCents: z.number().int() }).nullable(),
  firstNegativeDate: z.string().nullable(),
  dailyAverageCents: z.number().int(),
  overdueBills: z.array(overdueBillSchema),
  days: z.array(cashflowDaySchema),
  months: z.array(cashflowMonthSchema),
});
export type Cashflow = z.infer<typeof cashflowSchema>;

/* ─────────────────────────── Posso comprar? ─────────────────────────── */

export const paymentMethodSchema = z.enum(['ACCOUNT', 'CARD']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const simulatePurchaseRequestSchema = refineRange(
  z.object({
    ...rangeShape,
    amountCents: centsSchema,
    installments: z.number().int().min(1).max(48).default(1),
    date: isoDateSchema,
    method: paymentMethodSchema,
    cardId: idSchema.optional(),
  }),
).refine((data) => data.method !== 'CARD' || Boolean(data.cardId), {
  path: ['cardId'],
  message: 'Escolha o cartão.',
});
export type SimulatePurchaseRequest = z.infer<typeof simulatePurchaseRequestSchema>;

export const simulationResultSchema = z.object({
  before: cashflowSchema,
  after: cashflowSchema,
  /** A resposta em uma frase. */
  verdict: z.string(),
  /** `false` quando a compra deixa o saldo negativo em algum dia do intervalo. */
  fits: z.boolean(),
});
export type SimulationResult = z.infer<typeof simulationResultSchema>;

/* ───────────────────────────── Cartões ──────────────────────────────── */

export const invoiceSummarySchema = z.object({
  /** Competência da fatura = mês em que ela fecha. */
  month: z.string(),
  closingDate: z.string(),
  dueDate: z.string(),
  totalCents: z.number().int(),
  /**
   * OPEN = a que recebe compras hoje; FUTURE = próximas (parcelas já lançadas);
   * CLOSED = fechada, a vencer; PAST = já venceu.
   */
  status: z.enum(['OPEN', 'FUTURE', 'CLOSED', 'PAST']),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

export const cardSchema = z.object({
  id: idSchema,
  name: z.string(),
  closingDay: z.number().int(),
  dueDay: z.number().int(),
  limitCents: z.number().int().nullable(),
  active: z.boolean(),
  /** Soma das parcelas que ainda vão vencer. */
  usedLimitCents: z.number().int(),
  /** Faturas da aberta em diante (até 4). */
  invoices: z.array(invoiceSummarySchema),
});
export type CardDTO = z.infer<typeof cardSchema>;

export const createCardRequestSchema = z.object({
  name: nameSchema,
  closingDay: dayOfMonthSchema,
  dueDay: dayOfMonthSchema,
  limitCents: centsSchema.nullable().optional(),
});
export type CreateCardRequest = z.infer<typeof createCardRequestSchema>;

export const updateCardRequestSchema = z
  .object({
    name: nameSchema.optional(),
    closingDay: dayOfMonthSchema.optional(),
    dueDay: dayOfMonthSchema.optional(),
    limitCents: centsSchema.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Nada para atualizar.');
export type UpdateCardRequest = z.infer<typeof updateCardRequestSchema>;

export const cardPurchaseSchema = z.object({
  id: idSchema,
  cardId: idSchema,
  amountCents: z.number().int(),
  installments: z.number().int(),
  purchasedOn: z.string(),
  note: z.string().nullable(),
  category: categorySchema.pick({ id: true, name: true, color: true, kind: true }),
});
export type CardPurchaseDTO = z.infer<typeof cardPurchaseSchema>;

export const createCardPurchaseRequestSchema = z.object({
  amountCents: centsSchema,
  installments: z.number().int().min(1).max(48).default(1),
  purchasedOn: isoDateSchema,
  categoryId: idSchema,
  note: noteSchema.optional(),
});
export type CreateCardPurchaseRequest = z.infer<typeof createCardPurchaseRequestSchema>;

export const invoiceQuerySchema = z.object({ month: monthRefSchema.optional() });

export const invoiceItemSchema = z.object({
  purchaseId: idSchema,
  label: z.string(),
  category: categorySchema.pick({ id: true, name: true, color: true, kind: true }),
  purchasedOn: z.string(),
  installmentNumber: z.number().int(),
  installments: z.number().int(),
  amountCents: z.number().int(),
});

export const invoiceDetailSchema = invoiceSummarySchema.extend({
  cardId: idSchema,
  cardName: z.string(),
  items: z.array(invoiceItemSchema),
});
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;
