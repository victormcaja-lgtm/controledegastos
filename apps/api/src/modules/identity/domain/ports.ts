import type { User, UserRole, UserStatus } from './user.entity.js';

/**
 * Portas (interfaces) do módulo de identidade.
 *
 * O domínio declara o que precisa; a camada de infraestrutura decide como
 * (Prisma, Argon2, JWT). Inverter essa dependência é o que mantém o domínio
 * testável sem banco e o que permite trocar a implementação sem tocar em regra.
 */

export interface ListUsersFilter {
  page: number;
  perPage: number;
  search?: string | undefined;
  role?: UserRole | undefined;
  status?: UserStatus | undefined;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  existsByEmail(email: string, exceptUserId?: string): Promise<boolean>;
  list(filter: ListUsersFilter): Promise<Paginated<User>>;
  countActiveAdmins(exceptUserId?: string): Promise<number>;
  create(user: User): Promise<User>;
  save(user: User): Promise<User>;
  delete(id: string): Promise<void>;
}

/**
 * Preparar o espaço financeiro de um novo usuário (categorias padrão, ajustes)
 * é responsabilidade do contexto de Finanças. Identidade só declara a porta —
 * assim o módulo de usuários não passa a depender do módulo financeiro.
 */
export interface UserWorkspaceProvisioner {
  provision(userId: string, options: { withDefaultCategories: boolean }): Promise<void>;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface RefreshTokenRepository {
  issue(params: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<RefreshTokenRecord>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revoke(id: string, replacedBy?: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  deleteExpired(): Promise<number>;
}

export interface PasswordHasher {
  hash(plainText: string): Promise<string>;
  verify(hash: string, plainText: string): Promise<boolean>;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export interface TokenService {
  signAccessToken(payload: AccessTokenPayload): Promise<{ token: string; expiresIn: number }>;
  /** Gera o refresh token opaco + o hash que vai para o banco. */
  createRefreshToken(): { token: string; tokenHash: string; expiresAt: Date };
  hashRefreshToken(token: string): string;
}

export interface AuditLogger {
  record(params: {
    action: string;
    targetType: string;
    targetId?: string | null;
    actorId?: string | null;
    actorEmail?: string | null;
    ip?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void>;
}
