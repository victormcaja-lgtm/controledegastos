const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'] as const;

export interface KeypadProps {
  onPress: (key: string) => void;
}

/** Teclado numérico do lançamento. Digita-se em centavos: "1250" = R$ 12,50. */
export function Keypad({ onPress }: KeypadProps) {
  return (
    <div className="grid grid-cols-3 gap-2 px-4 pt-3">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onPress(key)}
          aria-label={key === 'del' ? 'Apagar último dígito' : key}
          className="h-[52px] rounded-2xl bg-card font-display text-xl font-medium text-ink transition-colors hover:bg-chip active:bg-chip-strong"
        >
          {key === 'del' ? '←' : key}
        </button>
      ))}
    </div>
  );
}
