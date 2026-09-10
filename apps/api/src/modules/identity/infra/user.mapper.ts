import type { User as PrismaUser } from '../../../shared/infra/database/client.js';
import type { UserDTO } from '@grana/shared';
import { User } from '../domain/user.entity.js';
import { Email } from '../domain/email.vo.js';

/**
 * O mapper é a fronteira entre persistência e domínio. Nenhum objeto do Prisma
 * atravessa para dentro da aplicação, e nenhuma entidade vaza `passwordHash`
 * para fora da API.
 */
export const UserMapper = {
  toDomain(raw: PrismaUser): User {
    return User.restore(raw.id, {
      name: raw.name,
      email: Email.create(raw.email),
      passwordHash: raw.passwordHash,
      role: raw.role,
      status: raw.status,
      mustChangePassword: raw.mustChangePassword,
      failedLoginAttempts: raw.failedLoginAttempts,
      lockedUntil: raw.lockedUntil,
      lastLoginAt: raw.lastLoginAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  },

  toPersistence(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email.value,
      passwordHash: user.passwordHash,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
      lastLoginAt: user.lastLoginAt,
    };
  },

  /** Representação pública — nunca inclui hash de senha nem contadores internos. */
  toDTO(user: User): UserDTO {
    return {
      id: user.id,
      name: user.name,
      email: user.email.value,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  },
};
