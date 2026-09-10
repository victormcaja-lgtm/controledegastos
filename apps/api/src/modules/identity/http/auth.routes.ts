import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiErrorSchema,
  authenticatedUserSchema,
  changePasswordRequestSchema,
  loginRequestSchema,
  loginResponseSchema,
  updateProfileRequestSchema,
  userSchema,
} from '@grana/shared';
import { env, isProduction } from '../../../config/env.js';
import type { Container } from '../../../container.js';

export const REFRESH_COOKIE = 'grana_refresh_token';

/**
 * O refresh token vive num cookie httpOnly com escopo restrito ao próprio
 * endpoint de refresh/logout. Como front e API ficam em domínios diferentes
 * (Vercel × Railway), o cookie precisa de `SameSite=None; Secure` — e é por
 * isso que a API só aceita origens da allowlist com `credentials: true`.
 */
function setRefreshCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/auth',
    expires: expiresAt,
    signed: false,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, {
    path: '/api/auth',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

export function authRoutes(container: Container): FastifyPluginAsyncZod {
  return async (app) => {
    const route = app.withTypeProvider<ZodTypeProvider>();

    route.post(
      '/login',
      {
        config: {
          // Rate limit dedicado: força bruta no login é o ataque mais comum.
          rateLimit: { max: env.LOGIN_RATE_LIMIT_MAX, timeWindow: '15 minutes' },
        },
        schema: {
          tags: ['Autenticação'],
          summary: 'Autentica e abre uma sessão',
          body: loginRequestSchema,
          response: { 200: loginResponseSchema, 401: apiErrorSchema, 429: apiErrorSchema },
        },
      },
      async (request, reply) => {
        const result = await container.auth.authenticate.execute({
          email: request.body.email,
          password: request.body.password,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        });

        setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);

        return reply.send({
          accessToken: result.accessToken,
          expiresIn: result.expiresIn,
          user: result.user,
        });
      },
    );

    route.post(
      '/refresh',
      {
        schema: {
          tags: ['Autenticação'],
          summary: 'Renova o access token (rotacionando o refresh)',
          response: { 200: loginResponseSchema, 401: apiErrorSchema },
        },
      },
      async (request, reply) => {
        const result = await container.auth.refresh.execute({
          refreshToken: request.cookies[REFRESH_COOKIE] ?? '',
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        });

        setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);

        return reply.send({
          accessToken: result.accessToken,
          expiresIn: result.expiresIn,
          user: result.user,
        });
      },
    );

    route.post(
      '/logout',
      {
        schema: {
          tags: ['Autenticação'],
          summary: 'Encerra a sessão atual',
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        await container.auth.logout.execute({ refreshToken: request.cookies[REFRESH_COOKIE] });
        clearRefreshCookie(reply);
        return reply.status(204).send(null);
      },
    );

    route.get(
      '/me',
      {
        preHandler: [app.authenticate],
        schema: {
          tags: ['Autenticação'],
          summary: 'Dados do usuário autenticado',
          security: [{ bearerAuth: [] }],
          response: { 200: authenticatedUserSchema, 401: apiErrorSchema },
        },
      },
      async (request) => container.auth.profile.execute({ userId: request.actor.userId }),
    );

    route.patch(
      '/me',
      {
        preHandler: [app.authenticate],
        schema: {
          tags: ['Autenticação'],
          summary: 'Atualiza o próprio nome',
          security: [{ bearerAuth: [] }],
          body: updateProfileRequestSchema,
          response: { 200: userSchema, 401: apiErrorSchema },
        },
      },
      async (request) =>
        container.auth.updateProfile.execute({ actor: request.actor, name: request.body.name }),
    );

    route.post(
      '/me/password',
      {
        preHandler: [app.authenticate],
        config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
        schema: {
          tags: ['Autenticação'],
          summary: 'Troca a própria senha (derruba as demais sessões)',
          security: [{ bearerAuth: [] }],
          body: changePasswordRequestSchema,
          response: { 204: z.null(), 401: apiErrorSchema },
        },
      },
      async (request, reply) => {
        await container.auth.changePassword.execute({
          actor: request.actor,
          currentPassword: request.body.currentPassword,
          newPassword: request.body.newPassword,
        });
        clearRefreshCookie(reply);
        return reply.status(204).send(null);
      },
    );
  };
}
