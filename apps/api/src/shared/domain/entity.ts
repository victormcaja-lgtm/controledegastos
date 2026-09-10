/**
 * Blocos de construção táticos do DDD.
 *
 * `Entity` tem identidade: dois objetos com o mesmo id são o mesmo conceito,
 * mesmo que os atributos difiram.
 * `ValueObject` não tem identidade: é comparado pelo valor e é imutável.
 */

export abstract class Entity<TProps> {
  protected readonly props: TProps;

  constructor(
    readonly id: string,
    props: TProps,
  ) {
    this.props = props;
  }

  equals(other?: Entity<TProps>): boolean {
    if (!other) return false;
    if (this === other) return true;
    return this.id === other.id;
  }
}

export abstract class ValueObject<TProps> {
  protected readonly props: Readonly<TProps>;

  protected constructor(props: TProps) {
    this.props = Object.freeze(props);
  }

  equals(other?: ValueObject<TProps>): boolean {
    if (!other) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }
}
