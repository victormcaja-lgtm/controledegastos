import { clsx } from 'clsx';

export interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** Interruptor acessível: é um checkbox de verdade, só estilizado. */
export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'flex h-[26px] w-[46px] shrink-0 items-center rounded-full p-[3px] transition-colors',
        checked ? 'bg-green justify-end' : 'bg-chip-strong justify-start',
        disabled && 'opacity-50',
      )}
    >
      <span className="size-5 rounded-full bg-white shadow-sm" />
    </button>
  );
}
