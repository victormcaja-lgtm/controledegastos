import { z } from 'zod';

export const userRoleSchema = z.enum(['ADMIN', 'USER']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(['ACTIVE', 'SUSPENDED']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const categoryKindSchema = z.enum(['EXPENSE', 'INCOME']);
export type CategoryKind = z.infer<typeof categoryKindSchema>;

export const entryTypeSchema = z.enum(['EXPENSE', 'INCOME']);
export type EntryType = z.infer<typeof entryTypeSchema>;

/** Paleta padrão do app (mesmas cores do protótipo). */
export const CATEGORY_COLORS = [
  'oklch(0.62 0.10 145)',
  'oklch(0.62 0.10 300)',
  'oklch(0.62 0.10 20)',
  'oklch(0.62 0.10 70)',
  'oklch(0.62 0.10 250)',
  'oklch(0.62 0.10 200)',
  'oklch(0.62 0.10 330)',
  'oklch(0.62 0.10 40)',
  'oklch(0.62 0.10 160)',
  'oklch(0.62 0.10 120)',
  'oklch(0.62 0.10 90)',
] as const;

export function colorForIndex(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length]!;
}
