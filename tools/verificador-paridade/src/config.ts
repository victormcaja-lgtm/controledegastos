import { randomBytes } from 'node:crypto';
import { MODULES, type ModuleName } from './plan.js';

/**
 * Configuração por variáveis de ambiente. O verificador só faz GET e SELECT:
 * pode rodar quantas vezes for preciso contra a homologação, sem efeito colateral.
 */
export interface Config {
  /** API Node chamada DIRETO (sem passar pela fachada). */
  nodeUrl: string;
  /** API .NET chamada direto, ou a fachada quando o módulo ainda está em `node`. */
  dotnetUrl: string;
  databaseUrl: string;
  /** O mesmo `JWT_ACCESS_SECRET` dos dois backends: o verificador emite os tokens (R-02). */
  jwtSecret: string;
  sampleSize: number;
  /** Semente do sorteio: com a mesma semente, a mesma amostra (para repetir uma execução). */
  seed: string;
  modules: ModuleName[];
  /** "Hoje" usado nos parâmetros `today`, `month` e nos intervalos do saldo futuro. */
  today: string;
  concurrency: number;
  /** Caminho opcional do relatório em JSON. */
  reportPath: string | undefined;
}

export class ConfigError extends Error {}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`Defina ${name}.`);
  return value;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new ConfigError(`${name} precisa ser um inteiro positivo.`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, now = new Date()): Config {
  const today = env.VERIFICADOR_HOJE?.trim() || now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || Number.isNaN(Date.parse(`${today}T00:00:00Z`))) {
    throw new ConfigError('VERIFICADOR_HOJE precisa estar no formato AAAA-MM-DD.');
  }

  const rawModules = env.VERIFICADOR_MODULOS?.trim();
  const modules = rawModules
    ? rawModules.split(',').map((name) => name.trim()).filter(Boolean)
    : [...MODULES];
  const unknown = modules.filter((name) => !(MODULES as readonly string[]).includes(name));
  if (unknown.length > 0) {
    throw new ConfigError(`Módulo desconhecido: ${unknown.join(', ')}. Use: ${MODULES.join(', ')}.`);
  }

  return {
    nodeUrl: required(env, 'VERIFICADOR_URL_NODE').replace(/\/$/, ''),
    dotnetUrl: required(env, 'VERIFICADOR_URL_DOTNET').replace(/\/$/, ''),
    databaseUrl: required(env, 'VERIFICADOR_DATABASE_URL'),
    jwtSecret: required(env, 'VERIFICADOR_JWT_SECRET'),
    sampleSize: positiveInt(env, 'VERIFICADOR_AMOSTRA', 50),
    seed: env.VERIFICADOR_SEMENTE?.trim() || randomBytes(4).toString('hex'),
    modules: modules as ModuleName[],
    today,
    concurrency: positiveInt(env, 'VERIFICADOR_CONCORRENCIA', 4),
    reportPath: env.VERIFICADOR_RELATORIO?.trim() || undefined,
  };
}
