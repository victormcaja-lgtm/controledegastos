import { env } from './env.js';

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  /** Corpo cru (para respostas sem JSON). */
  text: string;
  headers: Headers;
  /** Linhas `Set-Cookie`, uma por cookie. */
  setCookies: string[];
}

export interface RequestOptions {
  token?: string | undefined;
  body?: unknown;
  /** Corpo cru, já serializado (para testar JSON malformado etc.). */
  rawBody?: string;
  cookie?: string | undefined;
  headers?: Record<string, string>;
}

let ipCounter = 0;
/**
 * A API identifica o cliente pelo `X-Forwarded-For` (fica atrás do proxy da
 * Railway). Cada chamada sai de um IP diferente, para que os rate limits por
 * IP não vazem de um teste para outro; quem testa o rate limit fixa o IP.
 */
export function nextIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

/** Uma chamada HTTP à API sob teste — nada além do que o front faria. */
export async function call<T = any>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-forwarded-for': nextIp(),
    ...options.headers,
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.cookie) headers.cookie = options.cookie;
  let body: string | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
    headers['content-type'] ??= 'application/json';
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${env.baseUrl}${path}`, { method, headers, body });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return {
    status: response.status,
    body: parsed as T,
    text,
    headers: response.headers,
    setCookies: response.headers.getSetCookie(),
  };
}

/** Cliente já autenticado: `api.get('/api/categories')`. */
export function client(token?: string) {
  return {
    get: <T = any>(path: string) => call<T>('GET', path, { token }),
    post: <T = any>(path: string, body?: unknown) => call<T>('POST', path, { token, body }),
    patch: <T = any>(path: string, body?: unknown) => call<T>('PATCH', path, { token, body }),
    put: <T = any>(path: string, body?: unknown) => call<T>('PUT', path, { token, body }),
    delete: <T = any>(path: string) => call<T>('DELETE', path, { token }),
  };
}

export type Client = ReturnType<typeof client>;

/** Valor de um cookie numa lista de `Set-Cookie`. */
export function cookieValue(setCookies: string[], name: string): string | undefined {
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const [key, ...rest] = (pair ?? '').split('=');
    if (key?.trim() === name) return rest.join('=');
  }
  return undefined;
}

/** Atributos de um cookie (`Path`, `HttpOnly`, `SameSite`...), em minúsculas. */
export function cookieAttributes(setCookies: string[], name: string): Record<string, string | true> {
  const line = setCookies.find((item) => item.trim().startsWith(`${name}=`));
  if (!line) return {};
  const attributes: Record<string, string | true> = {};
  for (const part of line.split(';').slice(1)) {
    const [key, ...rest] = part.trim().split('=');
    if (!key) continue;
    attributes[key.toLowerCase()] = rest.length ? rest.join('=') : true;
  }
  return attributes;
}
