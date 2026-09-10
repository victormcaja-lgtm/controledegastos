import { ValueObject } from './entity.js';
import { ValidationError } from './errors.js';

interface MoneyProps {
  cents: number;
}

/**
 * Value Object de dinheiro. Encapsula a regra "dinheiro é inteiro em centavos"
 * para que nenhuma parte do sistema consiga criar um valor quebrado por acidente.
 */
export class Money extends ValueObject<MoneyProps> {
  static readonly ZERO = new Money({ cents: 0 });

  private constructor(props: MoneyProps) {
    super(props);
  }

  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents)) {
      throw new ValidationError('Valores monetários precisam ser inteiros em centavos.');
    }
    if (!Number.isSafeInteger(cents)) {
      throw new ValidationError('Valor monetário fora do intervalo suportado.');
    }
    return new Money({ cents });
  }

  static fromReais(amount: number): Money {
    return Money.fromCents(Math.round(amount * 100));
  }

  get cents(): number {
    return this.props.cents;
  }

  get reais(): number {
    return this.props.cents / 100;
  }

  get isPositive(): boolean {
    return this.props.cents > 0;
  }

  get isZero(): boolean {
    return this.props.cents === 0;
  }

  plus(other: Money): Money {
    return Money.fromCents(this.cents + other.cents);
  }

  minus(other: Money): Money {
    return Money.fromCents(this.cents - other.cents);
  }

  times(factor: number): Money {
    return Money.fromCents(Math.round(this.cents * factor));
  }

  /** Divisão que não perde centavo: distribui o resto entre as primeiras partes. */
  allocate(parts: number): Money[] {
    if (parts < 1) throw new ValidationError('Número de partes inválido.');
    const base = Math.floor(this.cents / parts);
    const remainder = this.cents - base * parts;
    return Array.from({ length: parts }, (_, index) =>
      Money.fromCents(base + (index < remainder ? 1 : 0)),
    );
  }

  compare(other: Money): number {
    return this.cents - other.cents;
  }
}

export function sumMoney(values: Array<{ cents: number }>): number {
  return values.reduce((total, value) => total + value.cents, 0);
}
