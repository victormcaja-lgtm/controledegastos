#!/usr/bin/env bash
# Sobe a API Node para a suíte de paridade, em modo PRODUÇÃO (é o
# comportamento que os usuários recebem: mensagens de erro genéricas,
# cookie Secure/SameSite=None, CSP), na porta 3334 e contra o banco de teste.
#
# Os rate limits ficam nos valores PADRÃO: a suíte manda um X-Forwarded-For
# diferente por chamada, e só o spec de rate limit fixa o IP.
#
# Uso (na raiz do repo):  bash tests/paridade/scripts/start-node-api.sh
set -euo pipefail
cd "$(dirname "$0")/../../../apps/api"

export NODE_ENV=production
export PORT="${PORT:-3334}"
export HOST=127.0.0.1
export LOG_LEVEL=warn
export DATABASE_URL="${PARITY_DATABASE_URL:-postgresql://postgres:postgres@localhost:5433/grana_test}"
export JWT_ACCESS_SECRET="${PARITY_JWT_SECRET:-paridade-segredo-de-acesso-com-mais-de-32-caracteres}"
export JWT_REFRESH_SECRET="paridade-segredo-de-refresh-diferente-com-32-caracteres"
export CORS_ORIGINS="http://localhost:5173"

unset RATE_LIMIT_MAX LOGIN_RATE_LIMIT_MAX

exec npx tsx src/main.ts
