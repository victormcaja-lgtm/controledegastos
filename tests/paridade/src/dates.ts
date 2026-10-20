/**
 * Datas como texto (`YYYY-MM-DD`, `YYYY-MM`), em UTC — o mesmo critério que a
 * API usa quando não recebe `today`. Testes que dependem do relógio do servidor
 * calculam o esperado a partir daqui.
 */
const two = (value: number) => String(value).padStart(2, '0');

export function isoUTC(date: Date): string {
  return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`;
}

export const todayUTC = () => isoUTC(new Date());
export const currentMonth = () => todayUTC().slice(0, 7);

export function addDays(iso: string, amount: number): string {
  return isoUTC(new Date(Date.parse(`${iso}T00:00:00Z`) + amount * 86_400_000));
}

export function addMonths(month: string, amount: number): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const absolute = year * 12 + (m - 1) + amount;
  return `${Math.floor(absolute / 12)}-${two((((absolute % 12) + 12) % 12) + 1)}`;
}

export function daysInMonth(month: string): number {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/** Dia `day` da competência, limitado ao último dia do mês. */
export function dayOf(month: string, day: number): string {
  return `${month}-${two(Math.min(Math.max(1, day), daysInMonth(month)))}`;
}

export const lastDayOf = (month: string) => dayOf(month, 31);
