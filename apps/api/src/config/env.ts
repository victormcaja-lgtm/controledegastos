import { z } from 'zod';

/**
 * Falhar rápido: se uma variável obrigatória estiver faltando ou malformada,
 * o processo nem sobe. É muito melhor quebrar no boot do que descobrir em
 * produção que `JWT_ACCESS_SECRET` era `undefined`.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória.'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa ter ao menos 32 caracteres.'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET precisa ter ao menos 32 caracteres.'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_DOMAIN: z.string().optional(),

  RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(200),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(3).default(8),

  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_NAME: z.string().optional(),
  SEED_DEMO_DATA: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema> & { corsOrigins: string[] };

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`\n❌ Variáveis de ambiente inválidas:\n${issues}\n`);
    process.exit(1);
  }

  const corsOrigins = parsed.data.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (parsed.data.NODE_ENV === 'production') {
    const weakSecret = [parsed.data.JWT_ACCESS_SECRET, parsed.data.JWT_REFRESH_SECRET].some(
      (secret) => secret.includes('troque-por'),
    );
    if (weakSecret) {
      console.error('\n❌ Os segredos JWT ainda são os de exemplo. Gere novos antes de subir.\n');
      process.exit(1);
    }
    if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
      console.error('\n❌ JWT_ACCESS_SECRET e JWT_REFRESH_SECRET precisam ser diferentes.\n');
      process.exit(1);
    }
  }

  return { ...parsed.data, corsOrigins };
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
