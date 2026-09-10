import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './client.js';
import { env, isProduction } from '../../../config/env.js';

/**
 * Conexão com o Postgres.
 *
 * Usamos o **driver adapter** `@prisma/adapter-pg`: o Prisma fala com o banco
 * pelo driver `pg` (Node puro) e o planejamento das queries roda no query
 * compiler em WebAssembly. Não há binário Rust envolvido — o que significa
 * imagem menor, cold start mais rápido e um deploy que não depende de baixar
 * engine nenhum na Railway.
 *
 * A pool é criada UMA vez por processo. Em desenvolvimento o `tsx watch`
 * recarrega o módulo a cada save; sem o cache no globalThis, cada reload abriria
 * uma pool nova até estourar o limite de conexões do Postgres.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    // A Railway encerra conexões ociosas; um pool enxuto com reciclagem evita o
    // clássico "Connection terminated unexpectedly" depois de alguns minutos.
    max: isProduction ? 10 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({ adapter, log: ['warn', 'error'] });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (!isProduction) globalForPrisma.prisma = prisma;

export type Db = PrismaClient;
