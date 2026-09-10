import type { AuthenticatedUser } from '@grana/shared';
import { TooManyAttemptsError, UnauthorizedError } from '../../../shared/domain/errors.js';
import type { UseCase } from '../../../shared/application/use-case.js';
import type {
  AuditLogger,
  RefreshTokenRepository,
  TokenService,
  UserRepository,
} from '../domain/ports.js';
import type { Argon2PasswordHasher } from '../infra/argon2-password-hasher.js';

export interface AuthenticateUserInput {
  email: string;
  password: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface AuthenticateUserOutput {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthenticatedUser;
}

export class AuthenticateUserUseCase implements UseCase<
  AuthenticateUserInput,
  AuthenticateUserOutput
> {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly hasher: Argon2PasswordHasher,
    private readonly tokens: TokenService,
    private readonly audit: AuditLogger,
  ) {}

  async execute(input: AuthenticateUserInput): Promise<AuthenticateUserOutput> {
    const user = await this.users.findByEmail(input.email);

    // Usuário inexistente: gasta o mesmo tempo de CPU de uma verificação real e
    // devolve exatamente a mesma mensagem. Nada aqui pode revelar se o e-mail existe.
    if (!user) {
      await this.hasher.burnTime(input.password);
      await this.audit.record({
        action: 'auth.login.failed',
        targetType: 'User',
        actorEmail: input.email,
        ip: input.ip ?? null,
        metadata: { reason: 'unknown_email' },
      });
      throw new UnauthorizedError('E-mail ou senha incorretos.');
    }

    if (user.isLocked()) {
      const minutes = Math.ceil(user.lockRemainingSeconds() / 60);
      throw new TooManyAttemptsError(
        `Conta temporariamente bloqueada por excesso de tentativas. Tente em ${minutes} min.`,
      );
    }

    const passwordMatches = await this.hasher.verify(user.passwordHash, input.password);

    if (!passwordMatches) {
      user.registerFailedLogin();
      await this.users.save(user);
      await this.audit.record({
        action: 'auth.login.failed',
        targetType: 'User',
        targetId: user.id,
        actorEmail: user.email.value,
        ip: input.ip ?? null,
        metadata: { reason: 'bad_password' },
      });
      throw new UnauthorizedError('E-mail ou senha incorretos.');
    }

    // A checagem de status vem DEPOIS da senha: assim uma conta suspensa não é
    // identificável por quem não sabe a senha.
    if (!user.isActive) {
      throw new UnauthorizedError('Esta conta está suspensa. Fale com o administrador.');
    }

    user.registerSuccessfulLogin();
    await this.users.save(user);

    const { token: accessToken, expiresIn } = await this.tokens.signAccessToken({
      sub: user.id,
      email: user.email.value,
      role: user.role,
    });

    const refresh = this.tokens.createRefreshToken();
    await this.refreshTokens.issue({
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    await this.audit.record({
      action: 'auth.login.success',
      targetType: 'User',
      targetId: user.id,
      actorId: user.id,
      actorEmail: user.email.value,
      ip: input.ip ?? null,
    });

    return {
      accessToken,
      expiresIn,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
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
