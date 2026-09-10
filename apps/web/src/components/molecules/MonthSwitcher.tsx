import { addMonths, monthLabel, type MonthRef } from '@grana/shared';

export interface MonthSwitcherProps {
  month: MonthRef;
  onChange: (month: MonthRef) => void;
  subtitle?: string;
}

export function MonthSwitcher({ month, onChange, subtitle }: MonthSwitcherProps) {
  return (
    <div className="mb-[18px] flex items-center justify-between">
      <button
        type="button"
        aria-label="Mês anterior"
        onClick={() => onChange(addMonths(month, -1))}
        className="flex size-[34px] items-center justify-center rounded-full bg-chip text-[15px] transition-colors hover:bg-chip-strong"
      >
        ‹
      </button>

      <div className="text-center">
        <p className="font-display text-[15px] font-semibold">{monthLabel(month)}</p>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p>}
      </div>

      <button
        type="button"
        aria-label="Próximo mês"
        onClick={() => onChange(addMonths(month, 1))}
        className="flex size-[34px] items-center justify-center rounded-full bg-chip text-[15px] transition-colors hover:bg-chip-strong"
      >
        ›
      </button>
    </div>
  );
}
