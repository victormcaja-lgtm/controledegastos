import { formatMoney } from '@grana/shared';
import { shortDate } from '@/application/dates';

export interface BalancePoint {
  date: string;
  balanceCents: number;
}

export interface BalanceChartProps {
  days: BalancePoint[];
  today: string;
  /** Segunda série (ex.: saldo com a compra simulada), desenhada por cima. */
  compare?: BalancePoint[] | undefined;
  /** Dia a destacar (o menor saldo). */
  highlight?: BalancePoint | null | undefined;
  height?: number;
}

const WIDTH = 320;

/**
 * Linha do saldo: trecho real sólido, previsão tracejada, linha do zero quando
 * o saldo cruza para o negativo e um ponto no dia mais apertado.
 *
 * SVG puro, esticado na largura com `preserveAspectRatio="none"`; o traço não
 * deforma (`non-scaling-stroke`) e o marcador é HTML posicionado em %, para
 * continuar redondo em qualquer largura.
 */
export function BalanceChart({ days, today, compare, highlight, height = 120 }: BalanceChartProps) {
  if (days.length < 2) return null;

  const values = [...days, ...(compare ?? [])].map((day) => day.balanceCents);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const pad = 8;

  const x = (index: number) => (index / (days.length - 1)) * WIDTH;
  const y = (cents: number) => pad + ((max - cents) / span) * (height - pad * 2);

  const indexOf = new Map(days.map((day, index) => [day.date, index]));
  const todayIndex = days.findIndex((day) => day.date >= today);

  const path = (points: BalancePoint[]) =>
    points
      .map((point, i) => {
        const index = indexOf.get(point.date) ?? i;
        return `${i === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.balanceCents).toFixed(2)}`;
      })
      .join(' ');

  const past = todayIndex === -1 ? days : days.slice(0, todayIndex + 1);
  const future = todayIndex === -1 ? [] : days.slice(Math.max(0, todayIndex));
  const crossesZero = min < 0;

  const marker = highlight && indexOf.has(highlight.date) ? highlight : null;
  const first = days[0]!;
  const last = days[days.length - 1]!;

  return (
    <figure className="mt-4">
      <div
        className="relative w-full"
        style={{ height }}
        role="img"
        aria-label={`Saldo de ${shortDate(first.date)} a ${shortDate(last.date)}: começa em ${formatMoney(
          first.balanceCents,
        )} e termina em ${formatMoney(last.balanceCents)}${
          marker
            ? `; o menor saldo é ${formatMoney(marker.balanceCents)} em ${shortDate(marker.date)}`
            : ''
        }.`}
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          aria-hidden
        >
          {crossesZero && (
            <>
              <rect
                x={0}
                y={y(0)}
                width={WIDTH}
                height={Math.max(0, height - y(0))}
                className="fill-clay/10"
              />
              <line
                x1={0}
                x2={WIDTH}
                y1={y(0)}
                y2={y(0)}
                className="stroke-clay"
                strokeWidth={1}
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}

          {todayIndex > 0 && (
            <line
              x1={x(todayIndex)}
              x2={x(todayIndex)}
              y1={0}
              y2={height}
              className="stroke-line"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}

          <path
            d={path(past)}
            fill="none"
            className="stroke-ink"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {future.length > 1 && (
            <path
              d={path(future)}
              fill="none"
              className="stroke-green"
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {compare && compare.length > 1 && (
            <path
              d={path(compare)}
              fill="none"
              className="stroke-clay"
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {marker && (
          <span
            aria-hidden
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-clay"
            style={{
              left: `${(x(indexOf.get(marker.date)!) / WIDTH) * 100}%`,
              top: `${(y(marker.balanceCents) / height) * 100}%`,
            }}
          />
        )}
      </div>

      <figcaption className="mt-2 flex justify-between text-[11px] text-muted" aria-hidden>
        <span>{shortDate(first.date)}</span>
        {todayIndex > 0 && todayIndex < days.length - 1 && <span>hoje</span>}
        <span>{shortDate(last.date)}</span>
      </figcaption>
    </figure>
  );
}
