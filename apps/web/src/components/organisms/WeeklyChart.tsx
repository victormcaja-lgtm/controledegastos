import { clsx } from 'clsx';
import { formatCompact } from '@grana/shared';

export interface WeeklyChartProps {
  weeks: Array<{
    index: number;
    label: string;
    totalCents: number;
    heightPercent: number;
    current: boolean;
  }>;
}

/**
 * Barras de gasto por semana.
 *
 * Além do gráfico, existe uma tabela visualmente escondida com os mesmos
 * números: quem usa leitor de tela recebe o dado, não "gráfico, imagem".
 */
export function WeeklyChart({ weeks }: WeeklyChartProps) {
  return (
    <>
      <div aria-hidden className="mt-4 flex h-24 items-end gap-[10px]">
        {weeks.map((week) => (
          <div
            key={week.index}
            className="flex h-full flex-1 flex-col items-center justify-end gap-2"
          >
            <span className="font-display text-[11px] text-soft">{week.label}</span>
            <div
              className={clsx(
                'w-full rounded-lg transition-all',
                week.current ? 'bg-ink' : 'bg-pebble',
              )}
              style={{ height: `${Math.max(6, (week.heightPercent / 100) * 62)}px` }}
            />
            <span className="text-[11px] text-muted">
              {week.totalCents ? `R$ ${formatCompact(week.totalCents)}` : '—'}
            </span>
          </div>
        ))}
      </div>

      <table className="sr-only">
        <caption>Gasto por semana do mês</caption>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.index}>
              <th scope="row">Semana {week.index + 1}</th>
              <td>{(week.totalCents / 100).toFixed(2)} reais</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
