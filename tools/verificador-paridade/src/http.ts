export interface Snapshot {
  status: number;
  /** JSON já interpretado, ou o texto cru quando o corpo não é JSON. */
  body: unknown;
}

// Os dois backends aplicam rate limit global por IP (200/min). O cliente é o
// último valor do X-Forwarded-For (RN-162/D-02), então cada chamada sai de um IP
// diferente, como na suíte de paridade. O par Node/.NET de uma mesma requisição
// usa o mesmo IP.
let ipCounter = Math.floor(Math.random() * 0xffffff);
export function nextIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export async function getSnapshot(baseUrl: string, path: string, token: string, ip: string): Promise<Snapshot> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'x-forwarded-for': ip },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Corpo que não é JSON é comparado como texto.
  }
  return { status: response.status, body };
}

/** Roda `task` sobre cada item com no máximo `limit` em paralelo, preservando a ordem. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
