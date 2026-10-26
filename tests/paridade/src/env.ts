/**
 * Configuração da suíte. O mesmo conjunto de testes roda contra a API Node
 * (hoje) e contra a API .NET (depois): só muda `PARITY_BASE_URL`.
 *
 * A API sob teste precisa:
 *  • usar o MESMO banco de `PARITY_DATABASE_URL` (a suíte limpa e prepara dados nele);
 *  • usar o MESMO segredo de `PARITY_JWT_SECRET` (a suíte emite tokens de acesso);
 *  • confiar no `X-Forwarded-For` (como em produção, atrás do proxy) e usar os
 *    rate limits padrão — a suíte varia o IP por chamada.
 */
export const env = {
  baseUrl: (process.env.PARITY_BASE_URL ?? 'http://localhost:3334').replace(/\/$/, ''),
  databaseUrl:
    process.env.PARITY_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/grana_test',
  jwtSecret: process.env.PARITY_JWT_SECRET ?? 'paridade-segredo-de-acesso-com-mais-de-32-caracteres',
};
