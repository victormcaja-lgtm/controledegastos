import { clsx } from 'clsx';

export interface ToastProps {
  message: string;
  tone?: 'neutro' | 'erro';
}

/** Aviso curto no rodapé do "celular". Some sozinho — quem controla é o provider. */
export function Toast({ message, tone = 'neutro' }: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'pointer-events-none absolute inset-x-5 bottom-[calc(86px+env(safe-area-inset-bottom))] z-20 rounded-2xl px-4 py-3 text-center text-[13px] font-medium shadow-lg',
        tone === 'erro' ? 'bg-clay text-white' : 'bg-ink text-surface',
      )}
    >
      {message}
    </div>
  );
}
