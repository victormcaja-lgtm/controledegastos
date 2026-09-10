/**
 * Erros de domínio.
 *
 * O domínio não conhece HTTP. Ele fala em "não encontrado", "regra violada",
 * "não autorizado" — e a camada HTTP traduz isso para status codes.
 * Essa separação é o que permite reusar os casos de uso em uma CLI, num worker
 * ou numa fila sem arrastar Fastify junto.
 */

export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TOO_MANY_ATTEMPTS';

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;

  protected constructor(
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR' as const;
  constructor(message: string, details?: Array<{ path: string; message: string }>) {
    super(message, details);
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND' as const;
  constructor(resource: string) {
    super(`${resource} não encontrado.`);
  }
}

export class ConflictError extends DomainError {
  readonly code = 'CONFLICT' as const;
  constructor(message: string) {
    super(message);
  }
}

export class BusinessRuleError extends DomainError {
  readonly code = 'BUSINESS_RULE' as const;
  constructor(message: string) {
    super(message);
  }
}

export class UnauthorizedError extends DomainError {
  readonly code = 'UNAUTHORIZED' as const;
  constructor(message = 'Credenciais inválidas.') {
    super(message);
  }
}

export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN' as const;
  constructor(message = 'Você não tem permissão para esta ação.') {
    super(message);
  }
}

export class TooManyAttemptsError extends DomainError {
  readonly code = 'TOO_MANY_ATTEMPTS' as const;
  constructor(message = 'Muitas tentativas. Tente novamente mais tarde.') {
    super(message);
  }
}
