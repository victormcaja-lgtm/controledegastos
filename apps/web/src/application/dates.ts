import { MONTH_NAMES_LONG } from '@grana/shared';

/**
 * Datas no formato `YYYY-MM-DD`, sempre no fuso do APARELHO — é o "hoje" que o
 * usuário enxerga. A API recebe esse valor para não errar o dia à noite
 * (o servidor roda em UTC).
 */
export function localTodayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

export function addDaysISO(iso: string, amount: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
}

export function lastDayOfMonthISO(iso: string): string {
  const [year, month] = iso.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** 15/10 */
export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** "Hoje", "Amanhã", "Ontem" ou "qua, 15 de outubro". */
export function dayLabel(iso: string, today: string): string {
  if (iso === today) return 'Hoje';
  if (iso === addDaysISO(today, 1)) return 'Amanhã';
  if (iso === addDaysISO(today, -1)) return 'Ontem';
  const date = new Date(`${iso}T00:00:00Z`);
  const weekday = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][date.getUTCDay()]!;
  return `${weekday}, ${Number(iso.slice(8, 10))} de ${MONTH_NAMES_LONG[date.getUTCMonth()]}`;
}
