import type { AuthenticatedUser, UserDTO } from '@grana/shared';
import { NotFoundError, UnauthorizedError } from '../../../shared/domain/errors.js';
import type { Actor, UseCase } from '../../../shared/application/use-case.js';
import type {
  AuditLogger,
  RefreshTokenRepository,
  TokenService,
  UserRepository,
} from '../domain/ports.js';
import type { Argon2PasswordHasher } from '../infra/argon2-password-hasher.js';
import { UserMapper } from '../infra/user.mapper.js';

/* ─────────────────────────────── Logout ─────────────────────────────── */

export class LogoutUseCase implements UseCase<{ refreshToken?: string | undefined }, void> {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenService,
  ) {}

  async execute(input: { refreshToken?: string | undefined }): Promise<void> {
    if (!input.refreshToken) return;
    const stored = await this.refreshTokens.findByHash(
      this.tokens.hashRefreshToken(input.refreshToken),
    );
    if (stored && !stored.revokedAt) await this.refreshTokens.revoke(stored.id);
  }
}

/* ─────────────────────────── Perfil / sessão ────────────────────────── */

export class GetProfileUseCase implements UseCase<{ userId: string }, AuthenticatedUser> {
  constructor(private readonly users: UserRepository) {}

  async execute({ userId }: { userId: string }): Promise<AuthenticatedUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('Usuário');
    return {
      id: user.id,
      name: user.name,
      email: user.email.value,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

export class UpdateProfileUseCase implements UseCase<{ actor: Actor; name: string }, UserDTO> {
  constructor(private readonly users: UserRepository) {}

  async execute({ actor, name }: { actor: Actor; name: string }): Promise<UserDTO> {
    const user = await this.users.findById(actor.userId);
    if (!user) throw new NotFoundError('Usuário');
    user.rename(name);
    return UserMapper.toDTO(await this.users.save(user));
  }
}

/* ───────────────────────── Troca de senha ───────────────────────────── */

export interface ChangePasswordInput {
  actor: Actor;
  currentPassword: string;
  newPassword: string;
}

/**
 * Trocar a senha derruba todas as outras sessões. É o comportamento esperado
 * por quem troca a senha justamente porque desconfia que ela vazou.
 */
export class ChangePasswordUseCase implements UseCase<ChangePasswordInput, void> {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly hasher: Argon2PasswordHasher,
    private readonly audit: AuditLogger,
  ) {}

  async execute({ actor, currentPassword, newPassword }: ChangePasswordInput): Promise<void> {
    const user = await this.users.findById(actor.userId);
    if (!user) throw new NotFoundError('Usuário');

    const matches = await this.hasher.verify(user.passwordHash, currentPassword);
    if (!matches) throw new UnauthorizedError('A senha atual está incorreta.');

    user.changePassword(await this.hasher.hash(newPassword), { mustChangePassword: false });
    await this.users.save(user);
    await this.refreshTokens.revokeAllForUser(user.id);

    await this.audit.record({
      action: 'auth.password.changed',
      targetType: 'User',
      targetId: user.id,
      actorId: actor.userId,
      actorEmail: actor.email,
      ip: actor.ip ?? null,
    });
  }
}
