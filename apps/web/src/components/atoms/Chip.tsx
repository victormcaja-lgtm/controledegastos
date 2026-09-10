import { clsx } from 'clsx';

export interface ChipProps {
  label: string;
  selected?: boolean;
  dotColor?: string;
  dashed?: boolean;
  onClick?: () => void;
}

/** Pílula selecionável — usada nas categorias e nos filtros. */
export function Chip({ label, selected = false, dotColor, dashed = false, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'inline-flex items-center gap-[7px] rounded-[14px] px-[13px] py-[9px] text-[13px] font-medium transition-colors',
        dashed
          ? 'border border-dashed border-pebble bg-transparent text-soft hover:bg-card'
          : selected
            ? 'border border-ink bg-ink text-surface'
            : 'border border-line bg-card text-ink hover:bg-chip',
      )}
    >
      {dotColor && (
        <span aria-hidden className="size-[9px] rounded-full" style={{ background: dotColor }} />
      )}
      {label}
    </button>
  );
}
