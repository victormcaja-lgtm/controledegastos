import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/atoms/Button';
import { useAuthStore } from '@/application/auth/auth.store';

export interface AdminLayoutProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * A área administrativa é a única tela que NÃO usa a moldura de celular:
 * gerenciar usuários é trabalho de mesa, com tabela e espaço horizontal.
 */
export function AdminLayout({ title, description, actions, children }: AdminLayoutProps) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="font-display text-lg font-bold tracking-[-0.02em]">Grana</span>
            <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold tracking-wide text-surface">
              ADMIN
            </span>
          </div>

          <nav className="flex items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm">
                Meu financeiro
              </Button>
            </Link>
            <span className="hidden text-[13px] text-muted sm:inline">{user?.email}</span>
            <Button variant="secondary" size="sm" onClick={() => void logout()}>
              Sair
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
            {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
          </div>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}
