import { z } from 'zod';
import { MONTH_PATTERN } from './month.js';

/** Identificador de recurso — CUID2 gerado pelo banco. */
export const idSchema = z.string().min(8).max(64);

/** Competência YYYY-MM. */
export const monthRefSchema = z
  .string()
  .regex(MONTH_PATTERN, 'Competência inválida. Use o formato AAAA-MM.');

/** Data ISO simples YYYY-MM-DD. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida. Use o formato AAAA-MM-DD.')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Data inexistente.');

/** Valor monetário em centavos: inteiro positivo, teto de R$ 100 milhões. */
export const centsSchema = z
  .number()
  .int('O valor deve estar em centavos (número inteiro).')
  .positive('O valor precisa ser maior que zero.')
  .max(10_000_000_000, 'Valor acima do limite suportado.');

/** Igual a `centsSchema`, mas aceita zero (ex.: quanto já foi guardado numa meta). */
export const centsOrZeroSchema = z
  .number()
  .int('O valor deve estar em centavos (número inteiro).')
  .min(0, 'O valor não pode ser negativo.')
  .max(10_000_000_000, 'Valor acima do limite suportado.');

export const dayOfMonthSchema = z
  .number()
  .int()
  .min(1, 'O dia precisa estar entre 1 e 31.')
  .max(31, 'O dia precisa estar entre 1 e 31.');

export const colorSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(
    /^(#[0-9a-fA-F]{3,8}|oklch\([^)]+\)|rgb\([^)]+\)|hsl\([^)]+\))$/,
    'Cor inválida. Use hex, oklch(), rgb() ou hsl().',
  );

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Informe pelo menos 2 caracteres.')
  .max(60, 'Máximo de 60 caracteres.');

export const noteSchema = z.string().trim().max(140, 'Máximo de 140 caracteres.');

/**
 * Política de senha. Deliberadamente favorece comprimento sobre símbolos
 * obrigatórios (recomendação NIST SP 800-63B), mas exige variedade mínima
 * porque este é um sistema com perfil administrativo.
 */
export const passwordSchema = z
  .string()
  .min(10, 'A senha precisa ter pelo menos 10 caracteres.')
  .max(128, 'A senha pode ter no máximo 128 caracteres.')
  .refine((value) => /[a-z]/.test(value), 'Inclua ao menos uma letra minúscula.')
  .refine((value) => /[A-Z]/.test(value), 'Inclua ao menos uma letra maiúscula.')
  .refine((value) => /\d/.test(value), 'Inclua ao menos um número.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(160)
  .pipe(z.email('E-mail inválido.'));

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    perPage: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  });
}

/** Envelope padrão de erro da API. */
export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  code: z.string(),
  message: z.string(),
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
