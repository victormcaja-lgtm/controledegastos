// Gera o arquivo de referência da validação (golden): roda os schemas Zod de
// packages/shared — exatamente os que a API Node aplica — sobre milhares de
// entradas e grava o resultado (dados de saída ou a lista de {path, message}).
// O ZodCompat do .NET precisa reproduzir cada caso.
//
// Uso (na raiz do repo, depois de `npm run build:shared`):
//   node apps/api-dotnet/tools/zod-golden/generate.mjs
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import * as shared from '../../../../packages/shared/dist/index.js';

const UNDEFINED = { $undefined: true };

/** Schemas de requisição exatamente como as rotas os montam (`*.routes.ts`). */
const schemas = {
  // Identity — corpo
  loginRequest: [shared.loginRequestSchema, { email: 'ana@grana.app', password: 'x' }],
  signupRequest: [shared.signupRequestSchema, { name: 'Ana Souza', email: 'ana@grana.app', password: 'SenhaForte123' }],
  changePasswordRequest: [
    shared.changePasswordRequestSchema,
    { currentPassword: 'SenhaAntiga123', newPassword: 'SenhaNova12345', confirmPassword: 'SenhaNova12345' },
  ],
  updateProfileRequest: [shared.updateProfileRequestSchema, { name: 'Ana' }],
  createUserRequest: [shared.createUserRequestSchema, { name: 'Ana Souza', email: 'ana@grana.app', password: 'SenhaForte123' }],
  updateUserRequest: [shared.updateUserRequestSchema, { name: 'Ana', email: 'ana@grana.app', role: 'USER', status: 'ACTIVE' }],
  resetUserPasswordRequest: [shared.resetUserPasswordRequestSchema, { newPassword: 'SenhaForte123' }],
  // Finance — corpo
  createCategoryRequest: [shared.createCategoryRequestSchema, { name: 'Farmácia', color: '#ABCDEF', kind: 'EXPENSE' }],
  updateCategoryRequest: [shared.updateCategoryRequestSchema, { name: 'Farmácia', color: 'oklch(0.62 0.10 145)', archived: true }],
  createTransactionRequest: [
    shared.createTransactionRequestSchema,
    { type: 'EXPENSE', amountCents: 1250, categoryId: 'abcdefgh-1234', occurredOn: '2026-10-20', note: 'feira' },
  ],
  updateTransactionRequest: [
    shared.updateTransactionRequestSchema,
    { amountCents: 100, categoryId: 'abcdefgh-1234', occurredOn: '2026-10-20', note: null },
  ],
  createBillRequest: [
    shared.createBillRequestSchema,
    { name: 'Aluguel', categoryId: 'abcdefgh-1234', amountCents: 120000, dueDay: 10, totalInstallments: 12 },
  ],
  updateBillRequest: [
    shared.updateBillRequestSchema,
    { name: 'Aluguel', categoryId: 'abcdefgh-1234', amountCents: 120000, dueDay: 10, active: true, totalInstallments: null },
  ],
  setBillPaymentRequest: [shared.setBillPaymentRequestSchema, { month: '2026-10', paid: true, waived: false, amountCents: 100 }],
  createIncomeRequest: [shared.createIncomeRequestSchema, { name: 'Salário', amountCents: 500000, receiptDay: 5 }],
  updateIncomeRequest: [shared.updateIncomeRequestSchema, { name: 'Salário', amountCents: 500000, receiptDay: 5, active: false }],
  createDebtRequest: [shared.createDebtRequestSchema, { name: 'Sofá', installmentCents: 25000, totalInstallments: 10, paidInstallments: 2 }],
  updateDebtRequest: [shared.updateDebtRequestSchema, { name: 'Sofá', installmentCents: 25000, totalInstallments: 10, paidInstallments: 2 }],
  convertDebtRequest: [shared.convertDebtRequestSchema, { categoryId: 'abcdefgh-1234', dueDay: 15 }],
  createGoalRequest: [shared.createGoalRequestSchema, { name: 'Viagem', targetCents: 100000, savedCents: 0, featured: true }],
  updateGoalRequest: [shared.updateGoalRequestSchema, { name: 'Viagem', targetCents: 100000, savedCents: 10, featured: false }],
  createGoalDepositRequest: [shared.createGoalDepositRequestSchema, { amountCents: 5000 }],
  updateSettingsRequest: [
    shared.updateSettingsRequestSchema,
    { roundCents: true, openingBalanceCents: -1000, openingDate: '2026-10-01', dailyBudgetCents: null },
  ],
  createCardRequest: [shared.createCardRequestSchema, { name: 'Visa', closingDay: 3, dueDay: 10, limitCents: 500000 }],
  updateCardRequest: [shared.updateCardRequestSchema, { name: 'Visa', closingDay: 3, dueDay: 10, limitCents: null, active: false }],
  createCardPurchaseRequest: [
    shared.createCardPurchaseRequestSchema,
    { amountCents: 9000, installments: 3, purchasedOn: '2026-10-20', categoryId: 'abcdefgh-1234', note: 'tênis' },
  ],
  simulatePurchaseRequest: [
    shared.simulatePurchaseRequestSchema,
    { from: '2026-10-20', to: '2026-12-31', today: '2026-10-20', amountCents: 9000, installments: 1, date: '2026-10-21', method: 'ACCOUNT' },
  ],
  // Querystrings (valores sempre chegam como texto)
  listUsersQuery: [shared.listUsersQuerySchema, { page: '1', perPage: '20', search: 'ana', role: 'USER', status: 'PENDING' }],
  listTransactionsQuery: [
    shared.listTransactionsQuerySchema,
    { page: '2', perPage: '100', month: '2026-10', categoryId: 'abcdefgh-1234', type: 'INCOME', search: ' feira ' },
  ],
  cashflowQuery: [shared.cashflowQuerySchema, { from: '2026-10-01', to: '2026-12-31', today: '2026-10-20' }],
  monthQuery: [z.object({ month: shared.monthRefSchema.optional() }), { month: '2026-10' }],
  invoiceQuery: [shared.invoiceQuerySchema, { month: '2026-10' }],
  todayQuery: [z.object({ today: shared.isoDateSchema.optional() }), { today: '2026-10-20' }],
  categoriesQuery: [z.object({ includeArchived: z.coerce.boolean().default(false) }), { includeArchived: 'true' }],
  // Parâmetros de rota
  idParams: [z.object({ id: shared.idSchema }), { id: 'abcdefgh-1234' }],
};

const QUERY = new Set(['listUsersQuery', 'listTransactionsQuery', 'cashflowQuery', 'monthQuery', 'invoiceQuery', 'todayQuery', 'categoriesQuery', 'idParams']);

const BODY_VALUES = [
  null, '', '   ', 'a', '  Nome  ', 'abc', 'x'.repeat(61), 'x'.repeat(81), 'x'.repeat(141), 'x'.repeat(161),
  0, -1, 1, 1.5, 31, 32, 48, 49, 600, 601, 2147483647, 10000000000, 10000000001, 1e20, -10000000001,
  true, false, [], {}, 'EXPENSE', 'INCOME', 'ADMIN', 'SUSPENDED', 'CARD',
  '2026-10-20', '2026-02-31', '2026-02-32', '2026-1-1', '2026-10', '2026-13', 'A@B.CO', ' ana@grana.app ', 'semarroba',
  '#fff', 'azul', 'rgb(1,2,3)', 'SenhaForte123', 'semnumeroaqui', 'abcdefg', 'abcdefgh', 'x'.repeat(65),
];
const QUERY_VALUES = [
  '', '0', '1', '-1', '1.5', '100', '101', 'abc', 'true', 'false', '2026-10', '2026-13', '2026-10-20', '2026-02-31',
  'x'.repeat(81), 'USER', 'EXPENSE', 'abcdefg', 'abcdefgh', ['1', '2'],
];

function serialize(value) {
  if (value === undefined) return UNDEFINED;
  return value;
}

function run(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: JSON.parse(JSON.stringify(result.data ?? null)) };
  return { success: false, issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) };
}

const extras = {
  changePasswordRequest: [
    { currentPassword: 'A', newPassword: 'SenhaNova12345', confirmPassword: 'Outra12345Aa' },
    { currentPassword: 'SenhaNova12345', newPassword: 'SenhaNova12345', confirmPassword: 'SenhaNova12345' },
    { currentPassword: 'SenhaNova12345', newPassword: 'SenhaNova12345', confirmPassword: 'Diferente123' },
  ],
  createDebtRequest: [
    { name: 'Sofá', installmentCents: 100, totalInstallments: 2, paidInstallments: 3 },
    { name: 'Sofá', installmentCents: 100, totalInstallments: 2 },
  ],
  simulatePurchaseRequest: [
    { from: '2026-10-20', to: '2026-10-19', amountCents: 1, date: '2026-10-20', method: 'ACCOUNT' },
    { from: '2025-01-01', to: '2026-02-06', amountCents: 1, date: '2026-10-20', method: 'ACCOUNT' },
    { from: '2025-01-01', to: '2026-02-05', amountCents: 1, date: '2026-10-20', method: 'ACCOUNT' },
    { from: '2026-10-20', to: '2026-12-31', amountCents: 1, date: '2026-10-20', method: 'CARD' },
    { from: '2026-10-20', to: '2026-10-19', amountCents: 1, date: '2026-10-20', method: 'CARD' },
    { from: '2026-10-20', to: '2026-12-31', amountCents: 1, date: '2026-10-20', method: 'CARD', cardId: 'abcdefgh-1234' },
  ],
  cashflowQuery: [
    { from: '2026-10-20', to: '2026-10-19' },
    { from: '2025-01-01', to: '2026-02-06' },
    { from: '2025-01-01', to: '2026-02-05' },
    { from: '2026-02-31', to: '2026-03-01' },
  ],
};

const cases = {};
for (const [name, [schema, base]] of Object.entries(schemas)) {
  const values = QUERY.has(name) ? QUERY_VALUES : BODY_VALUES;
  const inputs = [base, {}, { ...base, extra: 'x', userId: 'outro' }, UNDEFINED, null, [], 'texto', 1, true];
  for (const key of Object.keys(base)) {
    const { [key]: _removed, ...without } = base;
    inputs.push(without);
    for (const value of values) inputs.push({ ...base, [key]: value });
  }
  for (const extra of extras[name] ?? []) inputs.push(extra);

  const seen = new Set();
  cases[name] = [];
  for (const raw of inputs) {
    const key = JSON.stringify(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    const input = raw === UNDEFINED ? undefined : raw;
    cases[name].push({ input: serialize(raw === UNDEFINED ? undefined : input), ...run(schema, input) });
  }
}

const total = Object.values(cases).reduce((sum, list) => sum + list.length, 0);
const out = new URL('../../tests/Grana.Api.IntegrationTests/Validation/zod-golden.json', import.meta.url);
writeFileSync(out, `${JSON.stringify({ zodVersion: (await import('zod/package.json', { with: { type: 'json' } })).default.version, cases }, null, 1)}\n`);
console.log(`${Object.keys(cases).length} schemas, ${total} casos → ${out.pathname}`);
