import { createHmac } from 'node:crypto';
import { env } from './env.js';

const b64url = (value: Buffer | string) =>
  Buffer.from(value).toString('base64url');

/**
 * Emite um access token igual ao da API (HS256, `iss: grana-api`, payload
 * `{sub, email, role}`). Assim a maior parte da suíte não precisa passar pelo
 * login — que tem rate limit e custa um Argon2 por chamada.
 *
 * É também a garantia de coexistência do Strangler (R-02): Node e .NET têm de
 * aceitar o mesmo token.
 */
export function signAccessToken(
  user: { id: string; email: string; role?: 'ADMIN' | 'USER' },
  /** `issuer: undefined` (padrão) = sem `iss`, igual ao token que a API emite. */
  options: { expiresInSeconds?: number; secret?: string; issuer?: string } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: user.role ?? 'USER',
      iat: now,
      exp: now + (options.expiresInSeconds ?? 900),
      ...(options.issuer ? { iss: options.issuer } : {}),
    }),
  );
  const signature = createHmac('sha256', options.secret ?? env.jwtSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** Decodifica o payload de um JWT (sem verificar). */
export function decodeJwt(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'));
}
