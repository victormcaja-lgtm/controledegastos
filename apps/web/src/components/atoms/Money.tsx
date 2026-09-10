import { clsx } from 'clsx';
import { formatMoney } from '@grana/shared';

export interface MoneyProps {
  cents: number;
  /** Esconde os centavos — respeita o ajuste "arredondar centavos". */
  hideCents?: boolean;
  signed?: boolean;
  className?: string;
}

/**
 * Todo valor monetário da interface passa por aqui.
 *
 * Isso garante formatação pt-BR consistente, numerais tabulares (colunas de
 * números que não "dançam") e um `<time>`-like semântico para leitores de tela.
 */
export function Money({ cents, hideCents = false, signed = false, className }: MoneyProps) {
  return (
    <span className={clsx('tabular', className)}>{formatMoney(cents, { hideCents, signed })}</span>
  );
}
