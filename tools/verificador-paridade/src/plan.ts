/**
 * Quais GETs comparar para cada usuário da amostra.
 *
 * Os nomes dos módulos são os da chave `Strangler:Modules:<Módulo>` (plano.md §6.2),
 * para que `VERIFICADOR_MODULOS` filtre exatamente o que está sendo virado.
 */
export const MODULES = [
  'Settings',
  'Incomes',
  'Categories',
  'Transactions',
  'Debts',
  'Goals',
  'Bills',
  'Cards',
  'Dashboard',
  'Cashflow',
  'Identity',
] as const;
export type ModuleName = (typeof MODULES)[number];

export interface PlannedRequest {
  module: ModuleName;
  /** Caminho com query string, ex.: `/api/bills?month=2026-10`. */
  path: string;
}

/** O que o banco diz sobre um usuário e que muda quais GETs fazem sentido. */
export interface UserContext {
  id: string;
  /** Meses (`AAAA-MM`) em que o usuário tem lançamentos, do mais recente ao mais antigo. */
  transactionMonths: string[];
  cardIds: string[];
}

/** Soma `delta` meses a um `AAAA-MM`. */
export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (monthNumber - 1) + delta;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** Soma `delta` dias a um `AAAA-MM-DD` (em UTC, como a API). */
export function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

/** Até quantos meses com lançamentos, além do atual e do anterior, entram na comparação. */
const EXTRA_TRANSACTION_MONTHS = 2;

export function planUserRequests(user: UserContext, today: string, modules: readonly ModuleName[]): PlannedRequest[] {
  const enabled = new Set(modules);
  const current = today.slice(0, 7);
  const previous = addMonths(current, -1);
  const next = addMonths(current, 1);
  const requests: PlannedRequest[] = [];
  const add = (module: ModuleName, path: string) => {
    if (enabled.has(module)) requests.push({ module, path });
  };

  add('Identity', '/api/auth/me');

  add('Settings', '/api/settings');
  add('Incomes', '/api/incomes');
  add('Categories', '/api/categories');
  add('Categories', '/api/categories?includeArchived=true');

  add('Transactions', '/api/transactions');
  add('Transactions', '/api/transactions?page=2&perPage=5');
  const months = [current, previous, ...user.transactionMonths.slice(0, EXTRA_TRANSACTION_MONTHS)];
  for (const month of new Set(months)) add('Transactions', `/api/transactions?month=${month}&perPage=100`);
  add('Transactions', '/api/transactions?type=INCOME&perPage=100');

  add('Debts', '/api/debts');
  add('Goals', '/api/goals');

  for (const month of [previous, current, next]) add('Bills', `/api/bills?month=${month}`);
  add('Bills', `/api/bills/overdue?today=${today}`);

  add('Cards', `/api/cards?today=${today}`);
  for (const cardId of user.cardIds) {
    add('Cards', `/api/cards/${cardId}/invoice`);
    add('Cards', `/api/cards/${cardId}/invoice?month=${current}`);
    add('Cards', `/api/cards/${cardId}/invoice?month=${next}`);
  }

  for (const month of [current, previous]) {
    add('Dashboard', `/api/dashboard?month=${month}`);
    add('Dashboard', `/api/reports/categories?month=${month}`);
  }

  add('Cashflow', `/api/cashflow?from=${today}&to=${addDays(today, 90)}&today=${today}`);
  add('Cashflow', `/api/cashflow?from=${addDays(today, -30)}&to=${addDays(today, 30)}&today=${today}`);

  return requests;
}

/** GETs da área administrativa: feitos uma vez, com o token de um administrador. */
export function planAdminRequests(sampledUserIds: readonly string[], modules: readonly ModuleName[]): PlannedRequest[] {
  if (!modules.includes('Identity')) return [];
  return [
    { module: 'Identity', path: '/api/admin/users?perPage=100' },
    { module: 'Identity', path: '/api/admin/users?status=ACTIVE&perPage=100' },
    ...sampledUserIds.map((id) => ({ module: 'Identity' as const, path: `/api/admin/users/${id}` })),
  ];
}
