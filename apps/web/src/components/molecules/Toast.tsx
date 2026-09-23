import { clsx } from 'clsx';

export interface ToastProps {
  message: string;
  tone?: 'neutro' | 'erro';
}

/** Aviso curto. Fixo na viewport — some sozinho, quem controla é o provider. */
export function Toast({ message, tone = 'neutro' }: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'pointer-events-none fixed inset-x-5 bottom-[calc(86px+env(safe-area-inset-bottom))] z-30 rounded-2xl px-4 py-3 text-center text-[13px] font-medium shadow-lg sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-full sm:max-w-xs',
        tone === 'erro' ? 'bg-clay text-white' : 'bg-ink text-surface',
      )}
    >
      {message}
    </div>
  );
}
