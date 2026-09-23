import { NavLink, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { NAV_ITEMS, isMoreSection } from './nav-items';
import { Button } from '@/components/atoms/Button';
import { useAuthStore } from '@/application/auth/auth.store';

/** Navegação principal no desktop (a partir do `sm`) — mesmas rotas da barra inferior do celular. */
export function TopNav() {
  const { pathname } = useLocation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  return (
    <header className="sticky top-0 z-20 hidden border-b border-line bg-card/95 backdrop-blur sm:block">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-5">
          <span className="font-display text-lg font-bold tracking-[-0.02em]">Grana</span>

          <nav aria-label="Navegação principal" className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {({ isActive }) => {
                  const active = isActive || (item.to === '/mais' && isMoreSection(pathname));
                  return (
                    <span
                      className={clsx(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                        active ? 'bg-ink text-surface' : 'text-soft hover:bg-line-soft',
                      )}
                    >
                      <span aria-hidden>{item.glyph}</span>
                      {item.label}
                    </span>
                  );
                }}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[13px] text-muted">{user?.email}</span>
          <Button variant="secondary" size="sm" onClick={() => void logout()}>
            Sair
          </Button>
        </div>
      </div>
    </header>
  );
}
