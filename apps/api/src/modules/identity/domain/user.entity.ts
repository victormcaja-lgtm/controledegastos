import { Entity } from '../../../shared/domain/entity.js';
import { BusinessRuleError, ForbiddenError } from '../../../shared/domain/errors.js';
import type { Email } from './email.vo.js';

export type UserRole = 'ADMIN' | 'USER';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';

export interface UserProps {
  name: string;
  email: Email;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Depois de 5 falhas seguidas a conta trava por 15 minutos. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

/**
 * Raiz do agregado de identidade.
 *
 * Todas as regras de "quem pode o quê" e do ciclo de vida da conta moram aqui —
 * não espalhadas por controllers. Um caso de uso chama `user.suspend()` e a
 * entidade decide se aquilo é legal.
 */
export class User extends Entity<UserProps> {
  static restore(id: string, props: UserProps): User {
    return new User(id, props);
  }

  static create(params: {
    id: string;
    name: string;
    email: Email;
    passwordHash: string;
    role?: UserRole;
    mustChangePassword?: boolean;
  }): User {
    const now = new Date();
    return new User(params.id, {
      name: params.name.trim(),
      email: params.email,
      passwordHash: params.passwordHash,
      role: params.role ?? 'USER',
      status: 'ACTIVE',
      mustChangePassword: params.mustChangePassword ?? true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  get name(): string {
    return this.props.name;
  }
  get email(): Email {
    return this.props.email;
  }
  get passwordHash(): string {
    return this.props.passwordHash;
  }
  get role(): UserRole {
    return this.props.role;
  }
  get status(): UserStatus {
    return this.props.status;
  }
  get mustChangePassword(): boolean {
    return this.props.mustChangePassword;
  }
  get failedLoginAttempts(): number {
    return this.props.failedLoginAttempts;
  }
  get lockedUntil(): Date | null {
    return this.props.lockedUntil;
  }
  get lastLoginAt(): Date | null {
    return this.props.lastLoginAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get isAdmin(): boolean {
    return this.props.role === 'ADMIN';
  }

  get isActive(): boolean {
    return this.props.status === 'ACTIVE';
  }

  isLocked(now: Date = new Date()): boolean {
    return this.props.lockedUntil !== null && this.props.lockedUntil > now;
  }

  /** Quanto falta (em segundos) para a conta destravar. */
  lockRemainingSeconds(now: Date = new Date()): number {
    if (!this.isLocked(now)) return 0;
    return Math.ceil((this.props.lockedUntil!.getTime() - now.getTime()) / 1000);
  }

  /** Chamado quando a senha não confere. Trava a conta ao atingir o limite. */
  registerFailedLogin(now: Date = new Date()): void {
    this.props.failedLoginAttempts += 1;
    if (this.props.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      this.props.lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
      this.props.failedLoginAttempts = 0;
    }
    this.touch();
  }

  registerSuccessfulLogin(now: Date = new Date()): void {
    this.props.failedLoginAttempts = 0;
    this.props.lockedUntil = null;
    this.props.lastLoginAt = now;
    this.touch();
  }

  rename(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length < 2)
      throw new BusinessRuleError('O nome precisa ter ao menos 2 caracteres.');
    this.props.name = trimmed;
    this.touch();
  }

  changeEmail(email: Email): void {
    this.props.email = email;
    this.touch();
  }

  changePassword(passwordHash: string, options: { mustChangePassword?: boolean } = {}): void {
    this.props.passwordHash = passwordHash;
    this.props.mustChangePassword = options.mustChangePassword ?? false;
    this.props.failedLoginAttempts = 0;
    this.props.lockedUntil = null;
    this.touch();
  }

  changeRole(role: UserRole): void {
    this.props.role = role;
    this.touch();
  }

  suspend(): void {
    this.props.status = 'SUSPENDED';
    this.touch();
  }

  activate(): void {
    this.props.status = 'ACTIVE';
    this.props.failedLoginAttempts = 0;
    this.props.lockedUntil = null;
    this.touch();
  }

  /**
   * Invariante de segurança: um administrador não pode rebaixar, suspender nem
   * apagar a própria conta. Sem isso é trivial ficar sem nenhum admin ativo.
   */
  assertIsNotSelf(actorId: string, action: string): void {
    if (this.id === actorId) {
      throw new ForbiddenError(`Você não pode ${action} a própria conta.`);
    }
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
