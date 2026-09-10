import { ValueObject } from '../../../shared/domain/entity.js';
import { ValidationError } from '../../../shared/domain/errors.js';

interface EmailProps {
  value: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class Email extends ValueObject<EmailProps> {
  private constructor(props: EmailProps) {
    super(props);
  }

  static create(raw: string): Email {
    const value = raw.trim().toLowerCase();
    if (value.length > 160 || !EMAIL_PATTERN.test(value)) {
      throw new ValidationError('E-mail inválido.', [
        { path: 'email', message: 'E-mail inválido.' },
      ]);
    }
    return new Email({ value });
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
