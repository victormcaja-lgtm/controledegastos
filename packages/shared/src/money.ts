/**
 * Dinheiro é sempre representado em CENTAVOS (inteiro).
 *
 * Motivo: `number` em JS é ponto flutuante binário (IEEE-754) e 0.1 + 0.2 !== 0.3.
 * Guardar centavos como inteiro elimina toda uma classe de bug de arredondamento
 * em somas, rateios e projeções. A conversão para `string` formatada acontece
 * apenas na borda de apresentação.
 */

export const CENTS_IN_UNIT = 100;

/** Converte reais (number) para centavos (inteiro), arredondando corretamente. */
export function toCents(amount: number): number {
  return Math.round(amount * CENTS_IN_UNIT);
}

/** Converte centavos para reais (number). Use apenas para exibição/gráficos. */
export function fromCents(cents: number): number {
  return cents / CENTS_IN_UNIT;
}

/**
 * Lê uma entrada digitada pelo usuário em pt-BR ("1.234,56", "1234,56", "1234.56")
 * e devolve centavos. Retorna `null` quando a entrada não é um número válido.
 */
export function parseBRLToCents(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/[R$\s\u00a0]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return toCents(Number(cleaned));
}

export interface FormatMoneyOptions {
  /** Esconde os centavos (R$ 214 em vez de R$ 214,90). */
  hideCents?: boolean;
  /** Inclui o prefixo "R$ ". Padrão: true. */
  withSymbol?: boolean;
  /** Sempre mostra o sinal (+/−). Padrão: false. */
  signed?: boolean;
}

/** Formata centavos como moeda pt-BR. */
export function formatMoney(cents: number, options: FormatMoneyOptions = {}): string {
  const { hideCents = false, withSymbol = true, signed = false } = options;
  const digits = hideCents ? 0 : 2;
  const absolute = Math.abs(cents) / CENTS_IN_UNIT;
  const body = absolute.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sign = cents < 0 ? '−' : signed ? '+' : '';
  return `${sign}${withSymbol ? 'R$ ' : ''}${body}`;
}

/** Formata de forma compacta para eixos de gráfico: 1.2k, 980. */
export function formatCompact(cents: number): string {
  const value = Math.abs(cents) / CENTS_IN_UNIT;
  if (value >= 1000) return `${(Math.round(value / 100) / 10).toString().replace('.', ',')}k`;
  return String(Math.round(value));
}

/** Percentual seguro (nunca divide por zero), já limitado entre 0 e 100. */
export function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / total) * 100)));
}
