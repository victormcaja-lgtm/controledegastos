import type { ApiError } from '@grana/shared';
import { env } from '@/config/env';

/**
 * Cliente HTTP da aplicação.
 *
 * Três decisões que valem explicação:
 *
 * 1. O access token vive em MEMÓRIA (um módulo, não localStorage). Se um XSS
 *    conseguir rodar script na página, ele não acha a sessão no storage.
 * 2. O refresh token está num cookie httpOnly — o JS nem enxerga. Por isso todo
 *    request vai com `credentials: 'include'`.
 * 3. Quando um request devolve 401, o cliente tenta UM refresh e repete a
 *    chamada. Requests concorrentes compartilham a mesma promise de refresh,
 *    senão cinco telas carregando ao mesmo tempo disparariam cinco rotações.
 */

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function onUnauthorized(handler: () => void): void {
  onSessionLost = handler;
}

/** Erro de API já traduzido — o que os componentes tratam. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** Mensagem por campo, no formato que o react-hook-form entende. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.details ?? []).map((detail) => [detail.path, detail.message]));
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Interno: evita loop infinito de refresh. */
  skipRefresh?: boolean;
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return fetch(`${env.apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

async function tryRefresh(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const response = await fetch(`${env.apiUrl}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Libera a próxima tentativa apenas depois que esta terminou.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

async function parseError(response: Response): Promise<ApiRequestError> {
  let payload: Partial<ApiError> = {};
  try {
    payload = (await response.json()) as Partial<ApiError>;
  } catch {
    /* resposta sem corpo JSON */
  }

  return new ApiRequestError(
    response.status,
    payload.code ?? 'UNKNOWN',
    payload.message ?? mensagemPadrao(response.status),
    payload.details,
  );
}

function mensagemPadrao(status: number): string {
  if (status === 0) return 'Sem conexão com o servidor.';
  if (status === 403) return 'Você não tem permissão para isso.';
  if (status === 404) return 'Não encontramos o que você pediu.';
  if (status === 429) return 'Muitas tentativas seguidas. Espere um pouco.';
  if (status >= 500) return 'O servidor teve um problema. Tente de novo em instantes.';
  return 'Não deu para completar a ação.';
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;

  try {
    response = await rawRequest(path, options);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiRequestError(0, 'NETWORK', 'Sem conexão com o servidor.');
  }

  if (response.status === 401 && !options.skipRefresh && !path.startsWith('/api/auth/refresh')) {
    const renewed = await tryRefresh();
    if (renewed) return request<T>(path, { ...options, skipRefresh: true });

    accessToken = null;
    onSessionLost?.();
    throw await parseError(response);
  }

  if (!response.ok) throw await parseError(response);

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Monta querystring ignorando valores vazios. */
export function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}
