import { z } from 'zod';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  apiErrorSchema,
  billMonthQuerySchema,
  billSchema,
  billsOverviewSchema,
  categoryReportSchema,
  categorySchema,
  createBillRequestSchema,
  createCategoryRequestSchema,
  createDebtRequestSchema,
  createGoalDepositRequestSchema,
  createGoalRequestSchema,
  createIncomeRequestSchema,
  createTransactionRequestSchema,
  currentMonthRef,
  dashboardSummarySchema,
  debtOverviewSchema,
  debtSchema,
  goalSchema,
  idSchema,
  incomeSchema,
  listTransactionsQuerySchema,
  monthRefSchema,
  setBillPaymentRequestSchema,
  settingsSchema,
  transactionDayGroupSchema,
  transactionSchema,
  updateBillRequestSchema,
  updateCategoryRequestSchema,
  updateDebtRequestSchema,
  updateGoalRequestSchema,
  updateIncomeRequestSchema,
  updateSettingsRequestSchema,
  updateTransactionRequestSchema,
} from '@grana/shared';
import type { Container } from '../../../container.js';

const paramsSchema = z.object({ id: idSchema });
const monthQuerySchema = z.object({ month: monthRefSchema.optional() });

/**
 * Rotas do domínio financeiro.
 *
 * Todas exigem autenticação e operam SEMPRE sobre `request.actor.userId`.
 * Não existe rota que aceite um `userId` no path — é a forma mais simples de
 * garantir que ninguém leia a carteira de outra pessoa por engano.
 */
export function financeRoutes(container: Container): FastifyPluginAsyncZod {
  return async (app) => {
    const route = app.withTypeProvider<ZodTypeProvider>();

    app.addHook('preHandler', app.authenticate);

    /* ───────────────────────── Dashboard ───────────────────────── */

    route.get(
      '/dashboard',
      {
        schema: {
          tags: ['Dashboard'],
          summary: 'Resumo financeiro da competência',
          security: [{ bearerAuth: [] }],
          querystring: monthQuerySchema,
          response: { 200: dashboardSummarySchema, 401: apiErrorSchema },
        },
      },
      async (request) =>
        container.dashboard.summary.execute(
          request.actor.userId,
          request.query.month ?? currentMonthRef(),
        ),
    );

    route.get(
      '/reports/categories',
      {
        schema: {
          tags: ['Dashboard'],
          summary: 'Relatório de gastos por categoria',
          security: [{ bearerAuth: [] }],
          querystring: monthQuerySchema,
          response: { 200: categoryReportSchema },
        },
      },
      async (request) =>
        container.dashboard.categoryReport.execute(
          request.actor.userId,
          request.query.month ?? currentMonthRef(),
        ),
    );

    /* ───────────────────────── Categorias ──────────────────────── */

    route.get(
      '/categories',
      {
        schema: {
          tags: ['Categorias'],
          summary: 'Lista as categorias do usuário',
          security: [{ bearerAuth: [] }],
          querystring: z.object({ includeArchived: z.coerce.boolean().default(false) }),
          response: { 200: z.array(categorySchema) },
        },
      },
      async (request) =>
        container.categories.list.execute(request.actor.userId, request.query.includeArchived),
    );

    route.post(
      '/categories',
      {
        schema: {
          tags: ['Categorias'],
          summary: 'Cria uma categoria',
          security: [{ bearerAuth: [] }],
          body: createCategoryRequestSchema,
          response: { 201: categorySchema, 409: apiErrorSchema },
        },
      },
      async (request, reply) =>
        reply
          .status(201)
          .send(await container.categories.create.execute(request.actor.userId, request.body)),
    );

    route.patch(
      '/categories/:id',
      {
        schema: {
          tags: ['Categorias'],
          summary: 'Renomeia, recolore ou arquiva uma categoria',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          body: updateCategoryRequestSchema,
          response: { 200: categorySchema, 404: apiErrorSchema },
        },
      },
      async (request) =>
        container.categories.update.execute(request.actor.userId, request.params.id, request.body),
    );

    route.delete(
      '/categories/:id',
      {
        schema: {
          tags: ['Categorias'],
          summary: 'Exclui uma categoria não utilizada',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          response: { 204: z.null(), 422: apiErrorSchema },
        },
      },
      async (request, reply) => {
        await container.categories.remove.execute(request.actor.userId, request.params.id);
        return reply.status(204).send(null);
      },
    );

    /* ──────────────────────── Lançamentos ──────────────────────── */

    route.get(
      '/transactions',
      {
        schema: {
          tags: ['Lançamentos'],
          summary: 'Lista lançamentos com filtros, já agrupados por dia',
          security: [{ bearerAuth: [] }],
          querystring: listTransactionsQuerySchema,
          response: {
            200: z.object({
              items: z.array(transactionSchema),
              groups: z.array(transactionDayGroupSchema),
              page: z.number().int(),
              perPage: z.number().int(),
              total: z.number().int(),
              totalPages: z.number().int(),
              summary: z.string(),
            }),
          },
        },
      },
      async (request) => container.transactions.list.execute(request.actor.userId, request.query),
    );

    route.post(
      '/transactions',
      {
        schema: {
          tags: ['Lançamentos'],
          summary: 'Registra um gasto ou uma entrada',
          security: [{ bearerAuth: [] }],
          body: createTransactionRequestSchema,
          response: { 201: transactionSchema, 422: apiErrorSchema },
        },
      },
      async (request, reply) =>
        reply
          .status(201)
          .send(await container.transactions.create.execute(request.actor.userId, request.body)),
    );

    route.patch(
      '/transactions/:id',
      {
        schema: {
          tags: ['Lançamentos'],
          summary: 'Edita um lançamento',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          body: updateTransactionRequestSchema,
          response: { 200: transactionSchema, 404: apiErrorSchema },
        },
      },
      async (request) =>
        container.transactions.update.execute(
          request.actor.userId,
          request.params.id,
          request.body,
        ),
    );

    route.delete(
      '/transactions/:id',
      {
        schema: {
          tags: ['Lançamentos'],
          summary: 'Apaga um lançamento',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          response: { 204: z.null(), 404: apiErrorSchema },
        },
      },
      async (request, reply) => {
        await container.transactions.remove.execute(request.actor.userId, request.params.id);
        return reply.status(204).send(null);
      },
    );

    /* ─────────────────────── Contas fixas ──────────────────────── */

    route.get(
      '/bills',
      {
        schema: {
          tags: ['Contas'],
          summary: 'Contas fixas + calendário da competência',
          security: [{ bearerAuth: [] }],
          querystring: billMonthQuerySchema,
          response: { 200: billsOverviewSchema },
        },
      },
      async (request) =>
        container.bills.overview.execute(
          request.actor.userId,
          request.query.month ?? currentMonthRef(),
        ),
    );

    route.post(
      '/bills',
      {
        schema: {
          tags: ['Contas'],
          summary: 'Cadastra uma conta fixa',
          security: [{ bearerAuth: [] }],
          body: createBillRequestSchema,
          response: { 201: billSchema, 422: apiErrorSchema },
        },
      },
      async (request, reply) =>
        reply
          .status(201)
          .send(
            await container.bills.create.execute(
              request.actor.userId,
              request.body,
              currentMonthRef(),
            ),
          ),
    );

    route.patch(
      '/bills/:id',
      {
        schema: {
          tags: ['Contas'],
          summary: 'Edita uma conta fixa',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          body: updateBillRequestSchema,
          querystring: billMonthQuerySchema,
          response: { 200: billSchema, 404: apiErrorSchema },
        },
      },
      async (request) =>
        container.bills.update.execute(
          request.actor.userId,
          request.params.id,
          request.body,
          request.query.month ?? currentMonthRef(),
        ),
    );

    route.delete(
      '/bills/:id',
      {
        schema: {
          tags: ['Contas'],
          summary: 'Exclui uma conta fixa',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          response: { 204: z.null(), 404: apiErrorSchema },
        },
      },
      async (request, reply) => {
        await container.bills.remove.execute(request.actor.userId, request.params.id);
        return reply.status(204).send(null);
      },
    );

    route.put(
      '/bills/:id/payment',
      {
        schema: {
          tags: ['Contas'],
          summary: 'Marca/desmarca a conta como paga na competência',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          body: setBillPaymentRequestSchema,
          response: { 200: billSchema, 404: apiErrorSchema },
        },
      },
      async (request) =>
        container.bills.setPayment.execute(request.actor.userId, request.params.id, request.body),
    );

    /* ───────────────────────── Entradas ────────────────────────── */

    route.get(
      '/incomes',
      {
        schema: {
          tags: ['Entradas'],
          summary: 'Lista as entradas fixas',
          security: [{ bearerAuth: [] }],
          response: { 200: z.array(incomeSchema) },
        },
      },
      async (request) => container.incomes.list.execute(request.actor.userId),
    );

    route.post(
      '/incomes',
      {
        schema: {
          tags: ['Entradas'],
          summary: 'Cadastra uma entrada fixa',
          security: [{ bearerAuth: [] }],
          body: createIncomeRequestSchema,
          response: { 201: incomeSchema },
        },
      },
      async (request, reply) =>
        reply
          .status(201)
          .send(await container.incomes.create.execute(request.actor.userId, request.body)),
    );

    route.patch(
      '/incomes/:id',
      {
        schema: {
          tags: ['Entradas'],
          summary: 'Edita uma entrada fixa',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          body: updateIncomeRequestSchema,
          response: { 200: incomeSchema, 404: apiErrorSchema },
        },
      },
      async (request) =>
        container.incomes.update.execute(request.actor.userId, request.params.id, request.body),
    );

    route.delete(
      '/incomes/:id',
      {
        schema: {
          tags: ['Entradas'],
          summary: 'Exclui uma entrada fixa',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          response: { 204: z.null(), 404: apiErrorSchema },
        },
      },
      async (request, reply) => {
        await container.incomes.remove.execute(request.actor.userId, request.params.id);
        return reply.status(204).send(null);
      },
    );

    /* ────────────────────────── Dívidas ────────────────────────── */

    route.get(
      '/debts',
      {
        schema: {
          tags: ['Dívidas'],
          summary: 'Parcelas em aberto e projeção dos próximos 6 meses',
          security: [{ bearerAuth: [] }],
          response: { 200: debtOverviewSchema },
        },
      },
      async (request) => container.debts.overview.execute(request.actor.userId),
    );

    route.post(
      '/debts',
      {
        schema: {
          tags: ['Dívidas'],
          summary: 'Cadastra uma dívida parcelada',
          security: [{ bearerAuth: [] }],
          body: createDebtRequestSchema,
          response: { 201: debtSchema },
        },
      },
      async (request, reply) =>
        reply
          .status(201)
          .send(await container.debts.create.execute(request.actor.userId, request.body)),
    );

    route.patch(
      '/debts/:id',
      {
        schema: {
          tags: ['Dívidas'],
          summary: 'Edita uma dívida',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          body: updateDebtRequestSchema,
          response: { 200: debtSchema, 404: apiErrorSchema },
        },
      },
      async (request) =>
        container.debts.update.execute(request.actor.userId, request.params.id, request.body),
    );

    route.delete(
      '/debts/:id',
      {
        schema: {
          tags: ['Dívidas'],
          summary: 'Exclui uma dívida',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          response: { 204: z.null(), 404: apiErrorSchema },
        },
      },
      async (request, reply) => {
        await container.debts.remove.execute(request.actor.userId, request.params.id);
        return reply.status(204).send(null);
      },
    );

    /* ─────────────────────────── Metas ─────────────────────────── */

    route.get(
      '/goals',
      {
        schema: {
          tags: ['Metas'],
          summary: 'Lista as metas de poupança',
          security: [{ bearerAuth: [] }],
          response: { 200: z.array(goalSchema) },
        },
      },
      async (request) => container.goals.list.execute(request.actor.userId),
    );

    route.post(
      '/goals',
      {
        schema: {
          tags: ['Metas'],
          summary: 'Cria uma meta',
          security: [{ bearerAuth: [] }],
          body: createGoalRequestSchema,
          response: { 201: goalSchema },
        },
      },
      async (request, reply) =>
        reply
          .status(201)
          .send(await container.goals.create.execute(request.actor.userId, request.body)),
    );

    route.patch(
      '/goals/:id',
      {
        schema: {
          tags: ['Metas'],
          summary: 'Edita uma meta',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          body: updateGoalRequestSchema,
          response: { 200: goalSchema, 404: apiErrorSchema },
        },
      },
      async (request) =>
        container.goals.update.execute(request.actor.userId, request.params.id, request.body),
    );

    route.delete(
      '/goals/:id',
      {
        schema: {
          tags: ['Metas'],
          summary: 'Exclui uma meta',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          response: { 204: z.null(), 404: apiErrorSchema },
        },
      },
      async (request, reply) => {
        await container.goals.remove.execute(request.actor.userId, request.params.id);
        return reply.status(204).send(null);
      },
    );

    route.post(
      '/goals/:id/deposits',
      {
        schema: {
          tags: ['Metas'],
          summary: 'Guarda um valor na meta',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          body: createGoalDepositRequestSchema,
          response: { 200: goalSchema, 404: apiErrorSchema },
        },
      },
      async (request) =>
        container.goals.deposit.execute(
          request.actor.userId,
          request.params.id,
          request.body.amountCents,
        ),
    );

    /* ────────────────────────── Ajustes ────────────────────────── */

    route.get(
      '/settings',
      {
        schema: {
          tags: ['Ajustes'],
          summary: 'Preferências do usuário',
          security: [{ bearerAuth: [] }],
          response: { 200: settingsSchema },
        },
      },
      async (request) => container.settings.get.execute(request.actor.userId),
    );

    route.patch(
      '/settings',
      {
        schema: {
          tags: ['Ajustes'],
          summary: 'Atualiza preferências',
          security: [{ bearerAuth: [] }],
          body: updateSettingsRequestSchema,
          response: { 200: settingsSchema },
        },
      },
      async (request) => container.settings.update.execute(request.actor.userId, request.body),
    );
  };
}
