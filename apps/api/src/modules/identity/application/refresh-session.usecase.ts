import type { AuthenticatedUser } from '@grana/shared';
import { UnauthorizedError } from '../../../shared/domain/errors.js';
import type { UseCase } from '../../../shared/application/use-case.js';
import type { RefreshTokenRepository, TokenService, UserRepository } from '../domain/ports.js';

export interface RefreshSessionInput {
  refreshToken: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface RefreshSessionOutput {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthenticatedUser;
}

/**
 * Rotação de refresh token com detecção de reuso.
 *
 * Cada refresh consome o token e emite outro. Se um token JÁ REVOGADO for
 * apresentado, isso significa que ele foi roubado (o legítimo já rotacionou) —
 * e então derrubamos TODAS as sessões daquele usuário. É a defesa padrão
 * recomendada pelo OAuth 2.0 Security BCP.
 */
export class RefreshSessionUseCase implements UseCase<RefreshSessionInput, RefreshSessionOutput> {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenService,
  ) {}

  async execute(input: RefreshSessionInput): Promise<RefreshSessionOutput> {
    const tokenHash = this.tokens.hashRefreshToken(input.refreshToken);
    const stored = await this.refreshTokens.findByHash(tokenHash);

    if (!stored) throw new UnauthorizedError('Sessão inválida. Faça login novamente.');

    if (stored.revokedAt) {
      await this.refreshTokens.revokeAllForUser(stored.userId);
      throw new UnauthorizedError('Sessão comprometida. Faça login novamente.');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('Sessão expirada. Faça login novamente.');
    }

    const user = await this.users.findById(stored.userId);
    if (!user || !user.isActive) {
      await this.refreshTokens.revokeAllForUser(stored.userId);
      throw new UnauthorizedError('Sessão inválida. Faça login novamente.');
    }

    const next = this.tokens.createRefreshToken();
    const issued = await this.refreshTokens.issue({
      userId: user.id,
      tokenHash: next.tokenHash,
      expiresAt: next.expiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await this.refreshTokens.revoke(stored.id, issued.id);

    const { token: accessToken, expiresIn } = await this.tokens.signAccessToken({
      sub: user.id,
      email: user.email.value,
      role: user.role,
    });

    return {
      accessToken,
      expiresIn,
      refreshToken: next.token,
      refreshExpiresAt: next.expiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email.value,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        createdAt: user.createdAt.toISOString(),
      },
    };
  }
}
