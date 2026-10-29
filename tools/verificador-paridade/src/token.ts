import { createHmac } from 'node:crypto';

const b64url = (value: string) => Buffer.from(value).toString('base64url');

/**
 * Emite um access token igual ao da API Node (HS256, sem `iss`, payload
 * `{sub, email, role}`), o mesmo que `tests/paridade/src/tokens.ts` emite.
 * Assim o verificador age como cada usuário da amostra sem saber a senha dele,
 * e os dois backends recebem exatamente o mesmo token (R-02).
 */
export function signAccessToken(
  user: { id: string; email: string; role: 'ADMIN' | 'USER' },
  secret: string,
  expiresInSeconds = 900,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ sub: user.id, email: user.email, role: user.role, iat: now, exp: now + expiresInSeconds }),
  );
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
