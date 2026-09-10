import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface ToastMessage {
  message: string;
  tone: 'neutro' | 'erro';
}

interface ToastContextValue {
  toast: ToastMessage | null;
  show: (message: string) => void;
  showError: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Avisos curtos, um por vez, com auto-dismiss.
 *
 * Fica no contexto (e não num store global) porque é estado puramente de UI e
 * some sozinho — não é algo que outra parte do sistema precise consultar.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback((message: string, tone: 'neutro' | 'erro') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone });
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      show: (message) => push(message, 'neutro'),
      showError: (message) => push(message, 'erro'),
    }),
    [toast, push],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast precisa estar dentro de <ToastProvider>.');
  return context;
}
