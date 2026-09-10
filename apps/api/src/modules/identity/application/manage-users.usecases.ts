import { randomUUID } from 'node:crypto';
import type {
  CreateUserRequest,
  ListUsersQuery,
  ResetUserPasswordRequest,
  UpdateUserRequest,
  UserDTO,
} from '@grana/shared';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { Actor, UseCase } from '../../../shared/application/use-case.js';
import type {
  AuditLogger,
  PasswordHasher,
  Paginated,
  RefreshTokenRepository,
  UserRepository,
  UserWorkspaceProvisioner,
} from '../domain/ports.js';
import { Email } from '../domain/email.vo.js';
import { User } from '../domain/user.entity.js';
import { UserMapper } from '../infra/user.mapper.js';

/* ───────────────────────────── Listar ───────────────────────────────── */

export class ListUsersUseCase implements UseCase<ListUsersQuery, Paginated<UserDTO>> {
  constructor(private readonly users: UserRepository) {}

  async execute(query: ListUsersQuery): Promise<Paginated<UserDTO>> {
    const page = await this.users.list({
      page: query.page,
      perPage: query.perPage,
      search: query.search,
      role: query.role,
      status: query.status,
    });
    return { ...page, items: page.items.map(UserMapper.toDTO) };
  }
}

export class GetUserUseCase implements UseCase<{ userId: string }, UserDTO> {
  constructor(private readonly users: UserRepository) {}

  async execute({ userId }: { userId: string }): Promise<UserDTO> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('Usuário');
    return UserMapper.toDTO(user);
  }
}

/* ───────────────────────────── Criar ────────────────────────────────── */

export class CreateUserUseCase implements UseCase<
  { actor: Actor; data: CreateUserRequest },
  UserDTO
> {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly provisioner: UserWorkspaceProvisioner,
    private readonly audit: AuditLogger,
  ) {}

  async execute({ actor, data }: { actor: Actor; data: CreateUserRequest }): Promise<UserDTO> {
    const email = Email.create(data.email);

    if (await this.users.existsByEmail(email.value)) {
      throw new ConflictError('Já existe um usuário com este e-mail.');
    }

    const user = User.create({
      id: randomUUID(),
      name: data.name,
      email,
      passwordHash: await this.hasher.hash(data.password),
      role: data.role,
      mustChangePassword: data.mustChangePassword,
    });

    const created = await this.users.create(user);
    await this.provisioner.provision(created.id, {
      withDefaultCategories: data.seedDefaultCategories,
    });

    await this.audit.record({
      action: 'user.created',
      targetType: 'User',
      targetId: created.id,
      actorId: actor.userId,
      actorEmail: actor.email,
      ip: actor.ip ?? null,
      metadata: { email: created.email.value, role: created.role },
    });

    return UserMapper.toDTO(created);
  }
}

/* ──────────────────────────── Atualizar ─────────────────────────────── */

export class UpdateUserUseCase implements UseCase<
  { actor: Actor; userId: string; data: UpdateUserRequest },
  UserDTO
> {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute({
    actor,
    userId,
    data,
  }: {
    actor: Actor;
    userId: string;
    data: UpdateUserRequest;
  }): Promise<UserDTO> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('Usuário');

    if (data.email !== undefined) {
      const email = Email.create(data.email);
      if (await this.users.existsByEmail(email.value, userId)) {
        throw new ConflictError('Já existe um usuário com este e-mail.');
      }
      user.changeEmail(email);
    }

    if (data.name !== undefined) user.rename(data.name);

    if (data.role !== undefined && data.role !== user.role) {
      user.assertIsNotSelf(actor.userId, 'alterar o perfil da');
      await this.assertLastAdminIsPreserved(user, { nextRole: data.role });
      user.changeRole(data.role);
    }

    if (data.status !== undefined && data.status !== user.status) {
      user.assertIsNotSelf(actor.userId, 'alterar o status da');
      if (data.status === 'SUSPENDED') {
        await this.assertLastAdminIsPreserved(user, { suspending: true });
        user.suspend();
        // Suspender precisa ter efeito imediato: derruba as sessões abertas.
        await this.refreshTokens.revokeAllForUser(user.id);
      } else {
        user.activate();
      }
    }

    const saved = await this.users.save(user);

    await this.audit.record({
      action: 'user.updated',
      targetType: 'User',
      targetId: saved.id,
      actorId: actor.userId,
      actorEmail: actor.email,
      ip: actor.ip ?? null,
      metadata: { changes: data },
    });

    return UserMapper.toDTO(saved);
  }

  /** O sistema nunca pode ficar sem nenhum administrador ativo. */
  private async assertLastAdminIsPreserved(
    user: User,
    change: { nextRole?: 'ADMIN' | 'USER'; suspending?: boolean },
  ): Promise<void> {
    const losesAdmin =
      user.isAdmin && user.isActive && (change.nextRole === 'USER' || change.suspending === true);
    if (!losesAdmin) return;

    const remaining = await this.users.countActiveAdmins(user.id);
    if (remaining === 0) {
      throw new BusinessRuleError(
        'Este é o último administrador ativo. Promova outro usuário antes de alterar este.',
      );
    }
  }
}

/* ─────────────────────── Redefinir senha (admin) ────────────────────── */

export class ResetUserPasswordUseCase implements UseCase<
  { actor: Actor; userId: string; data: ResetUserPasswordRequest },
  void
> {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditLogger,
  ) {}

  async execute({
    actor,
    userId,
    data,
  }: {
    actor: Actor;
    userId: string;
    data: ResetUserPasswordRequest;
  }): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('Usuário');

    user.changePassword(await this.hasher.hash(data.newPassword), {
      mustChangePassword: data.mustChangePassword,
    });
    await this.users.save(user);
    await this.refreshTokens.revokeAllForUser(user.id);

    await this.audit.record({
      action: 'user.password.reset',
      targetType: 'User',
      targetId: user.id,
      actorId: actor.userId,
      actorEmail: actor.email,
      ip: actor.ip ?? null,
    });
  }
}

/* ───────────────────────────── Excluir ──────────────────────────────── */

export class DeleteUserUseCase implements UseCase<{ actor: Actor; userId: string }, void> {
  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute({ actor, userId }: { actor: Actor; userId: string }): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('Usuário');

    user.assertIsNotSelf(actor.userId, 'excluir');

    if (user.isAdmin && user.isActive && (await this.users.countActiveAdmins(user.id)) === 0) {
      throw new BusinessRuleError('Não é possível excluir o último administrador ativo.');
    }

    // Todo o dado financeiro cai junto por ON DELETE CASCADE — é o comportamento
    // esperado por LGPD quando o titular é removido.
    await this.users.delete(user.id);

    await this.audit.record({
      action: 'user.deleted',
      targetType: 'User',
      targetId: user.id,
      actorId: actor.userId,
      actorEmail: actor.email,
      ip: actor.ip ?? null,
      metadata: { email: user.email.value },
    });
  }
}
