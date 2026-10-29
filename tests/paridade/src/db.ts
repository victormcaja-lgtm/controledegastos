import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hash } from '@node-rs/argon2';
import { env } from './env.js';

/**
 * Acesso direto ao Postgres — só para PREPARAR e INSPECIONAR dados. O
 * comportamento é sempre observado pela API; o banco entra quando o teste
 * precisa de um estado que a API não deixa criar (ex.: conta bloqueada,
 * token expirado) ou para conferir o que foi gravado (ex.: hash do refresh).
 */
// As colunas de data-hora são `TIMESTAMP(3)` SEM fuso e guardam UTC (é o que a
// API grava). Sem isto, o driver lê e grava no fuso local da máquina.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (value) => new Date(`${value.replace(' ', 'T')}Z`));
pg.defaults.parseInputDatesAsUTC = true;

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 4 });

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/** Apaga tudo: usuários levam junto, em cascata, todo o dado financeiro. */
export async function resetDatabase(): Promise<void> {
  await sql('TRUNCATE TABLE "audit_logs", "users" RESTART IDENTITY CASCADE');
}

/** Mesmos parâmetros Argon2id da API (OWASP: 19 MiB, t=2, p=1). */
const ARGON = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const hashCache = new Map<string, string>();

export async function passwordHash(password: string): Promise<string> {
  const cached = hashCache.get(password);
  if (cached) return cached;
  const value = await hash(password, ARGON);
  hashCache.set(password, value);
  return value;
}

export interface InsertUserOptions {
  name?: string;
  email: string;
  password?: string;
  role?: 'ADMIN' | 'USER';
  status?: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
  mustChangePassword?: boolean;
  lockedUntil?: Date | null;
  failedLoginAttempts?: number;
  /** Também cria a linha de ajustes (o provisionamento da API faz isso). */
  withSettings?: boolean;
}

/** Insere um usuário direto no banco (sem categorias padrão). */
export async function insertUser(options: InsertUserOptions): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  await sql(
    `INSERT INTO "users" ("id","name","email","passwordHash","role","status","mustChangePassword",
       "failedLoginAttempts","lockedUntil","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
    [
      id,
      options.name ?? 'Pessoa de Teste',
      options.email.toLowerCase(),
      await passwordHash(options.password ?? 'SenhaForte123'),
      options.role ?? 'USER',
      options.status ?? 'ACTIVE',
      options.mustChangePassword ?? false,
      options.failedLoginAttempts ?? 0,
      options.lockedUntil ?? null,
    ],
  );
  if (options.withSettings ?? true) {
    await sql(`INSERT INTO "user_settings" ("userId","updatedAt") VALUES ($1, NOW())`, [id]);
  }
  return { id, email: options.email.toLowerCase() };
}
