-- Anonimiza a CÓPIA do banco de produção que vai para a homologação (D-01, plano.md §7).
--
-- Troca tudo o que identifica uma pessoa (nomes, e-mails, textos livres, IPs, sessões)
-- e MANTÉM valores, datas, quantidades, ids e relações: os cálculos do resumo, das
-- faturas e do saldo futuro continuam comparáveis entre o Node e o .NET.
--
-- NUNCA rode contra produção. O script se recusa a rodar sem as duas variáveis:
--
--   psql "$HOMOLOGACAO_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v confirmar=homologacao \
--     -v senha_hash="$(node tools/homologacao/gerar-hash.mjs 'senha-da-homologacao')" \
--     -f tools/homologacao/anonimizar.sql
--
-- `senha_hash` é o Argon2id que passa a valer para TODOS os usuários: assim quem testa
-- a homologação entra com qualquer e-mail anonimizado e a mesma senha, e nenhuma senha
-- real chega lá. Tudo roda numa transação só: ou anonimiza tudo, ou nada.

\if :{?confirmar}
\else
  \echo 'Recusado: passe -v confirmar=homologacao (este script apaga dados pessoais do banco apontado).'
  \quit
\endif
SELECT :'confirmar' = 'homologacao' AS confirmado \gset
\if :confirmado
\else
  \echo 'Recusado: o valor de confirmar precisa ser exatamente "homologacao".'
  \quit
\endif
\if :{?senha_hash}
\else
  \echo 'Recusado: passe -v senha_hash=<hash Argon2id> (gere com tools/homologacao/gerar-hash.mjs).'
  \quit
\endif

BEGIN;

-- Usuários: nome e e-mail numerados pela ordem de criação; papel, status, bloqueio e
-- datas ficam como estão (o comportamento de login e da área admin depende deles).
WITH numbered AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS n FROM "users"
)
UPDATE "users" u
   SET "name" = 'Pessoa ' || numbered.n,
       "email" = 'pessoa-' || numbered.n || '@homologacao.invalid',
       "passwordHash" = :'senha_hash'
  FROM numbered
 WHERE u."id" = numbered."id";

-- Sessões de produção não têm uso na homologação.
DELETE FROM "refresh_tokens";

-- Auditoria: nenhuma rota a expõe. O e-mail acompanha o usuário anonimizado; IP e
-- metadados (que guardam e-mails e as alterações feitas) saem.
UPDATE "audit_logs" a
   SET "actorEmail" = (SELECT u."email" FROM "users" u WHERE u."id" = a."actorId"),
       "ip" = NULL,
       "metadata" = NULL;

-- Categorias PERSONALIZADAS ganham nome genérico; as de sistema (Mercado, Casa,
-- Salário...) são iguais para todos e ficam. Há um índice único (userId, name, kind):
-- o primeiro passo põe o id como nome, para nenhum nome novo colidir com um antigo
-- no meio da troca.
UPDATE "categories" SET "name" = "id" WHERE NOT "isSystem";
WITH numbered AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "userId", "kind" ORDER BY "createdAt", "id") AS n
    FROM "categories"
   WHERE NOT "isSystem"
)
UPDATE "categories" c
   SET "name" = CASE c."kind" WHEN 'INCOME' THEN 'Categoria de entrada ' ELSE 'Categoria ' END || numbered.n
  FROM numbered
 WHERE c."id" = numbered."id";

-- Nomes livres de contas fixas, entradas, dívidas, metas e cartões: numerados por usuário.
WITH numbered AS (
  SELECT "id", row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt", "id") AS n FROM "bills"
)
UPDATE "bills" t SET "name" = 'Conta ' || numbered.n FROM numbered WHERE t."id" = numbered."id";

WITH numbered AS (
  SELECT "id", row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt", "id") AS n FROM "incomes"
)
UPDATE "incomes" t SET "name" = 'Entrada ' || numbered.n FROM numbered WHERE t."id" = numbered."id";

WITH numbered AS (
  SELECT "id", row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt", "id") AS n FROM "debts"
)
UPDATE "debts" t SET "name" = 'Dívida ' || numbered.n FROM numbered WHERE t."id" = numbered."id";

WITH numbered AS (
  SELECT "id", row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt", "id") AS n FROM "goals"
)
UPDATE "goals" t SET "name" = 'Meta ' || numbered.n FROM numbered WHERE t."id" = numbered."id";

WITH numbered AS (
  SELECT "id", row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt", "id") AS n FROM "cards"
)
UPDATE "cards" t SET "name" = 'Cartão ' || numbered.n FROM numbered WHERE t."id" = numbered."id";

-- Observações: quem tinha continua tendo (o `null` × texto importa para a API, RN-081),
-- mas o texto vira genérico.
UPDATE "transactions" SET "note" = 'Observação' WHERE "note" IS NOT NULL;
UPDATE "card_purchases" SET "note" = 'Observação' WHERE "note" IS NOT NULL;

COMMIT;

\echo 'Anonimização concluída.'
