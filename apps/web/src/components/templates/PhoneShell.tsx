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
 * No celular (abaixo do `sm`) só a área de conteúdo aparece, ocupando a tela
 * inteira — sem moldura, sem borda. A partir do `sm` (tablet/desktop) vira o
 * "aparelho" centralizado do protótipo, com o bezel escuro em volta. Um único
 * lugar decide isso — as páginas nunca falam de layout externo, só do próprio
 * conteúdo.
 */
export function PhoneShell({ headerRight, children, toast }: PhoneShellProps) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-cream sm:gap-5 sm:px-4 sm:pt-8 sm:pb-8">
      <header className="hidden w-full max-w-[430px] items-baseline justify-between px-1 sm:flex">
        <span className="font-display text-lg font-bold tracking-[-0.02em]">Grana</span>
        {headerRight}
      </header>

      <div className="w-full max-w-[430px] sm:rounded-[40px] sm:bg-ink sm:p-2.5 sm:shadow-[0_24px_60px_-20px_rgba(20,19,15,0.45)]">
        <div className="relative flex h-dvh flex-col overflow-hidden bg-surface sm:h-[812px] sm:rounded-[32px]">
          <div className="no-scrollbar flex-1 overflow-y-auto overflow-x-hidden pb-[calc(78px+env(safe-area-inset-bottom))]">
            {children}
          </div>
          {toast}
          <BottomNav />
        </div>
      </div>
    </div>
  );
}
