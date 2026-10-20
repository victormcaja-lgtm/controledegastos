# Suíte de paridade (testes de caracterização)

Rede de proteção da refatoração para .NET (Fase 2 de `docs/refatoracao`). Os testes registram o
**comportamento atual** da API Node, inclusive os comportamentos suspeitos (⚠️), e são o critério de
paridade: um módulo .NET só substitui o Node quando esta suíte passa 100% contra ele.

- **Caixa-preta:** só HTTP. O banco é usado apenas para preparar estados que a API não deixa criar
  (conta bloqueada, token vencido, datas do passado) e para conferir o que foi gravado.
- **Mesma suíte, dois backends:** troque `PARITY_BASE_URL` e rode de novo.
- **Modo produção:** a API sob teste roda com `NODE_ENV=production`, que é o comportamento que os
  usuários recebem (mensagens genéricas de erro, cookie `Secure; SameSite=None`, CSP).

## Rodar

```bash
docker compose up -d postgres                       # Postgres local na porta 5433
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/grana_test npm run db:deploy
bash tests/paridade/scripts/start-node-api.sh       # API Node na porta 3334 (deixe rodando)
npm run test:paridade -w @grana/paridade
```

| Variável | Padrão | Para quê |
|---|---|---|
| `PARITY_BASE_URL` | `http://localhost:3334` | API sob teste (Node hoje, .NET depois) |
| `PARITY_DATABASE_URL` | `postgresql://postgres:postgres@localhost:5433/grana_test` | O **mesmo** banco que a API usa; a suíte o limpa |
| `PARITY_JWT_SECRET` | segredo do script | O **mesmo** `JWT_ACCESS_SECRET` da API: a suíte emite tokens (R-02) |

A API sob teste precisa confiar no `X-Forwarded-For` (como em produção) e usar os rate limits
**padrão**: a suíte manda um IP diferente por chamada, e só `04-rate-limit` fixa o IP.

⚠️ A suíte **apaga todos os dados** do banco apontado. Nunca aponte para produção.

## Mapa de cobertura

| Arquivo | RNs |
|---|---|
| `01-transversal` | RN-001, 003, 005–008, 011–014, 018, 021; ordem validação × autenticação; token (R-02) |
| `02-autenticacao` | RN-030–046 (login, bloqueio, status, refresh e rotação, reuso, logout, perfil, troca de senha); ⚠️ 043, 044 |
| `03-cadastro-admin` | RN-050–062 (autocadastro, área admin, listagem, criação, edição, último admin, aprovação, reset, exclusão em cascata); ⚠️ 054 ("da a"), 057 |
| `04-rate-limit` | RN-015, RN-038 (login 8/15 min, cadastro 5/15 min, troca de senha 5/15 min, global 200/min, `/health` fora); RN-162 corrigido pela D-02 (vale o IP mais à direita do X-Forwarded-For, acrescentado pelo proxy) |
| `05-categorias-lancamentos` | RN-070–087; ⚠️ 004, 071, 081, 083, 086 |
| `06-contas` | RN-090–101 (cadastro, visão do mês, calendário, prazo, baixa, atrasos); ⚠️ 095, 097, 098, 100 |
| `07-entradas-dividas-metas` | RN-105–109 (entradas, dívidas e projeção, conversão em conta, metas e depósitos) |
| `08-resumo-relatorio` | RN-110–117 (fórmulas do resumo, barras, semanas, próximas contas, média de meses futuros, relatório e comparação); ⚠️ 114, 116; R-03 (arredondamento) |
| `09-cartoes` | RN-130–137 (fechamento, vencimento, parcelas, status, limite usado, faturas, compras) |
| `10-saldo-futuro` | RN-140–149 (eventos dia a dia, saldo de hoje, menor saldo, resumo mensal, média diária, simulação e veredito); ⚠️ 148, 149 |
| `11-ajustes` | RN-150–153; ⚠️ 002 (estouro de INTEGER) |
| `12-borda` | RN-016, 017 (CORS, cabeçalhos de segurança, `/docs`); R-01 (hash Argon2id PHC); ⚠️ 161 |

Comportamentos que a suíte descobriu ou corrigiu em relação à análise: `docs/refatoracao/analise.md`, seção 11.

## Quando um teste ⚠️ deve mudar

Só quando você aprovar a correção daquele item (decisão P6). Aí o teste muda **antes** do código,
com o novo comportamento, e passa a valer para o Node e para o .NET.
