import type { ReactNode } from 'react';
import { BottomNav } from '@/components/organisms/BottomNav';

export interface PhoneShellProps {
  headerRight?: ReactNode;
  children: ReactNode;
  toast?: ReactNode;
}

/**
 * Moldura do app.
 *
 * No celular ela ocupa a tela inteira; no desktop vira o "aparelho" centralizado
 * do protótipo. Um único lugar decide isso — as páginas nunca falam de layout
 * externo, só do próprio conteúdo.
 */
export function PhoneShell({ headerRight, children, toast }: PhoneShellProps) {
  return (
    <div className="flex min-h-dvh flex-col items-center gap-5 bg-cream px-4 pt-6 pb-8 sm:pt-8">
      <header className="flex w-full max-w-[430px] items-baseline justify-between px-1">
        <span className="font-display text-lg font-bold tracking-[-0.02em]">Grana</span>
        {headerRight}
      </header>

      <div className="w-full max-w-[430px] rounded-[40px] bg-ink p-2.5 shadow-[0_24px_60px_-20px_rgba(20,19,15,0.45)]">
        <div className="relative flex h-[min(812px,78dvh)] flex-col overflow-hidden rounded-[32px] bg-surface sm:h-[812px]">
          <div className="no-scrollbar flex-1 overflow-y-auto overflow-x-hidden pb-[78px]">
            {children}
          </div>
          {toast}
          <BottomNav />
        </div>
      </div>
    </div>
  );
}
