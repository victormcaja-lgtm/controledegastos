import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '../database/client.js';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { DomainError } from '../../domain/errors.js';
import { isProduction } from '../../../config/env.js';

interface ValidationIssue {
  instancePath?: string;
  message?: string;
  params?: { issue?: { path?: Array<string | number> } };
}

/** Normaliza o caminho do campo: "/body/email" e ["email"] viram "email". */
function extractPath(issue: ValidationIssue): string {
  const fromParams = issue.params?.issue?.path;
  if (fromParams?.length) return fromParams.join('.');
  return (issue.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.');
}

const STATUS_BY_DOMAIN_CODE: Record<string, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BUSINESS_RULE: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  TOO_MANY_ATTEMPTS: 429,
};

/**
 * Um único ponto de tradução erro → resposta HTTP.
 *
 * Duas regras que valem ouro em produção:
 *  1. Nenhum erro inesperado vaza stack trace ou mensagem interna para o cliente.
 *  2. Todo erro carrega o `requestId`, que também está no log — é o que
 *     transforma "deu erro aqui" num incidente rastreável em 30 segundos.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: 'Alguns campos precisam de atenção.',
        details: (error.validation as unknown as ValidationIssue[]).map((issue) => ({
          path: extractPath(issue),
          message: issue.message ?? 'Valor inválido.',
        })),
        requestId,
      });
    }

    if (error instanceof DomainError) {
      const statusCode = STATUS_BY_DOMAIN_CODE[error.code] ?? 400;
      if (statusCode >= 500) request.log.error({ err: error }, 'domain error');
      return reply.status(statusCode).send({
        statusCode,
        error: error.name,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        requestId,
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 = violação de índice único; P2025 = registro não encontrado.
      if (error.code === 'P2002') {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          code: 'CONFLICT',
          message: 'Já existe um registro com esses dados.',
          requestId,
        });
      }
      if (error.code === 'P2025') {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'NOT_FOUND',
          message: 'Registro não encontrado.',
          requestId,
        });
      }
    }

    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.name || 'Error',
        code: error.code ?? 'REQUEST_ERROR',
        message: error.message,
        requestId,
      });
    }

    request.log.error({ err: error }, 'erro não tratado');

    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
      message: isProduction
        ? 'Algo deu errado do nosso lado. Tente novamente em instantes.'
        : error.message,
      requestId,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      code: 'ROUTE_NOT_FOUND',
      message: `Rota ${request.method} ${request.url} não existe.`,
      requestId: request.id,
    }),
  );
}
