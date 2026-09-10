import type { Prisma, PrismaClient } from '../../../shared/infra/database/client.js';
import type { ListUsersFilter, Paginated, UserRepository } from '../domain/ports.js';
import type { User } from '../domain/user.entity.js';
import { UserMapper } from './user.mapper.js';

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const raw = await this.db.user.findUnique({ where: { id } });
    return raw ? UserMapper.toDomain(raw) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const raw = await this.db.user.findUnique({ where: { email: email.toLowerCase() } });
    return raw ? UserMapper.toDomain(raw) : null;
  }

  async existsByEmail(email: string, exceptUserId?: string): Promise<boolean> {
    const found = await this.db.user.findFirst({
      where: {
        email: email.toLowerCase(),
        ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  }

  async list(filter: ListUsersFilter): Promise<Paginated<User>> {
    const where: Prisma.UserWhereInput = {
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { email: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (filter.page - 1) * filter.perPage,
        take: filter.perPage,
      }),
      this.db.user.count({ where }),
    ]);

    return {
      items: rows.map(UserMapper.toDomain),
      total,
      page: filter.page,
      perPage: filter.perPage,
      totalPages: Math.max(1, Math.ceil(total / filter.perPage)),
    };
  }

  async countActiveAdmins(exceptUserId?: string): Promise<number> {
    return this.db.user.count({
      where: {
        role: 'ADMIN',
        status: 'ACTIVE',
        ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}),
      },
    });
  }

  async create(user: User): Promise<User> {
    const created = await this.db.user.create({ data: UserMapper.toPersistence(user) });
    return UserMapper.toDomain(created);
  }

  async save(user: User): Promise<User> {
    const { id, ...data } = UserMapper.toPersistence(user);
    const updated = await this.db.user.update({ where: { id }, data });
    return UserMapper.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.db.user.delete({ where: { id } });
  }
}
