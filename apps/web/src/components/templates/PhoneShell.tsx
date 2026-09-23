import type { ReactNode } from 'react';
import { BottomNav } from '@/components/organisms/BottomNav';
import { TopNav } from '@/components/organisms/TopNav';

export interface PhoneShellProps {
  children: ReactNode;
  toast?: ReactNode;
}

/**
 * Casca do app autenticado.
 *
 * No celular (abaixo do `sm`) o conteúdo ocupa a tela inteira, sem moldura
 * nem borda decorativa — só a barra de navegação fixa no rodapé. A partir do
 * `sm` (tablet/desktop) vira uma página normal, com navegação fixa no topo e
 * o conteúdo centralizado numa coluna confortável de leitura — nada de
 * "aparelho" simulado com bezel: aquilo era só uma ilustração de protótipo,
 * não um limite real de layout.
 */
export function PhoneShell({ children, toast }: PhoneShellProps) {
  return (
    <div className="min-h-dvh bg-cream">
      <TopNav />

      <div className="mx-auto flex h-dvh max-w-2xl flex-col sm:h-auto sm:block">
        <div className="no-scrollbar flex-1 overflow-y-auto overflow-x-hidden pb-[calc(78px+env(safe-area-inset-bottom))] sm:overflow-visible sm:pt-6 sm:pb-12">
          {children}
        </div>
      </div>

      {toast}
      <BottomNav />
    </div>
  );
}
