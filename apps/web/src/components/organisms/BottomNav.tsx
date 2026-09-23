import { NavLink, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { NAV_ITEMS, isMoreSection } from './nav-items';

/** Barra inferior fixa — a navegação principal do app no celular (só abaixo do `sm`). */
export function BottomNav() {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-around border-t border-line bg-card/95 px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden"
    >
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className="flex w-[56px] flex-col items-center gap-1"
        >
          {({ isActive }) => {
            const active = isActive || (item.to === '/mais' && isMoreSection(pathname));
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
