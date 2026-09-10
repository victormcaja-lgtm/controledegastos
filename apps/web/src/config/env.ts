import { z } from 'zod';

/**
 * Ambiente do front, validado no boot.
 *
 * Só variáveis com prefixo `VITE_` chegam ao browser — e tudo aqui é PÚBLICO.
 * Nunca coloque segredo neste arquivo: ele vai inteiro para o bundle.
 */
const schema = z.object({
  VITE_API_URL: z.url('VITE_API_URL precisa ser uma URL válida.'),
});

const parsed = schema.safeParse(import.meta.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Variáveis de ambiente inválidas:\n${issues.join('\n')}`);
}

export const env = {
  apiUrl: parsed.data.VITE_API_URL.replace(/\/$/, ''),
  isDev: import.meta.env.DEV,
};
