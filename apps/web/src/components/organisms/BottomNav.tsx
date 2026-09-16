import { NavLink, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';

interface NavItem {
  to: string;
  label: string;
  glyph: string;
  end: boolean;
  /** O botão central de lançar tem tratamento visual próprio. */
  primary?: boolean;
}

const ITEMS: NavItem[] = [
  { to: '/', label: 'Início', glyph: '◍', end: true },
  { to: '/lista', label: 'Lista', glyph: '≡', end: false },
  { to: '/lancar', label: 'Lançar', glyph: '+', end: false, primary: true },
  { to: '/contas', label: 'Contas', glyph: '▤', end: false },
  { to: '/mais', label: 'Mais', glyph: '◔', end: false },
];

/** Barra inferior fixa — a navegação principal do app. */
export function BottomNav() {
  const { pathname } = useLocation();
  const inMore = ['/mais', '/parcelas', '/guardar', '/ajustes'].some((path) =>
    pathname.startsWith(path),
  );

  return (
    <nav
      aria-label="Navegação principal"
      className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-around border-t border-line bg-card/95 px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
    >
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className="flex w-[56px] flex-col items-center gap-1"
        >
          {({ isActive }) => {
            const active = isActive || (item.to === '/mais' && inMore);
            return (
              <>
                <span
                  aria-hidden
                  className={clsx(
                    'flex items-center justify-center text-[15px] transition-colors',
                    item.primary
                      ? 'h-[34px] w-[44px] rounded-[14px] bg-ink text-surface'
                      : active
                        ? 'size-[26px] rounded-[13px] bg-ink text-surface'
                        : 'size-[26px] text-faint',
                  )}
                >
                  {item.glyph}
                </span>
                <span
                  className={clsx(
                    'text-[10px] font-medium',
                    active || item.primary ? 'text-ink' : 'text-faint',
                  )}
                >
                  {item.label}
                </span>
              </>
            );
          }}
        </NavLink>
      ))}
    </nav>
  );
}
