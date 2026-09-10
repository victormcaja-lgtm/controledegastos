import type { CategoryKind } from '@grana/shared';

export interface DefaultCategory {
  name: string;
  color: string;
  kind: CategoryKind;
}

/**
 * Categorias criadas junto com a conta. São marcadas como `isSystem` — o usuário
 * pode renomear e arquivar, mas não excluir, porque lançamentos antigos apontam
 * para elas e um relatório sem categoria é um relatório quebrado.
 */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Mercado', color: 'oklch(0.62 0.10 145)', kind: 'EXPENSE' },
  { name: 'Lazer', color: 'oklch(0.62 0.10 300)', kind: 'EXPENSE' },
  { name: 'Roupa', color: 'oklch(0.62 0.10 20)', kind: 'EXPENSE' },
  { name: 'Transporte', color: 'oklch(0.62 0.10 70)', kind: 'EXPENSE' },
  { name: 'Casa', color: 'oklch(0.62 0.10 250)', kind: 'EXPENSE' },
  { name: 'Educação', color: 'oklch(0.62 0.10 200)', kind: 'EXPENSE' },
  { name: 'Assinaturas', color: 'oklch(0.62 0.10 330)', kind: 'EXPENSE' },
  { name: 'Dívidas', color: 'oklch(0.62 0.10 40)', kind: 'EXPENSE' },
  { name: 'Salário', color: 'oklch(0.62 0.10 160)', kind: 'INCOME' },
  { name: 'Renda extra', color: 'oklch(0.62 0.10 120)', kind: 'INCOME' },
  { name: 'Bônus', color: 'oklch(0.62 0.10 90)', kind: 'INCOME' },
];
