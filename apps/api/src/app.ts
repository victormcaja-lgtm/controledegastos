import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import underPressure from '@fastify/under-pressure';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

import { env, isProduction, isTest } from './config/env.js';
import { buildContainer } from './container.js';
import { authPlugin } from './shared/infra/http/auth.plugin.js';
import { registerErrorHandler } from './shared/infra/http/error-handler.js';
import { authRoutes } from './modules/identity/http/auth.routes.js';
import { usersRoutes } from './modules/identity/http/users.routes.js';
import { financeRoutes } from './modules/finance/http/finance.routes.js';
import { prisma } from './shared/infra/database/prisma.js';

/**
 * Fábrica da aplicação.
 *
 * Separar `buildApp()` de `main.ts` é o que permite instanciar a API inteira
 * dentro de um teste (`app.inject(...)`) sem abrir porta nenhuma.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isTest
      ? false
      : {
          level: env.LOG_LEVEL,
          // Nunca logue segredo. Estes campos saem do log já mascarados.
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'body.password',
            'body.newPassword',
            'body.currentPassword',
          ],
          transport: isProduction
            ? undefined
            : {
                target: 'pino-pretty',
                options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
              },
        },
    genReqId: (request) => (request.headers['x-request-id'] as string) ?? randomUUID(),
    trustProxy: true, // Railway e Vercel ficam atrás de proxy: sem isso, request.ip é o do proxy.
    bodyLimit: 1_048_576, // 1 MB — nenhum endpoint desta API precisa de mais.
  });

  /* ───────────────── Validação e serialização com Zod ──────────────── */
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  /* ───────────────────────────── Segurança ─────────────────────────── */

  await app.register(helmet, {
    // A API não serve HTML; a CSP restritiva evita qualquer surpresa se algum
    // endpoint devolver conteúdo renderizável no futuro.
    contentSecurityPolicy: isProduction ? undefined : false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin(origin, callback) {
      // Requisições sem Origin (curl, health check, mobile nativo) passam.
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/$/, '');
      if (env.corsOrigins.includes(normalized)) return callback(null, true);
      // Previews da Vercel: https://<projeto>-<hash>-<escopo>.vercel.app
      if (!isProduction && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(normalized)) {
        return callback(null, true);
      }
      return callback(new Error(`Origem não autorizada: ${origin}`), false);
    },
    credentials: true, // obrigatório para o cookie httpOnly do refresh token
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    // Chaveia pelo IP real (trustProxy já resolveu o X-Forwarded-For).
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      code: 'RATE_LIMITED',
      message: `Muitas requisições. Tente de novo em ${Math.ceil(context.ttl / 1000)}s.`,
    }),
  });

  await app.register(cookie, { hook: 'onRequest' });

  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { algorithm: 'HS256', iss: 'grana-api' },
    verify: { allowedIss: 'grana-api' },
  });

  await app.register(sensible);

  if (!isTest) {
    // Devolve 503 automaticamente quando o event loop trava — protege o
    // processo de virar um zumbi que aceita conexões e não responde.
    await app.register(underPressure, {
      maxEventLoopDelay: 1000,
      maxHeapUsedBytes: 512 * 1024 * 1024,
      retryAfter: 30,
      exposeStatusRoute: false,
    });
  }

  await app.register(authPlugin);
  registerErrorHandler(app);

  /* ─────────────────────────── Documentação ────────────────────────── */

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Grana API',
        description: 'API de controle financeiro pessoal.',
        version: '1.0.0',
      },
      servers: [{ url: '/', description: 'Servidor atual' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  if (!isProduction) {
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  /* ────────────────────────────── Rotas ────────────────────────────── */

  const container = buildContainer(app);

  app.get(
    '/health',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['Sistema'],
        summary: 'Health check (usado pela Railway)',
        response: {
          200: z.object({ status: z.string(), uptime: z.number(), database: z.string() }),
        },
      },
    },
    async () => {
      // Um health check que não toca no banco mente: o processo sobe, o app
      // responde 200 e o usuário vê erro em toda tela.
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', uptime: Math.round(process.uptime()), database: 'up' };
    },
  );

  await app.register(authRoutes(container), { prefix: '/api/auth' });
  await app.register(usersRoutes(container), { prefix: '/api/admin/users' });
  await app.register(financeRoutes(container), { prefix: '/api' });

  return app;
}
