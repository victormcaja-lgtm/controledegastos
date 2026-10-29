import pg from 'pg';
import type { UserContext } from './plan.js';

/** Acesso ao banco SÓ para leitura: sortear a amostra, montar os GETs e contar linhas. */
export type Db = pg.Pool;

export function connect(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl, max: 2 });
}

export interface SampledUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'USER';
}

/**
 * Sorteia até `size` usuários ATIVOS (suspensos e pendentes recebem o mesmo 403 em
 * tudo e não exercitam nada). A ordem é `md5(semente || id)`: com a mesma semente,
 * a mesma amostra, sem depender do gerador aleatório do processo.
 */
export async function sampleUsers(db: Db, size: number, seed: string): Promise<SampledUser[]> {
  const { rows } = await db.query<SampledUser>(
    `SELECT "id", "email", "role" FROM "users"
      WHERE "status" = 'ACTIVE'
      ORDER BY md5($1 || "id")
      LIMIT $2`,
    [seed, size],
  );
  return rows;
}

/** Um administrador ativo para os GETs de `/api/admin/users` (ou `undefined` se não houver). */
export async function findAdmin(db: Db): Promise<SampledUser | undefined> {
  const { rows } = await db.query<SampledUser>(
    `SELECT "id", "email", "role" FROM "users"
      WHERE "status" = 'ACTIVE' AND "role" = 'ADMIN'
      ORDER BY "createdAt", "id"
      LIMIT 1`,
  );
  return rows[0];
}

export async function loadUserContext(db: Db, userId: string): Promise<UserContext> {
  const months = await db.query<{ month: string }>(
    `SELECT DISTINCT to_char("occurredOn", 'YYYY-MM') AS "month" FROM "transactions"
      WHERE "userId" = $1
      ORDER BY 1 DESC`,
    [userId],
  );
  const cards = await db.query<{ id: string }>(
    `SELECT "id" FROM "cards" WHERE "userId" = $1 ORDER BY "createdAt", "id"`,
    [userId],
  );
  return {
    id: userId,
    transactionMonths: months.rows.map((row) => row.month),
    cardIds: cards.rows.map((row) => row.id),
  };
}

/**
 * Tabelas e a coluna que liga cada linha a um usuário (para a contagem por usuário).
 * `goal_deposits` não tem `userId`: chega ao dono pela meta.
 */
const TABLES: Record<string, { from: string; owner: string }> = {
  users: { from: '"users"', owner: '"id"' },
  refresh_tokens: { from: '"refresh_tokens"', owner: '"userId"' },
  audit_logs: { from: '"audit_logs"', owner: '"actorId"' },
  user_settings: { from: '"user_settings"', owner: '"userId"' },
  categories: { from: '"categories"', owner: '"userId"' },
  transactions: { from: '"transactions"', owner: '"userId"' },
  bills: { from: '"bills"', owner: '"userId"' },
  bill_payments: { from: '"bill_payments"', owner: '"userId"' },
  incomes: { from: '"incomes"', owner: '"userId"' },
  debts: { from: '"debts"', owner: '"userId"' },
  goals: { from: '"goals"', owner: '"userId"' },
  goal_deposits: { from: '"goal_deposits" d JOIN "goals" g ON g."id" = d."goalId"', owner: 'g."userId"' },
  cards: { from: '"cards"', owner: '"userId"' },
  card_purchases: { from: '"card_purchases"', owner: '"userId"' },
};

/** `{ "transactions": 1234, "transactions/<userId>": 56, ... }` */
export type Counts = Record<string, number>;

/**
 * Conta as linhas de cada tabela, no total e por usuário da amostra. O verificador
 * só faz GET: se alguma contagem mudar entre o antes e o depois, algum GET gravou
 * no banco (ou houve escrita concorrente na homologação), e isso é relatado.
 */
export async function countRows(db: Db, userIds: readonly string[]): Promise<Counts> {
  const counts: Counts = {};
  for (const [table, { from, owner }] of Object.entries(TABLES)) {
    const total = await db.query<{ n: string }>(`SELECT count(*) AS "n" FROM "${table}"`);
    counts[table] = Number(total.rows[0]?.n ?? 0);

    const perUser = await db.query<{ owner: string; n: string }>(
      `SELECT ${owner} AS "owner", count(*) AS "n" FROM ${from} WHERE ${owner} = ANY($1) GROUP BY 1`,
      [userIds],
    );
    const byOwner = new Map(perUser.rows.map((row) => [row.owner, Number(row.n)]));
    for (const id of userIds) counts[`${table}/${id}`] = byOwner.get(id) ?? 0;
  }
  return counts;
}

export interface CountChange {
  key: string;
  before: number;
  after: number;
}

export function compareCounts(before: Counts, after: Counts): CountChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .sort()
    .filter((key) => before[key] !== after[key])
    .map((key) => ({ key, before: before[key] ?? 0, after: after[key] ?? 0 }));
}
