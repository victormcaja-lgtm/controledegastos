import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ForbiddenError, UnauthorizedError } from '../../domain/errors.js';
import type { Actor } from '../../application/use-case.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler: exige um access token válido. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler: exige access token válido E perfil ADMIN. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    actor: Actor;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; role: 'ADMIN' | 'USER' };
    user: { sub: string; email: string; role: 'ADMIN' | 'USER' };
  }
}

/**
 * Autorização em duas camadas:
 *  • `authenticate` valida a assinatura e a validade do JWT e monta o `actor`.
 *  • `requireAdmin` roda por cima e checa o papel.
 *
 * O `actor` é o que atravessa a aplicação inteira. Nenhum caso de uso lê
 * `request` — todos recebem `actor`, e é isso que os mantém testáveis.
 */
export const authPlugin = fp(async (app) => {
  app.decorateRequest('actor', null as unknown as Actor);

  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new UnauthorizedError('Sessão inválida ou expirada.');
    }

    request.actor = {
      userId: request.user.sub,
      email: request.user.email,
      role: request.user.role,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  });

  app.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply);
    if (request.actor.role !== 'ADMIN') {
      throw new ForbiddenError('Esta área é exclusiva de administradores.');
    }
  });
});
