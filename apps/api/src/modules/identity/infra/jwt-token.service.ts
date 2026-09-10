import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../../config/env.js';
import type { AccessTokenPayload, TokenService } from '../domain/ports.js';

/**
 * Estratégia de sessão:
 *
 *  • ACCESS TOKEN  — JWT curto (15 min), assinado com HS256, devolvido no corpo
 *    e guardado só na MEMÓRIA do front. Não vai para localStorage: se um XSS
 *    conseguir ler o storage, ele leva a sessão inteira junto.
 *
 *  • REFRESH TOKEN — string aleatória OPACA de 512 bits, entregue num cookie
 *    httpOnly + Secure + SameSite. O banco guarda apenas o SHA-256 dela.
 *    Um vazamento do banco não devolve nenhuma sessão utilizável.
 *    A cada uso o token é rotacionado e o anterior revogado.
 *
 * Por que o refresh não é JWT? Porque JWT é, por natureza, irrevogável até
 * expirar. Para poder derrubar sessões (suspender usuário, "sair de todos os
 * dispositivos") o refresh precisa existir como linha no banco.
 */
export class JwtTokenService implements TokenService {
  constructor(private readonly app: FastifyInstance) {}

  async signAccessToken(
    payload: AccessTokenPayload,
  ): Promise<{ token: string; expiresIn: number }> {
    const token = await this.app.jwt.sign(payload, { expiresIn: env.ACCESS_TOKEN_TTL });
    const decoded = this.app.jwt.decode<{ exp: number; iat: number }>(token);
    const expiresIn = decoded ? decoded.exp - decoded.iat : 900;
    return { token, expiresIn };
  }

  createRefreshToken(): { token: string; tokenHash: string; expiresAt: Date } {
    const token = randomBytes(64).toString('base64url');
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    return { token, tokenHash: this.hashRefreshToken(token), expiresAt };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
