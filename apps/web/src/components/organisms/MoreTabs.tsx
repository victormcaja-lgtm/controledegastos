import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';
import { features } from '@/config/env';

const TABS = [
  ...(features.saldoFuturo
    ? [
        { to: '/resultado', label: 'Resultado', end: false },
        { to: '/cartoes', label: 'Cartões', end: false },
      ]
    : []),
  { to: '/mais', label: 'Categorias', end: true },
  { to: '/parcelas', label: 'Parcelas', end: false },
  { to: '/guardar', label: 'Guardar', end: false },
  { to: '/ajustes', label: 'Ajustes', end: false },
];

/** Sub-navegação das telas agrupadas em "Mais". */
export function MoreTabs() {
  return (
    <nav aria-label="Seções" className="no-scrollbar -mx-5 mb-4 flex gap-2 overflow-x-auto px-5">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end}>
          {({ isActive }) => (
            <span
              className={clsx(
                'inline-block rounded-[14px] border px-[13px] py-[9px] text-[13px] font-medium whitespace-nowrap transition-colors',
                isActive ? 'border-ink bg-ink text-surface' : 'border-line bg-card text-soft',
              )}
            >
              {tab.label}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
