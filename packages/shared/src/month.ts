/**
 * "Competência" (mês de referência) é um conceito do domínio, não uma data.
 * Representamos como a string `YYYY-MM` — comparável, ordenável e serializável.
 */

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const MONTH_NAMES_SHORT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

export const MONTH_NAMES_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

export const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;

export type MonthRef = string; // `YYYY-MM`

export function isValidMonthRef(value: string): boolean {
  return MONTH_PATTERN.test(value);
}

export function toMonthRef(date: Date): MonthRef {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function currentMonthRef(now: Date = new Date()): MonthRef {
  return toMonthRef(now);
}

export function parseMonthRef(month: MonthRef): { year: number; monthIndex: number } {
  if (!isValidMonthRef(month)) {
    throw new Error(`Competência inválida: "${month}". Formato esperado: YYYY-MM.`);
  }
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  return { year, monthIndex: monthNumber - 1 };
}

export function addMonths(month: MonthRef, amount: number): MonthRef {
  const { year, monthIndex } = parseMonthRef(month);
  const absolute = year * 12 + monthIndex + amount;
  return `${Math.floor(absolute / 12)}-${String((((absolute % 12) + 12) % 12) + 1).padStart(2, '0')}`;
}

export function compareMonthRef(a: MonthRef, b: MonthRef): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Primeiro instante do mês, em UTC. É o valor gravado na coluna `referenceMonth`. */
export function monthStart(month: MonthRef): Date {
  const { year, monthIndex } = parseMonthRef(month);
  return new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
}

/** Primeiro instante do mês seguinte, em UTC (limite superior exclusivo). */
export function monthEnd(month: MonthRef): Date {
  const { year, monthIndex } = parseMonthRef(month);
  return new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
}

export function daysInMonth(month: MonthRef): number {
  const { year, monthIndex } = parseMonthRef(month);
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Dia da semana (0 = domingo) do dia 1 da competência. */
export function firstWeekdayOfMonth(month: MonthRef): number {
  return monthStart(month).getUTCDay();
}

export function monthLabel(month: MonthRef, style: 'short' | 'long' = 'long'): string {
  const { year, monthIndex } = parseMonthRef(month);
  const name = style === 'short' ? MONTH_NAMES_SHORT[monthIndex]! : MONTH_NAMES_LONG[monthIndex]!;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

export function monthNameShort(month: MonthRef): string {
  const { monthIndex } = parseMonthRef(month);
  return MONTH_NAMES_SHORT[monthIndex]!;
}

/** Converte uma data ISO (YYYY-MM-DD) para a competência correspondente. */
export function monthRefFromISODate(isoDate: string): MonthRef {
  return isoDate.slice(0, 7);
}

/** Data ISO (YYYY-MM-DD) a partir de competência + dia, limitando ao último dia do mês. */
export function isoDateFromMonthDay(month: MonthRef, day: number): string {
  const max = daysInMonth(month);
  const safeDay = Math.min(Math.max(1, Math.trunc(day)), max);
  return `${month}-${String(safeDay).padStart(2, '0')}`;
}

/** Índice da semana (0..3) de um dia do mês — usado no gráfico "Suas semanas". */
export function weekIndexOfDay(day: number): number {
  return Math.min(3, Math.max(0, Math.floor((day - 1) / 7)));
}
