export interface NavItem {
  to: string;
  label: string;
  glyph: string;
  end: boolean;
  /** O botão central de lançar tem tratamento visual próprio. */
  primary?: boolean;
}

/** Itens da navegação principal — compartilhados pela barra inferior (celular) e pelo topo (desktop). */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Início', glyph: '◍', end: true },
  { to: '/lista', label: 'Lista', glyph: '≡', end: false },
  { to: '/lancar', label: 'Lançar', glyph: '+', end: false, primary: true },
  { to: '/contas', label: 'Contas', glyph: '▤', end: false },
  { to: '/mais', label: 'Mais', glyph: '◔', end: false },
];

const MORE_SECTION_PATHS = ['/mais', '/parcelas', '/guardar', '/ajustes'];

/** "Mais" agrupa outras rotas (parcelas, guardar, ajustes) sob a mesma aba ativa. */
export function isMoreSection(pathname: string): boolean {
  return MORE_SECTION_PATHS.some((path) => pathname.startsWith(path));
}
