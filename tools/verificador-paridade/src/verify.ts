import type { Config } from './config.js';
import { compareCounts, countRows, findAdmin, loadUserContext, sampleUsers, type CountChange, type Db } from './db.js';
import { diffJson, type Difference } from './diff.js';
import { getSnapshot, mapLimit, nextIp, type Snapshot } from './http.js';
import { planAdminRequests, planUserRequests, type ModuleName, type PlannedRequest } from './plan.js';
import { signAccessToken } from './token.js';

export interface RequestResult {
  module: ModuleName;
  path: string;
  /** Usuário cujo token foi usado. */
  userId: string;
  status: { node: number | null; dotnet: number | null };
  differences: Difference[];
  /** Falha de rede ou tempo esgotado em algum dos lados. */
  error?: string;
}

export interface Report {
  startedAt: string;
  finishedAt: string;
  seed: string;
  today: string;
  nodeUrl: string;
  dotnetUrl: string;
  modules: ModuleName[];
  sampledUsers: number;
  /** `false` quando não há administrador ativo: os GETs de `/api/admin/users` ficam de fora. */
  adminChecked: boolean;
  totalRequests: number;
  perModule: Partial<Record<ModuleName, { requests: number; different: number }>>;
  /** Só as requisições com diferença (as iguais entram apenas na contagem). */
  different: RequestResult[];
  countChanges: CountChange[];
}

/** O verificador considera `ok` só com 0 diferenças nas respostas E nas contagens. */
export function isClean(report: Report): boolean {
  return report.different.length === 0 && report.countChanges.length === 0;
}

interface Job {
  request: PlannedRequest;
  user: { id: string; email: string; role: 'ADMIN' | 'USER' };
}

async function compare(config: Config, job: Job): Promise<RequestResult> {
  const token = signAccessToken(job.user, config.jwtSecret);
  const ip = nextIp();
  const result: RequestResult = {
    module: job.request.module,
    path: job.request.path,
    userId: job.user.id,
    status: { node: null, dotnet: null },
    differences: [],
  };
  let node: Snapshot;
  let dotnet: Snapshot;
  try {
    // Em sequência, não em paralelo: o mais perto possível no tempo, mas sem
    // disputar o mesmo banco no mesmo instante.
    node = await getSnapshot(config.nodeUrl, job.request.path, token, ip);
    dotnet = await getSnapshot(config.dotnetUrl, job.request.path, token, ip);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
  result.status = { node: node.status, dotnet: dotnet.status };
  if (node.status !== dotnet.status) {
    result.differences.push({ path: '(status)', node: node.status, dotnet: dotnet.status });
  }
  result.differences.push(...diffJson(node.body, dotnet.body));
  return result;
}

export async function verify(config: Config, db: Db, log: (line: string) => void = () => {}): Promise<Report> {
  const startedAt = new Date().toISOString();
  const users = await sampleUsers(db, config.sampleSize, config.seed);
  log(`Amostra: ${users.length} usuário(s) ativo(s) (semente ${config.seed}).`);
  const userIds = users.map((user) => user.id);

  const before = await countRows(db, userIds);

  const jobs: Job[] = [];
  for (const user of users) {
    const context = await loadUserContext(db, user.id);
    for (const request of planUserRequests(context, config.today, config.modules)) jobs.push({ request, user });
  }
  const admin = await findAdmin(db);
  if (admin) {
    for (const request of planAdminRequests(userIds, config.modules)) jobs.push({ request, user: admin });
  } else if (config.modules.includes('Identity')) {
    log('Aviso: nenhum administrador ativo; GETs de /api/admin/users ficam de fora.');
  }
  log(`Comparando ${jobs.length} GET(s) em ${config.modules.length} módulo(s)...`);

  let done = 0;
  const results = await mapLimit(jobs, config.concurrency, async (job) => {
    const result = await compare(config, job);
    done += 1;
    if (done % 100 === 0) log(`  ${done}/${jobs.length}`);
    return result;
  });

  const after = await countRows(db, userIds);

  const perModule: Report['perModule'] = {};
  const different: RequestResult[] = [];
  for (const result of results) {
    const entry = (perModule[result.module] ??= { requests: 0, different: 0 });
    entry.requests += 1;
    if (result.error || result.differences.length > 0) {
      entry.different += 1;
      different.push(result);
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    seed: config.seed,
    today: config.today,
    nodeUrl: config.nodeUrl,
    dotnetUrl: config.dotnetUrl,
    modules: config.modules,
    sampledUsers: users.length,
    adminChecked: admin !== undefined,
    totalRequests: results.length,
    perModule,
    different,
    countChanges: compareCounts(before, after),
  };
}
