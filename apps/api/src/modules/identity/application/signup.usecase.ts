import { randomUUID } from 'node:crypto';
import type { SignupRequest } from '@grana/shared';
import { ConflictError } from '../../../shared/domain/errors.js';
import type { UseCase } from '../../../shared/application/use-case.js';
import type {
  AuditLogger,
  PasswordHasher,
  UserRepository,
  UserWorkspaceProvisioner,
} from '../domain/ports.js';
import { Email } from '../domain/email.vo.js';
import { User } from '../domain/user.entity.js';

export interface SignupInput {
  data: SignupRequest;
  ip?: string | undefined;
}

/**
 * Autocadastro público: qualquer pessoa pode pedir uma conta, mas ela nasce
 * `PENDING` — sem acesso nenhum até um administrador aprovar. A pessoa escolhe
 * a própria senha, então não faz sentido forçar troca no primeiro acesso.
 */
export class SignupUseCase implements UseCase<SignupInput, void> {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly provisioner: UserWorkspaceProvisioner,
    private readonly audit: AuditLogger,
  ) {}

  async execute({ data, ip }: SignupInput): Promise<void> {
    const email = Email.create(data.email);

    if (await this.users.existsByEmail(email.value)) {
      throw new ConflictError('Já existe uma conta com este e-mail.');
    }

    const user = User.create({
      id: randomUUID(),
      name: data.name,
      email,
      passwordHash: await this.hasher.hash(data.password),
      role: 'USER',
      status: 'PENDING',
      mustChangePassword: false,
    });

    const created = await this.users.create(user);
    await this.provisioner.provision(created.id, { withDefaultCategories: true });

    await this.audit.record({
      action: 'user.signup_requested',
      targetType: 'User',
      targetId: created.id,
      actorId: null,
      actorEmail: created.email.value,
      ip: ip ?? null,
    });
  }
}
