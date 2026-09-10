import { clsx } from 'clsx';
import { WEEKDAY_INITIALS } from '@grana/shared';

export interface CalendarGridProps {
  days: Array<{ day: number | null; isToday: boolean; hasBill: boolean; allPaid: boolean }>;
}

export function CalendarGrid({ days }: CalendarGridProps) {
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <span key={`${initial}-${index}`}>{initial}</span>
        ))}
      </div>

      <div className="mt-1.5 grid grid-cols-7 gap-1">
        {days.map((cell, index) => (
          <div
            key={index}
            className={clsx(
              'relative flex h-9 items-center justify-center rounded-[10px] text-[12.5px]',
              cell.isToday
                ? 'bg-ink font-semibold text-surface'
                : cell.hasBill
                  ? 'bg-line-soft text-soft'
                  : 'text-soft',
            )}
          >
            {cell.day ?? ''}
            {cell.hasBill && (
              <span
                aria-hidden
                className={clsx(
                  'absolute bottom-1 size-1.5 rounded-full',
                  cell.allPaid ? 'bg-mint' : 'bg-clay',
                )}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
