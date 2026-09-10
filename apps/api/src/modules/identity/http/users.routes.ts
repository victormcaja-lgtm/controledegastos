import { z } from 'zod';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  apiErrorSchema,
  createUserRequestSchema,
  idSchema,
  listUsersQuerySchema,
  paginatedSchema,
  resetUserPasswordRequestSchema,
  updateUserRequestSchema,
  userSchema,
} from '@grana/shared';
import type { Container } from '../../../container.js';

const paramsSchema = z.object({ id: idSchema });

/**
 * Área administrativa. Todo o plugin está atrás de `requireAdmin` — não existe
 * rota aqui que um usuário comum consiga alcançar, mesmo que descubra a URL.
 *
 * Repare no que o admin NÃO tem: nenhuma rota devolve o dado financeiro de
 * outro usuário. Administrar contas e ler as finanças alheias são coisas
 * diferentes, e misturá-las seria um problema de privacidade (e de LGPD).
 */
export function usersRoutes(container: Container): FastifyPluginAsyncZod {
  return async (app) => {
    const route = app.withTypeProvider<ZodTypeProvider>();

    app.addHook('preHandler', app.requireAdmin);

    route.get(
      '/',
      {
        schema: {
          tags: ['Administração'],
          summary: 'Lista usuários (paginado, com busca e filtros)',
          security: [{ bearerAuth: [] }],
          querystring: listUsersQuerySchema,
          response: { 200: paginatedSchema(userSchema), 403: apiErrorSchema },
        },
      },
      async (request) => container.users.list.execute(request.query),
    );

    route.get(
      '/:id',
      {
        schema: {
          tags: ['Administração'],
          summary: 'Detalha um usuário',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          response: { 200: userSchema, 404: apiErrorSchema },
        },
      },
      async (request) => container.users.get.execute({ userId: request.params.id }),
    );

    route.post(
      '/',
      {
        schema: {
          tags: ['Administração'],
          summary: 'Cadastra um usuário e prepara o espaço financeiro dele',
          security: [{ bearerAuth: [] }],
          body: createUserRequestSchema,
          response: { 201: userSchema, 409: apiErrorSchema },
        },
      },
      async (request, reply) => {
        const user = await container.users.create.execute({
          actor: request.actor,
          data: request.body,
        });
        return reply.status(201).send(user);
      },
    );

    route.patch(
      '/:id',
      {
        schema: {
          tags: ['Administração'],
          summary: 'Atualiza nome, e-mail, perfil ou status',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          body: updateUserRequestSchema,
          response: { 200: userSchema, 403: apiErrorSchema, 422: apiErrorSchema },
        },
      },
      async (request) =>
        container.users.update.execute({
          actor: request.actor,
          userId: request.params.id,
          data: request.body,
        }),
    );

    route.post(
      '/:id/password',
      {
        schema: {
          tags: ['Administração'],
          summary: 'Redefine a senha de um usuário e derruba as sessões dele',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          body: resetUserPasswordRequestSchema,
          response: { 204: z.null(), 404: apiErrorSchema },
        },
      },
      async (request, reply) => {
        await container.users.resetPassword.execute({
          actor: request.actor,
          userId: request.params.id,
          data: request.body,
        });
        return reply.status(204).send(null);
      },
    );

    route.delete(
      '/:id',
      {
        schema: {
          tags: ['Administração'],
          summary: 'Exclui um usuário e todos os dados financeiros dele',
          security: [{ bearerAuth: [] }],
          params: paramsSchema,
          response: { 204: z.null(), 403: apiErrorSchema, 422: apiErrorSchema },
        },
      },
      async (request, reply) => {
        await container.users.remove.execute({
          actor: request.actor,
          userId: request.params.id,
        });
        return reply.status(204).send(null);
      },
    );
  };
}
