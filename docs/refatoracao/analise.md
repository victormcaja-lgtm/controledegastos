# Análise do sistema atual — Grana (controledegastos)

> **Fase 1 — Análise.** Entregável do agente Arquiteto.
> Base analisada: `main` @ `3719e8f` (feat: saldo futuro…), clonado de
> `https://github.com/victormcaja-lgtm/controledegastos.git` em 2026-10-19.
> Todo caminho citado é relativo à raiz do repositório. Linhas referem-se a esse commit.

---

## 0. Resumo executivo

1. **O sistema já está em boa parte na stack-alvo.** O frontend já é React + TypeScript e o banco já
   é PostgreSQL 16. O backend é **Node 20 + Fastify 5 + Prisma 6**, já organizado em DDD + Clean
   Architecture (`domain / application / infra / http`). Na prática, a refatoração é **trocar o backend
   Node/Fastify por .NET (LTS)**, mantendo o contrato HTTP que o front consome.
2. **O contrato HTTP é a superfície de paridade.** São 54 endpoints em `/api` mais o `/health` (seção 3.3), o formato de erro, o
   cookie de refresh, os claims do JWT e o formato do hash Argon2id. Mudar qualquer um deles quebra o
   front ou desloga os usuários.
3. **Não há integrações externas** (sem e-mail, pagamentos, WhatsApp, ERP). A infraestrutura é Railway
   (API + Postgres) e Vercel (front).
4. **O banco pode ser reaproveitado como está.** Se o .NET usar o mesmo schema, a "migração de dados" se
   reduz a validação, sem ETL. Essa decisão é do plano e da sua aprovação (pergunta P3).
5. **Levantei 22 comportamentos que parecem bugs ou inconsistências** (seção 5). Cada um tem um RN
   próprio e precisa da sua decisão: manter ou corrigir. Pela regra principal, o sistema novo vai
   reproduzi-los até você decidir.
6. **Os maiores riscos de paridade não estão nas regras.** Estão em diferenças de runtime JS × .NET:
   arredondamento (`Math.round`), datas inválidas que "rolam" para o mês seguinte, formatação de moeda
   pt-BR, ordenação por collation, formato ISO de datas e mensagens de validação do Zod (seção 8).

---

## 1. Escopo e método

- Li **todo** o backend (`apps/api/src/**`, `prisma/**`), o pacote compartilhado (`packages/shared/**`),
  o núcleo do front (cliente HTTP, gateway, store de sessão, rotas, hooks) e as telas onde há regra no
  cliente, além de `docs/*.md`, CI, `docker-compose.yml`, `railway.json` e `vercel.json`.
- As regras foram extraídas do **código**, não da documentação. Quando a documentação diverge do
  código, vale o código (ex.: `primitives.ts` chama o id de "CUID2", mas ele é UUID v4).
- Dois comportamentos foram confirmados executando no Node 24:
  `Date.parse("2026-02-31T00:00:00Z")` → **3 de março** (rola o calendário), e
  `Boolean("false") === true` (base do `z.coerce.boolean`).
- Cada regra tem um identificador **RN-XXX** e a origem no formato `arquivo:linha (função)`.
  RN marcada com ⚠️ = **comportamento atual suspeito**, que depende da sua decisão (seção 5).

---

## 2. Stack e infraestrutura atuais

| Camada      | Tecnologia                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Monorepo    | npm workspaces: `packages/shared` (Zod + utilitários), `apps/api`, `apps/web`                  |
| Backend     | Node ≥ 20.11, Fastify 5, `fastify-type-provider-zod`, Zod 4, Prisma 6.19 (driver adapter `pg`) |
| Segurança   | `@node-rs/argon2` (Argon2id), `@fastify/jwt` (HS256), helmet, cors, rate-limit, under-pressure |
| Banco       | PostgreSQL 16 (Docker local na porta 5433; Railway em produção)                                |
| Frontend    | React 18 + TS, Vite, React Router, TanStack Query, Zustand, react-hook-form, Tailwind          |
| Testes      | Vitest: unidade (domínio), integração via `app.inject()` contra Postgres real, unidade no front |
| CI          | GitHub Actions: `db:deploy` + `db:seed` → typecheck → test → build (`.github/workflows/ci.yml`) |
| Deploy      | API: Railway/Nixpacks, `release` = `prisma migrate deploy && node dist/main.js`; front: Vercel  |
| Feature flag | `VITE_FEATURE_SALDO_FUTURO` (front): liga Home de saldo, Diário, Posso comprar?, Cartões e Resultado |

**Ambiente desta máquina:** Node 24 e Docker 29 instalados; **.NET SDK não instalado** (necessário a
partir da fase 2).

---

## 3. Funcionalidades

### 3.1 Contextos delimitados

- **Identity**: login, sessão (access + refresh), autocadastro com aprovação, perfil, troca de senha,
  administração de usuários e auditoria.
- **Finance**: categorias, lançamentos, contas fixas (por competência), entradas fixas, dívidas, metas,
  cartões e faturas, dashboard mensal, relatório por categoria, **saldo futuro** (fluxo de caixa dia a
  dia), "Posso comprar?" e ajustes.
- Identity → Finance só pela porta `UserWorkspaceProvisioner`
  (`apps/api/src/modules/identity/domain/ports.ts:43`), implementada em
  `finance/infra/prisma-workspace-provisioner.ts`.

### 3.2 Telas (front)

| Rota                | Tela                              | Observação                                       |
| ------------------- | --------------------------------- | ------------------------------------------------ |
| `/entrar`, `/criar-conta` | Login e autocadastro       | Redirecionam para `/` se já autenticado          |
| `/trocar-senha`     | Troca de senha obrigatória/voluntária | Ao concluir, faz logout e manda para o login |
| `/`                 | `CashflowHomePage` (flag on) ou `HomePage` | Saldo contínuo / resumo do mês         |
| `/lancar`, `/lista` | Lançar e listar lançamentos       |                                                  |
| `/contas`           | Contas fixas + calendário         |                                                  |
| `/mais`             | Relatório por categoria           |                                                  |
| `/parcelas`         | Dívidas                           | Com "mover para Contas"                          |
| `/guardar`          | Metas                             |                                                  |
| `/ajustes`          | Preferências, saldo inicial, categorias, entradas |                                  |
| `/mes`, `/diario`, `/posso-comprar`, `/cartoes`, `/resultado` | Só com a flag ligada |                     |
| `/admin/usuarios`   | Administração (só ADMIN)          | Aprovar pendentes = `PATCH status: ACTIVE`       |

### 3.3 Inventário de endpoints (contrato a preservar)

Todos sob `/api`, exceto `/health`. A coluna **Auth** indica: — = público, U = access token, A = ADMIN.

| # | Método e rota | Auth | Sucesso | Origem |
|---|---|---|---|---|
| 1 | `GET /health` | — | 200 `{status,uptime,database}` | `app.ts:155` |
| 2 | `POST /api/auth/login` | — | 200 `{accessToken,expiresIn,user}` + cookie | `identity/http/auth.routes.ts:49` |
| 3 | `POST /api/auth/signup` | — | 204 | `auth.routes.ts:81` |
| 4 | `POST /api/auth/refresh` | cookie | 200 igual ao login + cookie | `auth.routes.ts:101` |
| 5 | `POST /api/auth/logout` | — | 204 + limpa cookie | `auth.routes.ts:127` |
| 6 | `GET /api/auth/me` | U | 200 `AuthenticatedUser` | `auth.routes.ts:143` |
| 7 | `PATCH /api/auth/me` | U | 200 `UserDTO` | `auth.routes.ts:157` |
| 8 | `POST /api/auth/me/password` | U | 204 + limpa cookie | `auth.routes.ts:173` |
| 9 | `GET /api/admin/users` | A | 200 paginado | `identity/http/users.routes.ts:31` |
| 10 | `GET /api/admin/users/:id` | A | 200 | `users.routes.ts:45` |
| 11 | `POST /api/admin/users` | A | 201 | `users.routes.ts:59` |
| 12 | `PATCH /api/admin/users/:id` | A | 200 | `users.routes.ts:79` |
| 13 | `POST /api/admin/users/:id/password` | A | 204 | `users.routes.ts:99` |
| 14 | `DELETE /api/admin/users/:id` | A | 204 | `users.routes.ts:121` |
| 15 | `GET /api/dashboard?month` | U | 200 | `finance/http/finance.routes.ts:72` |
| 16 | `GET /api/reports/categories?month` | U | 200 | `finance.routes.ts:90` |
| 17 | `GET /api/cashflow?from&to&today` | U | 200 | `finance.routes.ts:110` |
| 18 | `POST /api/cashflow/simulate` | U | 200 | `finance.routes.ts:124` |
| 19–22 | `GET/POST /api/categories`, `PATCH/DELETE /api/categories/:id` | U | 200/201/200/204 | `finance.routes.ts:140-203` |
| 23–26 | `GET/POST /api/transactions`, `PATCH/DELETE /api/transactions/:id` | U | 200/201/200/204 | `finance.routes.ts:207-283` |
| 27 | `GET /api/bills?month` | U | 200 | `finance.routes.ts:287` |
| 28 | `GET /api/bills/overdue?today` | U | 200 | `finance.routes.ts:305` |
| 29–31 | `POST /api/bills`, `PATCH /api/bills/:id?month`, `DELETE /api/bills/:id` | U | 201/200/204 | `finance.routes.ts:319-379` |
| 32 | `PUT /api/bills/:id/payment` | U | 200 `BillDTO` | `finance.routes.ts:381` |
| 33–36 | `GET/POST /api/incomes`, `PATCH/DELETE /api/incomes/:id` | U | 200/201/200/204 | `finance.routes.ts:399-460` |
| 37–40 | `GET/POST /api/debts`, `PATCH/DELETE /api/debts/:id` | U | 200/201/200/204 | `finance.routes.ts:464-525` |
| 41 | `POST /api/debts/:id/convert` | U | 201 `BillDTO` | `finance.routes.ts:527` |
| 42–45 | `GET/POST /api/cards?today`, `PATCH/DELETE /api/cards/:id` | U | 200/201/200/204 | `finance.routes.ts:553-615` |
| 46 | `GET /api/cards/:id/invoice?month` | U | 200 | `finance.routes.ts:617` |
| 47 | `POST /api/cards/:id/purchases` | U | 201 | `finance.routes.ts:637` |
| 48 | `DELETE /api/card-purchases/:id` | U | 204 | `finance.routes.ts:661` |
| 49–53 | `GET/POST /api/goals`, `PATCH/DELETE /api/goals/:id`, `POST /api/goals/:id/deposits` | U | 200/201/200/204/**200** | `finance.routes.ts:680-761` |
| 54–55 | `GET/PATCH /api/settings` | U | 200 | `finance.routes.ts:765-790` |

Os schemas de request e response são os de `packages/shared/src/contracts/*.contract.ts`. O Swagger
fica em `/docs`, fora de produção (`app.ts:147`).

---

## 4. Regras de negócio

> ⚠️ = comportamento atual que parece bug ou inconsistência e está listado na seção 5 para você decidir.
> Mensagens entre aspas são **literais** e fazem parte da paridade, porque o front as exibe.

### 4.1 Transversais (validação, erros, HTTP)

| RN | Regra | Origem |
|---|---|---|
| RN-001 | Dinheiro é inteiro em centavos. Requisições aceitam `> 0` e `≤ 10.000.000.000` (`centsSchema`); onde zero é permitido, `centsOrZeroSchema`. Mensagens: "O valor deve estar em centavos (número inteiro).", "O valor precisa ser maior que zero.", "Valor acima do limite suportado." | `packages/shared/src/primitives.ts:19-30` |
| RN-002 ⚠️ | O teto de 10 bilhões de centavos passa do limite das colunas `INTEGER` (2.147.483.647). Valores entre R$ 21,4 milhões e R$ 100 milhões passam na validação e falham na gravação, com **500**. | `primitives.ts:23`, `prisma/schema.prisma` (`Int`) |
| RN-003 | Data é `AAAA-MM-DD` ("Data inválida. Use o formato AAAA-MM-DD."). Competência é `AAAA-MM` com mês 01–12 ("Competência inválida. Use o formato AAAA-MM."). | `primitives.ts:8-16`, `month.ts:6` |
| RN-004 ⚠️ | Data inexistente com dia ≤ 31 (ex.: `2026-02-31`) é **aceita** e gravada como o dia equivalente do mês seguinte (`2026-03-03`), porque `Date.parse` rola o calendário. Só dia > 31 é recusado ("Data inexistente."). | `primitives.ts:16`; gravação em `transactions.usecases.ts:26 (parseISODate)` |
| RN-005 | Nome: trim, 2–60 caracteres ("Informe pelo menos 2 caracteres.", "Máximo de 60 caracteres."). Observação: trim, até 140 caracteres. Dia do mês: inteiro de 1 a 31 ("O dia precisa estar entre 1 e 31."). Cor: hex, `oklch()`, `rgb()` ou `hsl()`, 3–64 caracteres. | `primitives.ts:32-53` |
| RN-006 | Um corpo de PATCH sem nenhum campo é recusado com "Nada para atualizar." (400). | `*.contract.ts` (`.refine(... Object.keys ...)`) |
| RN-007 | Campos desconhecidos no corpo são **descartados em silêncio** (Zod `object` remove chaves extras). As strings com `.trim()` chegam ao caso de uso já aparadas. | Zod, todos os contratos |
| RN-008 | Erro de validação → **400** `{statusCode:400,error:"Bad Request",code:"VALIDATION_ERROR",message:"Alguns campos precisam de atenção.",details:[{path,message}],requestId}`. `path` é o caminho do campo com pontos (ex.: `confirmPassword`). | `shared/infra/http/error-handler.ts:42-53` |
| RN-009 | Erro de domínio → status por código: VALIDATION_ERROR 422, NOT_FOUND 404, CONFLICT 409, BUSINESS_RULE 422, UNAUTHORIZED 401, FORBIDDEN 403, TOO_MANY_ATTEMPTS 429. Corpo: `{statusCode,error:<nome da classe>,code,message,details?,requestId}`. | `error-handler.ts:20-67`, `shared/domain/errors.ts` |
| RN-010 | Violação de unicidade no banco (P2002) → 409 "Já existe um registro com esses dados."; registro inexistente (P2025) → 404 "Registro não encontrado.". | `error-handler.ts:69-89` |
| RN-011 | Outro erro com status < 500 (ex.: JSON malformado) → status e `code` do próprio Fastify. Erro inesperado → 500 `INTERNAL_ERROR`; em produção, "Algo deu errado do nosso lado. Tente novamente em instantes."; fora de produção, a mensagem real. | `error-handler.ts:91-111` |
| RN-012 | Rota inexistente → 404 `code:"ROUTE_NOT_FOUND"`, "Rota {MÉTODO} {url} não existe.". | `error-handler.ts:114-121` |
| RN-013 ⚠️ | O "não encontrado" é sempre masculino: "Categoria não encontrado.", "Conta não encontrado.", "Meta não encontrado.", "Dívida não encontrado.", "Entrada não encontrado.", "Compra não encontrado.", "Cartão não encontrado.", "Lançamento não encontrado.", "Usuário não encontrado.". | `errors.ts:39-44 (NotFoundError)` |
| RN-014 | `requestId` = cabeçalho `x-request-id`, se vier; senão, UUID novo. Vai em todo erro. | `app.ts:56` |
| RN-015 | Rate limit global por IP: `RATE_LIMIT_MAX` (padrão 200) por minuto. Estouro → 429 `{statusCode:429,error:"Too Many Requests",code:"RATE_LIMITED",message:"Muitas requisições. Tente de novo em {N}s."}`, **sem** `requestId`. `/health` fica fora. IP real via `trustProxy`. | `app.ts:91-102, 57` |
| RN-016 | CORS: allowlist `CORS_ORIGINS` (sem barra final); requisições sem `Origin` passam; fora de produção, aceita também `https://*.vercel.app`. `credentials: true`, métodos GET/POST/PATCH/PUT/DELETE/OPTIONS, `maxAge` 86400. | `app.ts:74-89` |
| RN-017 | Corpo de até 1 MB. Helmet com CSP só em produção. Sob pressão (event loop > 1 s ou heap > 512 MB), responde 503 com `Retry-After: 30` (fora do ambiente de teste). | `app.ts:58, 67-72, 114-123` |
| RN-018 | `GET /health` executa `SELECT 1` e responde `{status:"ok",uptime:<segundos arredondados>,database:"up"}`; com o banco fora, 500. Sem rate limit. | `app.ts:155-173` |
| RN-019 | Datas-hora saem em ISO 8601 UTC com milissegundos (`2026-10-19T12:34:56.789Z`); datas puras saem como `AAAA-MM-DD`. A competência é gravada como o dia 1 do mês (`DATE`). | `finance/infra/finance.mappers.ts:26`, `month.ts:80` |
| RN-020 | Moeda nas frases geradas pelo servidor: `formatMoney` pt-BR "R$ 1.234,56"; negativo usa **U+2212** ("−R$ 10,00"); os centavos sempre aparecem. | `packages/shared/src/money.ts:46-56` |
| RN-021 | Isolamento: toda consulta financeira filtra por `userId` do token; nenhuma rota recebe `userId`. Recurso de outro usuário → 404, nunca 403. | `finance/infra/prisma-finance.repositories.ts` (todas as consultas) |

### 4.2 Identity: autenticação e sessão

| RN | Regra | Origem |
|---|---|---|
| RN-030 | E-mail: trim + minúsculas, até 160 caracteres, formato válido ("E-mail inválido."). | `primitives.ts:68-73`; `identity/domain/email.vo.ts:15 (Email.create)` |
| RN-031 | Política de senha: 10–128 caracteres, com minúscula, maiúscula e número. Mensagens: "A senha precisa ter pelo menos 10 caracteres.", "A senha pode ter no máximo 128 caracteres.", "Inclua ao menos uma letra minúscula.", "Inclua ao menos uma letra maiúscula.", "Inclua ao menos um número.". No login vale só `min(1)` ("Informe a senha.") e `max(128)`. | `primitives.ts:60-66`; `contracts/auth.contract.ts:5-8` |
| RN-032 | Login com e-mail inexistente: gasta o tempo de uma verificação Argon2 sobre um hash fictício, grava auditoria `auth.login.failed` (`reason:"unknown_email"`) e responde 401 "E-mail ou senha incorretos.". | `identity/application/authenticate-user.usecase.ts:44-54`; `infra/argon2-password-hasher.ts:46 (burnTime)` |
| RN-033 | Conta bloqueada (`lockedUntil > agora`) → 429 "Conta temporariamente bloqueada por excesso de tentativas. Tente em {⌈min⌉} min.". Essa checagem vem **antes** da senha: nem a senha certa entra. | `authenticate-user.usecase.ts:56-61`; `user.entity.ts:105-113` |
| RN-034 | Senha errada: `failedLoginAttempts + 1`. Na 5ª falha, `lockedUntil = agora + 15 min` e o contador volta a 0. A própria 5ª tentativa ainda responde 401; o bloqueio vale a partir da próxima. Auditoria `auth.login.failed` (`reason:"bad_password"`). | `user.entity.ts:22-24, 116-123 (registerFailedLogin)`; `authenticate-user.usecase.ts:65-77` |
| RN-035 | Com a senha certa, o status é checado **depois** dela: PENDING → 401 "Sua conta ainda não foi aprovada pelo administrador."; SUSPENDED → 401 "Esta conta está suspensa. Fale com o administrador.". Nesse caso, nenhum contador muda e não há auditoria. | `authenticate-user.usecase.ts:81-87` |
| RN-036 | Login com sucesso: zera falhas e bloqueio, `lastLoginAt = agora`. Access token JWT **HS256** com `iss:"grana-api"`, payload `{sub,email,role}` e validade `ACCESS_TOKEN_TTL` (15m); `expiresIn = exp − iat` em segundos. Refresh: 64 bytes aleatórios em base64url; o banco guarda o **SHA-256 hex** do token, `expiresAt = agora + REFRESH_TOKEN_TTL_DAYS` (7 dias), IP cortado em 64 e user-agent em 255 caracteres. Auditoria `auth.login.success`. | `user.entity.ts:125-130`; `infra/jwt-token.service.ts`; `app.ts:106-110`; `authenticate-user.usecase.ts:89-130` |
| RN-037 | Cookie `grana_refresh_token`: `httpOnly`, `path=/api/auth`, `expires = expiresAt`, `domain = COOKIE_DOMAIN` (se definido). Em produção, `Secure; SameSite=None`; fora dela, `SameSite=Lax`. | `auth.routes.ts:18-43` |
| RN-038 | Rate limits por rota: login `LOGIN_RATE_LIMIT_MAX` (8) a cada 15 min; signup 5 a cada 15 min; troca de senha 5 a cada 15 min. | `auth.routes.ts:54, 86, 177` |
| RN-039 | Refresh: lê o cookie (vazio se ausente) e faz o hash. Não encontrado → 401 "Sessão inválida. Faça login novamente.". **Já revogado** → revoga todos os tokens do usuário e responde 401 "Sessão comprometida. Faça login novamente.". Expirado (`expiresAt ≤ agora`) → 401 "Sessão expirada. Faça login novamente.". Usuário inexistente ou não ACTIVE → revoga todos e responde 401 "Sessão inválida…". Caso contrário, emite um token novo, revoga o anterior com `replacedBy = id do novo`, gera um access token e grava o cookie. Num 401, o cookie **não** é limpo. | `identity/application/refresh-session.usecase.ts:35-87` |
| RN-040 | Logout não exige access token. Se o cookie existir e o token estiver ativo, revoga (sem `replacedBy`). Sempre limpa o cookie e responde 204. Sem auditoria. | `session.usecases.ts:15-28`; `auth.routes.ts:127-140` |
| RN-041 | `PATCH /auth/me` renomeia: nome com trim, 2–80 caracteres. Responde `UserDTO`, não `AuthenticatedUser`. Sem auditoria. | `session.usecases.ts:50-59`; `user.entity.ts:132-138` |
| RN-042 | Troca de senha: confere a atual (errada → **401** "A senha atual está incorreta."). O schema exige `confirmPassword` igual ("As senhas não conferem.") e senha nova diferente da atual ("A nova senha precisa ser diferente da atual."). Grava `mustChangePassword=false`, zera o bloqueio, revoga **todos** os refresh tokens (inclusive o atual), limpa o cookie e audita `auth.password.changed`. O front então faz logout e volta para o login. | `session.usecases.ts:73-100`; `auth.contract.ts:44-57`; `apps/web/src/pages/ChangePasswordPage.tsx:36` |
| RN-043 ⚠️ | `mustChangePassword` é imposto **só no front** (`RequireAuth` manda para `/trocar-senha`). A API atende qualquer rota normalmente. | `apps/web/src/routes/AppRoutes.tsx:38` |
| RN-044 ⚠️ | A autorização confia nos claims do JWT (`role`) e não reconsulta o banco. Usuário suspenso, rebaixado ou excluído continua com acesso por até 15 min, até o access token expirar. | `shared/infra/http/auth.plugin.ts:37-58` |
| RN-045 | No front, um 401 dispara **um** refresh compartilhado entre requisições concorrentes e repete a chamada uma vez. Se o refresh falhar, a sessão cai. O access token fica só em memória; um F5 recupera a sessão pelo cookie. | `apps/web/src/infra/http/api-client.ts:74-147` |
| RN-046 ⚠️ | Como a senha atual errada na troca (RN-042) e o login inválido também devolvem 401, o front dispara um refresh nesses casos. O token é rotacionado sem necessidade. | `api-client.ts:134`; `session.usecases.ts:86` |

### 4.3 Identity: cadastro e administração

| RN | Regra | Origem |
|---|---|---|
| RN-050 | Autocadastro: nome com trim, 2–80 caracteres ("Informe o nome completo."). E-mail duplicado → 409 "Já existe uma conta com este e-mail.". Cria com `role USER`, `status PENDING` e `mustChangePassword=false`, prepara o espaço financeiro **com** categorias padrão, audita `user.signup_requested` (`actorId null`) e responde 204. | `identity/application/signup.usecase.ts`; `auth.contract.ts:12-16` |
| RN-051 | Toda a área `/api/admin/users` exige ADMIN. Não-admin → 403 "Esta área é exclusiva de administradores.". Nenhuma rota de admin expõe dado financeiro de outro usuário. | `auth.plugin.ts:53-58`; `users.routes.ts:29` |
| RN-052 | Listagem de usuários: `page ≥ 1`, `perPage` de 1 a 100 (padrão 20); `search` (trim, até 80) busca por "contém", sem diferenciar maiúsculas, em nome **ou** e-mail; filtros `role` e `status`; ordem `createdAt desc`; `totalPages = max(1, ⌈total/perPage⌉)`. | `contracts/user.contract.ts:46-51`; `infra/prisma-user.repository.ts:30-61` |
| RN-053 | Criação pelo admin: `role` padrão USER, `mustChangePassword` padrão true, `seedDefaultCategories` padrão true, `status ACTIVE`. Duplicado → 409 "Já existe um usuário com este e-mail.". Audita `user.created` com `{email, role}`. Responde 201 `UserDTO`. | `manage-users.usecases.ts:52-96`; `user.contract.ts:18-27` |
| RN-054 | Edição pelo admin, aplicada na ordem e-mail → nome → perfil → status, e só quando o valor muda. E-mail duplicado em outro usuário → 409. Mudar o **próprio** perfil ou status → 403 com as frases literais "Você não pode alterar o perfil da a própria conta." / "Você não pode alterar o status da a própria conta." (⚠️ RN-013b: o "da a" é concatenação). | `manage-users.usecases.ts:100-163`; `user.entity.ts:174-178 (assertIsNotSelf)` |
| RN-055 | Último administrador: rebaixar ou suspender um ADMIN **ativo** quando não há outro ADMIN ativo → 422 "Este é o último administrador ativo. Promova outro usuário antes de alterar este.". | `manage-users.usecases.ts:166-180 (assertLastAdminIsPreserved)` |
| RN-056 | Suspender revoga na hora todos os refresh tokens do usuário. Qualquer outro status enviado chama `activate()`, que grava ACTIVE e zera o bloqueio. É assim que o admin **aprova** um pendente. | `manage-users.usecases.ts:138-148`; `user.entity.ts:158-168`; `pages/admin/UsersPage.tsx:57` |
| RN-057 ⚠️ | Enviar `status: "PENDING"` grava **ACTIVE**, porque `activate()` é chamado para todo status diferente de SUSPENDED. | `manage-users.usecases.ts:145-147` |
| RN-058 | Auditoria `user.updated` com `metadata.changes` = o corpo recebido. | `manage-users.usecases.ts:152-160` |
| RN-059 | Redefinição de senha pelo admin: `mustChangePassword` padrão true; não impede o admin de redefinir a própria senha; revoga todas as sessões; audita `user.password.reset`; 204. | `manage-users.usecases.ts:185-223` |
| RN-060 | Exclusão: o próprio admin → 403 "Você não pode excluir a própria conta.". Último ADMIN ativo → 422 "Não é possível excluir o último administrador ativo.". Apaga em cascata todo o dado financeiro, tokens e ajustes; auditorias em que ele era o ator ficam com `actorId = null`. Audita `user.deleted` depois de apagar. | `manage-users.usecases.ts:227-256`; FKs da migration init |
| RN-061 | Falha ao gravar auditoria nunca derruba a operação: o erro é logado e engolido. | `identity/infra/prisma-audit-logger.ts:24-38` |
| RN-062 | Preparação do espaço financeiro: cria `user_settings` com os padrões (upsert) e, se pedido, as 11 categorias padrão com `isSystem=true` (Mercado, Lazer, Roupa, Transporte, Casa, Educação, Assinaturas, Dívidas = despesa; Salário, Renda extra, Bônus = entrada), com as cores de `default-categories.ts`. Roda numa transação **separada** da criação do usuário. | `finance/infra/prisma-workspace-provisioner.ts`; `finance/domain/default-categories.ts` |

### 4.4 Finance: categorias

| RN | Regra | Origem |
|---|---|---|
| RN-070 | Listagem: por padrão, sem as arquivadas; ordem `kind asc` (EXPENSE antes de INCOME, pela ordem do enum) e depois `name asc` (pela **collation do banco**). | `prisma-finance.repositories.ts:42-47` |
| RN-071 ⚠️ | `?includeArchived=false` devolve **também** as arquivadas, porque `z.coerce.boolean` trata qualquer string não vazia como true. O front nunca envia esse parâmetro. | `finance.routes.ts:147` |
| RN-072 | Criação: `kind` padrão EXPENSE. Nome repetido no mesmo `kind`, sem diferenciar maiúsculas (inclusive em arquivadas) → 409 "Você já tem uma categoria com esse nome.". Cor padrão = `CATEGORY_COLORS[total de categorias do usuário, incluindo arquivadas, mod 11]`. `isSystem=false`. | `categories.usecases.ts:19-31`; `enums.ts:16-32` |
| RN-073 | Edição: a checagem de nome repetido só roda se o nome mudar além de maiúsculas e minúsculas. `archived:true` → `archivedAt = agora` (arquivar de novo atualiza a data); `false` → null. Categorias do sistema podem ser renomeadas e arquivadas. | `categories.usecases.ts:37-52` |
| RN-074 | Exclusão: com uso em lançamentos, contas e compras no cartão → 422 "Esta categoria está em {N} registro(s). Arquive-a em vez de excluir.". Essa checagem vem **antes** da de categoria do sistema → 422 "Categorias padrão não podem ser excluídas — apenas arquivadas.". | `categories.usecases.ts:62-77`; `prisma-finance.repositories.ts:82-89` |

### 4.5 Finance: lançamentos

| RN | Regra | Origem |
|---|---|---|
| RN-080 | Criação: a categoria precisa existir (404), não pode estar arquivada (422 "Esta categoria está arquivada. Escolha outra.") e precisa ter o mesmo tipo do lançamento (422 "Escolha uma categoria de despesa para um gasto." / "Escolha uma categoria de entrada para um recebimento."). Datas futuras são aceitas (lançamento agendado). | `transactions.usecases.ts:94-117` |
| RN-081 ⚠️ | Observação só com espaços vira `""` após o trim e é gravada como string vazia, não como null. A compra no cartão, ao contrário, converte vazio em null (RN-133). | `transactions.usecases.ts:114`; `primitives.ts:53` |
| RN-082 | Edição: o tipo não muda. Nova categoria precisa ter o tipo do lançamento (422 "A categoria escolhida não combina com o tipo do lançamento."). `note: null` limpa a observação. | `transactions.usecases.ts:126-149` |
| RN-083 ⚠️ | Na edição, uma categoria **arquivada** é aceita; na criação, não. | `transactions.usecases.ts:134-140` |
| RN-084 | Listagem: filtros `month`, `categoryId`, `type` e `search` (busca só na **observação**, sem diferenciar maiúsculas); paginação igual à RN-052; ordem `occurredOn desc, createdAt desc`. | `prisma-finance.repositories.ts:97-136` |
| RN-085 | `groups`: agrupa a página por dia (mais recente primeiro). Rótulo "Hoje" ou "Ontem" pela **data UTC do servidor**; nos demais dias, "DD de mês". `totalCents` do grupo = despesas − entradas. | `transactions.usecases.ts:54-86` |
| RN-086 ⚠️ | `summary` = "{total} lançamento(s) · {R$} em gastos", em que `total` conta **todos** os resultados do filtro, mas o valor soma só as despesas **da página atual**. | `transactions.usecases.ts:37-49` |
| RN-087 | A coluna `transactions.billId` existe, mas nenhum fluxo a preenche (coluna morta, sem FK). | `schema.prisma` (Transaction.billId); nenhuma chamada passa `billId` |

### 4.6 Finance: contas fixas

| RN | Regra | Origem |
|---|---|---|
| RN-090 | Criação: categoria de **despesa** (422 "Contas fixas precisam de uma categoria de despesa."); categoria arquivada é aceita. `startMonth` = competência atual em **UTC do servidor**. `totalInstallments` de 1 a 600 ou null (recorrente sem fim). Responde o DTO da competência atual. | `bills.usecases.ts:94-111`; `finance.routes.ts:337` |
| RN-091 | Edição: mesma regra de categoria. Pode mudar nome, valor, dia, ativa e prazo; `startMonth` é imutável. Responde o DTO para `?month` (padrão: o mês atual). | `bills.usecases.ts:120-144` |
| RN-092 | Exclusão definitiva, com as baixas em cascata. O histórico some do saldo futuro. | `bills.usecases.ts:150-154`; FK `bill_payments_billId_fkey` CASCADE |
| RN-093 | Número da parcela numa competência = meses desde `startMonth` + 1. A conta está **encerrada** quando esse número passa de `totalInstallments`. | `budget.calculator.ts:149-159` |
| RN-094 | Baixa (`PUT /bills/:id/payment`): `waived:true` → grava WAIVED com o valor da conta, ignorando `paid`. `paid:true` → grava PAID com `amountCents` informado (ou o valor da conta). `paid:false` sem waived → apaga a baixa da competência. É um upsert por `(billId, competência)`: refazer atualiza valor, status e **`paidAt = agora`**. | `bills.usecases.ts:164-200`; `prisma-finance.repositories.ts:350-377` |
| RN-095 ⚠️ | A baixa não valida se a competência está dentro da vigência (antes de `startMonth`, depois da última parcela) nem se a conta está ativa. | `bills.usecases.ts:172-192` |
| RN-096 | Visão do mês (`GET /bills`): todas as contas, inclusive inativas, menos as encerradas na competência (RN-093). `paid` e `waived` vêm da baixa da competência; `paidAt` só existe quando é PAID; `dueDate` = dia de vencimento limitado ao último dia do mês; ordem `active desc, dueDay asc`. | `bills.usecases.ts:21-58`; `finance.mappers.ts:58-84` |
| RN-097 ⚠️ | Uma conta aparece em competências **anteriores** à sua criação, com `installmentNumber ≤ 0`. Só o fim do prazo é filtrado, não o início. O mesmo vale para o dashboard (RN-110) e o relatório (RN-115). O saldo futuro, ao contrário, respeita `startMonth` (RN-142). | `budget.calculator.ts:155-159 (isBillFinished)`; `bills.usecases.ts:29-35` |
| RN-098 ⚠️ | `paidCents` da visão do mês soma o **valor da conta**, não o valor efetivamente pago (que pode ter juros). | `bills.usecases.ts:43-45` |
| RN-099 | `dueCents` = contas ativas, nem pagas nem dispensadas. Calendário: células vazias até o dia da semana do dia 1 (domingo = 0), uma célula por dia, `hasBill` e `allPaid` (pago ou dispensado) pelas contas ativas, `isToday` pela data UTC do servidor. | `bills.usecases.ts:46-86` |
| RN-100 ⚠️ | No calendário, uma conta com vencimento no dia 31 **não aparece** em meses de 30 dias ou em fevereiro, porque a célula é casada por `dueDay` exato, sem a limitação de dia. | `bills.usecases.ts:76` |
| RN-101 | Contas em atraso (`GET /bills/overdue?today`): saldo futuro não configurado → `[]`. Considera só contas **ativas**, nas competências de `max(startMonth, mês do saldo inicial)` até o mês de hoje e dentro do prazo, com vencimento ≥ `openingDate` e < hoje, sem baixa PAID nem WAIVED. Ordem por vencimento. `daysLate` = dias entre o vencimento e hoje. | `cashflow.calculator.ts:135-166 (findOverdueBills)`; `cashflow.usecases.ts:228-236` |

### 4.7 Finance: entradas fixas, dívidas e metas

| RN | Regra | Origem |
|---|---|---|
| RN-105 | Entradas fixas: CRUD com nome, valor e dia de recebimento; listagem em ordem `active desc, receiptDay asc`; exclusão definitiva. | `incomes.usecases.ts`; `prisma-finance.repositories.ts:382-420` |
| RN-106 | Dívidas: `totalInstallments` de 1 a 600 e `paidInstallments` de 0 a 600, padrão 0. Na criação, pagas > total → **400** "Parcelas pagas não podem passar do total."; na edição → **422** "As parcelas pagas não podem passar do total de parcelas.". Listagem por `createdAt asc`. O DTO deriva `remainingInstallments`, `remainingCents`, `progressPercent` e `settled`. | `finance.contract.ts:194-215`; `debts.usecases.ts:46-57`; `finance.mappers.ts:96-109` |
| RN-107 | Projeção de dívidas: 6 meses a partir do mês atual (UTC). No deslocamento `k`, soma a parcela das dívidas com `total − pagas > k`. Frase: o primeiro mês com total menor que o do mês atual → "Em {mês ano} sobram {R$} a mais no seu bolso: uma parcela acaba."; total atual 0 → "Você não tem parcelas em aberto. 👏"; senão → "As parcelas seguem iguais nos próximos meses.". **Dívidas não entram** no dashboard nem no saldo futuro. | `budget.calculator.ts:180-215 (projectDebts)`; `debts.usecases.ts:15-33` |
| RN-108 | Converter dívida em conta: dívida quitada → 422 "Esta dívida já está quitada."; categoria de despesa. Cria uma conta com o nome da dívida, o valor da parcela, o `dueDay` informado, `startMonth` = mês atual e `totalInstallments` = parcelas restantes; depois **apaga** a dívida (passos não atômicos). Responde 201. | `debts.usecases.ts:75-107` |
| RN-109 | Metas: alvo > 0, guardado ≥ 0 (padrão 0), destaque padrão false. Criar ou editar com `featured:true` tira o destaque das outras; `featured:false` pode deixar o usuário sem nenhuma meta em destaque. O `savedCents` inicial ou editado **não** gera depósito e não afeta o saldo futuro. Depósito (> 0) cria um registro e incrementa `savedCents` na mesma transação; responde **200** com a meta. O DTO traz os **10 últimos** depósitos, os mais recentes primeiro; `achieved` quando guardado ≥ alvo; progresso limitado a 100. Listagem `featured desc, createdAt asc`. Excluir apaga os depósitos em cascata e os tira do saldo futuro. | `goals.usecases.ts`; `prisma-finance.repositories.ts:470-555`; `finance.mappers.ts:111-128` |

### 4.8 Finance: dashboard mensal e relatório

| RN | Regra | Origem |
|---|---|---|
| RN-110 | Entradas do dashboard: entradas fixas **ativas** (todas, sem olhar a data de criação) + lançamentos INCOME do mês. Gasto variável: lançamentos EXPENSE do mês. Contas: ativas, não encerradas e não dispensadas no mês; `paid` = existe baixa PAID. | `dashboard.usecases.ts:46-85` |
| RN-111 | Cálculo (`calculateBudget`), com o "hoje" em **UTC do servidor**: `billsPaid` soma o valor das contas pagas; `billsDue = total − pagas`; `spent = billsPaid + variável`; `leftover = entradas − total de contas − variável projetada`. A variável projetada é o realizado em meses atuais e passados; em meses futuros, é a média de despesas dos **3 últimos meses fechados em relação a hoje** (soma ÷ 3, sempre). `currentDay` = dia de hoje no mês atual, senão o último dia do mês. `daysLeft = max(1, dias do mês − currentDay)`; `dailyAllowance = ⌊max(0, leftover) / daysLeft⌋`. As barras são `percentOf(…, max(entradas, 1))`. | `budget.calculator.ts:65-136`; `prisma-finance.repositories.ts:193-204` |
| RN-112 | Semanas: 4 baldes por dia do lançamento (1–7, 8–14, 15–21, 22–31); `heightPercent = max(6, round(total/maior × 100))`; `current` só no mês atual. `weekNote`: semana atual e anterior zeradas → "Ainda não há gastos suficientes nesta semana para comparar."; atual ≤ anterior → "Boa — esta semana você gastou {R$} a menos que a passada."; senão → "Esta semana está {R$} acima da semana passada.". Em meses que não são o atual, a comparação é S4 × S3. | `budget.calculator.ts:92-113`; `month.ts:125-127` |
| RN-113 | Próximas contas: as 3 primeiras não pagas por `dueDay`. `whenLabel`: fora do mês atual → "vence dia N"; no mês atual → "venceu há N dia(s)", "vence hoje" ou "em N dia(s)". | `dashboard.usecases.ts:87-110` |
| RN-114 ⚠️ | O dashboard **não** considera compras no cartão; o relatório por categoria considera (RN-115). | `dashboard.usecases.ts:46-85` |
| RN-115 | Relatório por categoria: despesas do mês + **todas** as contas em vigor (valor cheio) + parcelas de cartão cujo **vencimento** cai no mês (todos os cartões, até os inativos). Agrupa por id de categoria, ordena por total decrescente (empates na ordem de inserção: lançamentos, contas, cartão); `percent` = parte do total geral; `relativeWidth = max(3, percentOf(total, maior))`. | `dashboard.usecases.ts:121-199` |
| RN-116 ⚠️ | O relatório soma contas **dispensadas** ("não vou pagar"); o dashboard as exclui. | `dashboard.usecases.ts:137, 156-158` |
| RN-117 | Comparação do relatório: só **lançamentos** (sem contas nem cartão), mês atual × anterior, agrupados por **nome** de categoria. Frases: sem mês anterior → "Ainda não há mês anterior suficiente para comparar."; estável → "Seus gastos ficaram estáveis em relação ao mês passado."; misto → "Você gastou {R$} a menos em {x}, mas {R$} a mais em {y}."; só alta → "O maior aumento veio de {y}: {R$} a mais que no mês passado."; só queda → "Você economizou {R$} em {x} em relação ao mês passado.". Nomes em minúsculas. | `dashboard.usecases.ts:209-245` |

### 4.9 Finance: cartões e faturas

| RN | Regra | Origem |
|---|---|---|
| RN-130 | Cartão: dias de fechamento e vencimento de 1 a 31; limite opcional. Excluir apaga as compras em cascata. `active` é só informativo: cartões inativos **continuam** no saldo futuro, no relatório e na simulação. | `card.calculator.ts`; `cashflow.usecases.ts:74`; `prisma-finance.repositories.ts:631-637` |
| RN-131 | Fatura de uma compra: se a data da compra é **anterior** ao fechamento do mês (com o dia limitado) → fatura desse mês; no dia do fechamento ou depois → fatura do mês seguinte. Vencimento: no mesmo mês se `dueDay > closingDay`, senão no seguinte, com o dia limitado. | `card.calculator.ts:46-59` |
| RN-132 | Parcelas: `⌊total / n⌋`, e o **resto vai inteiro na 1ª parcela**. A parcela N cai N−1 faturas depois da primeira. | `card.calculator.ts:62-83` |
| RN-133 | Compra: o cartão precisa existir; categoria de despesa (arquivada é aceita); 1 a 48 parcelas (padrão 1); qualquer data. Observação vazia após o trim → null. Não há checagem de limite. | `cards.usecases.ts:167-197` |
| RN-134 | Status da fatura: PAST se o vencimento é antes de hoje; CLOSED se o fechamento é hoje ou antes; OPEN se é a fatura que receberia uma compra feita hoje; senão FUTURE. | `card.calculator.ts:91-99` |
| RN-135 | Listagem de cartões (`?today`, padrão UTC do servidor): `usedLimitCents` = soma das parcelas com vencimento ≥ hoje. `invoices` = faturas não PAST que têm parcelas + a fatura aberta (vazia, se preciso), em ordem cronológica, **até 4**. | `cards.usecases.ts:36-66` |
| RN-136 | Detalhe da fatura: `?month` (padrão: a aberta pela data UTC do servidor; a rota **não** aceita `today`); item com o rótulo = observação ou nome da categoria. Mês sem parcelas → fatura vazia com o status calculado. | `cards.usecases.ts:122-165`; `card.calculator.ts:131-151` |
| RN-137 | A fatura não tem baixa nem pagamento registrado: o saldo futuro a considera paga inteira no vencimento. | `cashflow.calculator.ts:256-266` |

### 4.10 Finance: saldo futuro e "Posso comprar?"

| RN | Regra | Origem |
|---|---|---|
| RN-140 | O saldo futuro só funciona com `openingDate` definido. Sem ele, `GET /cashflow` devolve `configured:false` com listas vazias e zeros. `today = ?today` (o front manda a data local do aparelho), ou a data UTC do servidor. O intervalo exige `to ≥ from` ("A data final precisa ser depois da inicial.") e no máximo 400 dias ("Peça no máximo 400 dias por vez."). | `cashflow.usecases.ts:147-174`; `cashflow.contract.ts:425-450` |
| RN-141 | Dados de entrada: lançamentos de `openingDate` até o dia 1 de (mês de hoje + 14); contas **ativas**; baixas a partir do mês do saldo inicial; entradas fixas **ativas**; todos os cartões e compras; depósitos em metas com `createdAt ≥ openingDate`. Média diária = `dailyBudgetCents`, se definido; senão, despesas dos 90 dias antes de hoje ÷ `max(7, min(90, ⌈dias desde o 1º lançamento do período⌉))`, arredondado; sem despesas → 0. | `cashflow.usecases.ts:59-144`; `prisma-finance.repositories.ts:215-231` |
| RN-142 | Eventos. **Lançamento** na data (rótulo = observação ou categoria). **Entrada fixa** em todo mês, do mês do saldo inicial ao fim, no dia de recebimento limitado ao mês (presumida recebida em dias passados). **Conta** nas competências de `max(startMonth, mês inicial)` dentro do prazo, ignorando vencimentos < `openingDate`: com baixa WAIVED → nada; PAID → saída na data UTC de `paidAt`, com o valor pago; vencida sem baixa → `BILL_OVERDUE` **hoje**, com o rótulo "{conta} · atrasada desde DD/MM"; senão → saída prevista no vencimento. Rótulo com prazo: "{nome} N/T". **Fatura** com valor > 0 → saída no vencimento, "Fatura {cartão}". **Depósito em meta** → saída na data UTC de `createdAt`, "Guardado em {meta}". **Gasto médio** → −média em cada dia de `max(hoje, openingDate−1)+1` até o fim, "Gasto médio do dia". Eventos fora de [`openingDate`, fim] são descartados. | `cashflow.calculator.ts:170-305` |
| RN-143 | `projected` = data > hoje para lançamentos, entradas, contas pagas e depósitos. Para fatura, a regra é data **≥** hoje. Atrasada, prevista, gasto médio e simulação são sempre `true`. | `cashflow.calculator.ts:191-302` |
| RN-144 | Saldo dia a dia, de `openingDate` até `fim = max(último dia do mês de "to", último dia do mês de hoje, hoje)`: `saldo += entradas − saídas`. `todayBalanceCents` = saldo do fim de ontem + eventos **não previstos** de hoje; com hoje < `openingDate`, vale o saldo inicial. `days` = dias em [from, to]. `lowest` = menor saldo de hoje até `to` (no empate, o primeiro). `firstNegativeDate` = primeiro dia nesse trecho com saldo < 0. `endOfMonthCents` = saldo no último dia do mês de hoje. | `cashflow.calculator.ts:307-360` |
| RN-145 | Resumo mensal para os meses que tocam [from, to]: `openingCents` = saldo do fim do dia anterior (o 1º mês parte do saldo inicial); depósitos em metas vão para `savedCents`, não para `outCents`; `resultCents = in − out`; `closingCents` = saldo do último dia; `closed` = mês anterior ao de hoje. | `cashflow.calculator.ts:364-407 (summarizeMonths)` |
| RN-146 | "Posso comprar?": sem saldo inicial → 422 "Informe seu saldo atual na tela inicial antes de simular.". CARD exige `cardId` ("Escolha o cartão."), e um cartão inexistente → 404; as parcelas caem nos vencimentos das faturas, com o rótulo "Compra simulada · {cartão} N/T (fatura DD/MM)". ACCOUNT: uma parcela por mês, no mesmo dia (limitado), a partir do mês da data, "Compra simulada N/T". 1 a 48 parcelas, resto na 1ª. Calcula o saldo com e sem a compra; nada é gravado. | `cashflow.usecases.ts:183-226`; `cashflow.contract.ts:553-565` |
| RN-147 | Veredito: `fits` = nenhum dia negativo **depois** da compra. Frases: "Seu menor saldo vai de {R$} para {R$} em DD/MM." + "Cabe no seu saldo." / " Seu saldo já fica negativo sem essa compra — ela aumenta o buraco." / " Atenção: com essa compra o saldo fica negativo em DD/MM."; sem dias à frente → "Não há dias à frente no intervalo para comparar.". | `cashflow.calculator.ts:411-440 (buildVerdict)` |
| RN-148 ⚠️ | Desativar uma conta ou entrada fixa a remove do saldo futuro **inclusive no passado**: as baixas já feitas e os recebimentos já presumidos somem, e o saldo de hoje muda retroativamente. Editar o valor de uma entrada também reescreve o passado. | `cashflow.usecases.ts:71-73 (listActive)` |
| RN-149 ⚠️ | Uma baixa feita **antes** de `openingDate`, para uma competência com vencimento depois dele, é descartada sem virar atraso: a conta some do fluxo. | `cashflow.calculator.ts:179, 224-233` |

### 4.11 Finance: ajustes

| RN | Regra | Origem |
|---|---|---|
| RN-150 | `GET /settings` devolve os padrões (`overspendAlerts`, `weeklySummary` e `showDailyAllowance` true; `roundCents` e `autoDarkMode` false; saldo inicial 0; `openingDate` e `dailyBudgetCents` null) quando não há linha gravada. O PATCH faz upsert. | `prisma-finance.repositories.ts:559-612` |
| RN-151 | `openingDate` posterior a **amanhã em UTC** → 422 "A data do saldo inicial não pode ser no futuro.". `openingDate:null` desliga o saldo futuro. O saldo inicial é um inteiro de −10¹⁰ a 10¹⁰ e pode ser negativo (⚠️ mesmo estouro de INTEGER da RN-002). `dailyBudgetCents` ≥ 0 ou null (null = calcular pelo histórico). | `dashboard.usecases.ts:257-267`; `finance.contract.ts:306-323` |
| RN-152 | `roundCents` esconde os centavos na exibição; `showDailyAllowance=false` esconde o "por dia" na Home. Ambos só no front. | `apps/web/src/pages/*` (`hideCents`), `HomePage.tsx:84` |
| RN-153 ⚠️ | `overspendAlerts`, `weeklySummary` e `autoDarkMode` são gravados e exibidos como opções, mas **nenhum código** os usa. | busca no repositório: só aparecem em `SettingsPage.tsx` |

---

## 5. Comportamentos suspeitos: decisão sua (manter ou corrigir)

Pela regra principal, **todos serão reproduzidos** no sistema novo, e os testes de caracterização vão
fixá-los, até você decidir caso a caso. A coluna "Proposta" é só a minha sugestão.

| RN | Resumo | Impacto | Proposta |
|---|---|---|---|
| RN-002 | Valor entre R$ 21,4 mi e R$ 100 mi → 500 | Baixo (valores raros) | Corrigir: limite de validação = int32 |
| RN-004 | 31/02 vira 03/03 | Médio (dado errado, silencioso) | Corrigir: recusar data inexistente |
| RN-013 / RN-013b | "Categoria não encontrado.", "alterar o perfil da a própria conta." | Cosmético | Corrigir (só texto) |
| RN-043 | `mustChangePassword` não imposto na API | Segurança (médio) | Corrigir no backend |
| RN-044 | Suspenso ou rebaixado mantém acesso por até 15 min | Segurança (baixo/médio) | Avaliar (reconsultar no banco ou TTL menor) |
| RN-046 | 401 de senha errada força refresh | Baixo | Manter ou ajustar só no front |
| RN-057 | PATCH status PENDING grava ACTIVE | Médio (só via API) | Corrigir |
| RN-071 | `includeArchived=false` vira true | Baixo (front não usa) | Corrigir |
| RN-081 | Observação vazia gravada como `""` | Baixo | Corrigir (null) |
| RN-083 | Edição aceita categoria arquivada | Baixo | Decidir a regra |
| RN-086 | Resumo da lista soma só a página | Médio (número enganoso) | Corrigir |
| RN-095 | Baixa fora da vigência é aceita | Baixo | Decidir |
| RN-097 | Conta aparece antes de ser criada | **Alto** (dashboard e relatório de meses passados inflados) | Corrigir |
| RN-098 | "Pago" usa o valor da conta, não o pago | Médio | Decidir |
| RN-100 | Conta do dia 31 some do calendário em meses curtos | Baixo | Corrigir |
| RN-114 / RN-116 | Dashboard e relatório divergem (cartão, dispensadas) | Médio | Decidir a regra única |
| RN-148 | Desativar conta ou entrada reescreve o passado do saldo | **Alto** (saldo de hoje muda) | Corrigir |
| RN-149 | Baixa anterior ao saldo inicial some | Baixo | Decidir |
| RN-153 | Três preferências sem efeito | Baixo | Decidir (implementar ou remover = melhoria) |

Além desses, há inconsistências de **fuso horário**: o dashboard, as contas, o relatório, as dívidas, a
fatura e as datas "Hoje/Ontem" usam a data **UTC do servidor**, enquanto o saldo futuro usa a data
**local** enviada pelo front. Para um usuário no Brasil, entre 21h e meia-noite, essas telas já estão no
"dia seguinte". (Origem: `currentMonthRef()` e `new Date()` nas rotas e casos de uso citados.)
Isso será registrado como **RN-160 ⚠️** e reproduzido.

---

## 6. Modelo de dados

### 6.1 Tabelas (PostgreSQL, schema `public`, nomes de coluna em camelCase **entre aspas**)

| Tabela | PK | Colunas relevantes | Restrições e índices |
|---|---|---|---|
| `users` | `id TEXT` (UUID v4 gerado pela **aplicação**) | `name VARCHAR(80)`, `email VARCHAR(160)`, `passwordHash TEXT` (PHC Argon2id), `role "UserRole"`, `status "UserStatus"`, `mustChangePassword`, `failedLoginAttempts`, `lockedUntil`, `lastLoginAt`, `createdAt`, `updatedAt` | `email` UNIQUE (já em minúsculas); índice `status` |
| `refresh_tokens` | `id TEXT` | `tokenHash` (SHA-256 hex) UNIQUE, `userId`, `expiresAt`, `revokedAt`, `replacedBy`, `userAgent(255)`, `ip(64)`, `createdAt` | FK `users` CASCADE; índices `userId` e `expiresAt` |
| `audit_logs` | `id TEXT` | `action(64)`, `targetType(40)`, `targetId`, `actorId`, `actorEmail(160)`, `ip(64)`, `metadata JSONB`, `createdAt` | FK `actorId` → `users` **SET NULL**; índices `createdAt` e `actorId` |
| `user_settings` | `userId` | 5 booleanos, `openingBalanceCents INT`, `openingDate DATE`, `dailyBudgetCents INT?`, `updatedAt` | FK CASCADE |
| `categories` | `id` | `userId`, `name(60)`, `color(64)`, `kind "CategoryKind"`, `isSystem`, `archivedAt` | UNIQUE `(userId, name, kind)` (diferencia maiúsculas no banco; a aplicação não); índice `(userId, kind)` |
| `transactions` | `id` | `userId`, `categoryId`, `type "EntryType"`, `amountCents INT`, `occurredOn DATE`, `note(140)`, `billId` (sem FK) | FK categoria **RESTRICT**; índices `(userId, occurredOn)` e `(userId, categoryId)` |
| `bills` | `id` | `userId`, `categoryId`, `name`, `amountCents`, `dueDay`, `active`, `startMonth DATE`, `totalInstallments INT?` | FK categoria RESTRICT; índice `(userId, active)` |
| `bill_payments` | `id` | `billId`, `userId`, `referenceMonth DATE`, `amountCents`, `paidAt`, `status "BillPaymentStatus"` | UNIQUE `(billId, referenceMonth)`; FK conta CASCADE |
| `incomes` | `id` | `name`, `amountCents`, `receiptDay`, `active` | índice `(userId, active)` |
| `debts` | `id` | `installmentCents`, `paidInstallments`, `totalInstallments` | índice `userId` (há plano de remover a tabela: `docs/PLANO-SALDO-FUTURO.md`) |
| `goals` / `goal_deposits` | `id` | `targetCents`, `savedCents`, `featured` / `goalId`, `amountCents`, `createdAt` | depósitos CASCADE com a meta; **depósito não tem `userId`** |
| `cards` / `card_purchases` | `id` | `closingDay`, `dueDay`, `limitCents?`, `active` / `cardId`, `categoryId`, `amountCents` (total), `installments`, `purchasedOn DATE`, `note` | compras CASCADE com o cartão; categoria RESTRICT |

- Enums do Postgres: `UserRole(ADMIN,USER)`, `UserStatus(ACTIVE,SUSPENDED,PENDING)`,
  `CategoryKind(EXPENSE,INCOME)`, `EntryType(EXPENSE,INCOME)`, `BillPaymentStatus(PAID,WAIVED)`.
- Todo dado do usuário cai em cascata quando ele é excluído.
- **Valores gerados pela aplicação, não pelo banco:** `id` (UUID) e `updatedAt`, que não têm default no
  banco. Só `createdAt` e `paidAt` têm `DEFAULT CURRENT_TIMESTAMP`. Isso importa para o .NET.
- Timestamps em `TIMESTAMP(3)` **sem fuso**, gravados em UTC.
- Migrations versionadas pelo Prisma (tabela `_prisma_migrations`, 4 migrations, a última de
  `2026-10-06`). A migration `20260923…` preencheu `startMonth` das contas antigas com o mês de
  `createdAt`.

### 6.2 Seed

`prisma/seed.ts` é idempotente: cria o ADMIN inicial (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) e, com
`SEED_DEMO_DATA=true`, um usuário de demonstração com dados. Ele **duplica** a lista de categorias
padrão (segunda fonte da RN-062).

---

## 7. Integrações

| Item | Situação |
|---|---|
| Serviços externos (e-mail, SMS, pagamento, WhatsApp, ERP, SEFAZ) | **Nenhum** |
| Front ↔ API | REST/JSON + cookie httpOnly, entre domínios diferentes (Vercel × Railway): exige `SameSite=None; Secure` e CORS com credenciais |
| Banco | PostgreSQL gerenciado na Railway |
| Hospedagem | Railway (API, healthcheck `/health`, restart ON_FAILURE) e Vercel (SPA com rewrite e cabeçalhos de segurança) |
| Contratos compartilhados | `@grana/shared`: os **mesmos** schemas Zod validam o formulário no front e a requisição na API. Num backend .NET, essa garantia de compilação deixa de existir (risco R-08) |

---

## 8. Riscos da migração para .NET

| # | Risco | Por que importa | Mitigação a detalhar no plano |
|---|---|---|---|
| R-01 | **Hash de senha** | Os hashes são strings PHC Argon2id (`m=19456,t=2,p=1`). Se o .NET não verificar exatamente esse formato, ninguém consegue logar | Biblioteca Argon2id compatível com PHC + teste de caracterização com hash gerado pelo sistema atual |
| R-02 | **Coexistência de sessões (Strangler)** | Os dois backends precisam aceitar o mesmo JWT (HS256, `iss`, segredo) e o mesmo refresh token (SHA-256 hex, mesma tabela) e escrever o cookie no mesmo `path`/domínio | Gateway na frente roteando por prefixo; mesmo segredo; testes de interoperabilidade |
| R-03 | **Arredondamento** | `Math.round` do JS arredonda .5 para +∞; o `Math.Round` do .NET usa arredondamento bancário por padrão | Usar `MidpointRounding.AwayFromZero` só onde for equivalente (cuidado com negativos) e testar valores-limite |
| R-04 | **Datas** | Rolagem de datas inválidas (RN-004), "hoje" em UTC, `Date.UTC` com mês negativo, saída ISO com **3** casas de milissegundo (o .NET emite 7) | Conversor de datas dedicado + testes de serialização |
| R-05 | **Formatação de moeda** | `toLocaleString('pt-BR')` do Node/ICU × `CultureInfo("pt-BR")`: separadores, espaço e o sinal U+2212 | Formatter próprio, testado contra as frases do sistema atual |
| R-06 | **Ordenação** | `ORDER BY name` depende da collation do banco; ordenar em memória no .NET pode dar outra ordem | Manter a ordenação no SQL |
| R-07 | **Mensagens e caminhos de validação** | O front mostra as mensagens do Zod por campo (`details.path`); 400 × 422 conforme a origem | Validação (ex.: FluentValidation) com as mesmas mensagens e paths, coberta por testes de contrato |
| R-08 | **Perda do contrato compartilhado** | Hoje o `tsc` quebra se API e front divergirem | Gerar tipos TS a partir do OpenAPI do .NET, ou manter `@grana/shared` só para o front + testes de contrato |
| R-09 | **Rate limit em memória** | Com dois backends, os limites dobram e o estado não é compartilhado | Rate limit no gateway, ou aceitar temporariamente (decisão: aqui o Redis se justificaria) |
| R-10 | **Dono do schema** | Prisma Migrate e EF Core não podem ambos alterar o banco | Congelar o schema na transição; um único dono das migrations, definido no plano |
| R-11 | **Mapeamento EF Core** | Colunas em camelCase com aspas, enums nativos do Postgres, `DATE` × `timestamp` | Mapeamento explícito + teste de leitura de todas as tabelas |
| R-12 | **Erros nativos do Fastify** | JSON malformado, content-type errado e corpo grande geram códigos próprios (`FST_ERR_*`) | Caracterizar os casos que o front trata; os demais, registrar como diferença aceita com sua aprovação |
| R-13 | **Ausência do .NET SDK** | Bloqueia a fase 4 | Instalar o SDK do .NET 10 LTS |

---

## 9. Débitos técnicos

1. **Domínio financeiro anêmico.** Só `User` é entidade de verdade. No Finance, as regras ficam nos
   casos de uso e em funções puras, sobre "records" (`finance/domain/ports.ts`).
2. **Violações de Clean Architecture e DIP.** Casos de uso importam mappers da infra
   (`application/*.ts` → `infra/finance.mappers.ts`, `identity/infra/user.mapper.ts`).
   `AuthenticateUserUseCase` e `ChangePasswordUseCase` dependem do concreto `Argon2PasswordHasher`
   (por causa do `burnTime`). `JwtTokenService` depende de `FastifyInstance`.
3. **Operações compostas sem transação.** Criar usuário + preparar o espaço, converter dívida, limpar
   destaque de meta e a rotação do refresh token (com corrida: duas abas renovando juntas podem
   disparar a detecção de reuso e derrubar a sessão legítima).
4. **Utilitários duplicados.** `toMonthRef`, `previousMonth`, `addMonthsLocal` e três `parseISODate`;
   a lista de categorias padrão aparece no domínio e no seed.
5. **Casts `as unknown as`** nos repositórios Prisma.
6. **Itens mortos.** `JWT_REFRESH_SECRET` é exigido mas não é usado; `purgeExpiredRefreshTokens` nunca
   roda (tokens expirados se acumulam); a coluna `transactions.billId` não é usada; três preferências
   não têm efeito.
7. **Regras divergentes entre telas** (seção 5): fuso horário, cartão no dashboard, dispensadas,
   vigência das contas.
8. **Cobertura de testes.** Há bons testes de domínio (orçamento, cartão, saldo futuro) e 30 testes de
   integração. **Sem cobertura:** categorias (exclusão, arquivamento, duplicidade), entradas fixas,
   CRUD de dívidas, destaque de metas, ajustes, listagem e filtros de usuários, fluxo de aprovação de
   pendentes, bloqueio por tentativas, rate limits, DTO de cartões e limite usado, relatório com
   cartão, paginação e `summary` da lista, calendário de contas e mensagens de erro de validação.
9. **Tabela `debts`** com remoção já planejada, mas ainda ativa (`docs/PLANO-SALDO-FUTURO.md`).

---

## 10. Perguntas que preciso que você responda

O modelo do pedido veio com campos não preenchidos. Para não inventar regra, preciso de:

- **P1. Motivação.** O código atual já segue DDD e Clean Architecture e tem testes. Qual problema a
  refatoração resolve (padronizar a empresa em .NET, desempenho, manutenção, contratação…)? A resposta
  muda as prioridades do plano, não a paridade.
- **P2. Frontend.** O front já é React + TS. Minha proposta: **mantê-lo** e só apontá-lo para a API
  .NET, sem reescrever telas. Concorda?
- **P3. Banco.** Minha proposta: o .NET usa **o mesmo banco e o mesmo schema**, sem ETL. A fase de
  "migração de dados" vira validação de leitura e escrita, com rollback = voltar o roteamento para o
  Node. A alternativa é um schema novo (nomes snake_case, por exemplo), que exige ETL de verdade.
  Qual prefere?
- **P4. Hospedagem.** O .NET continua na Railway?
- **P5. Versão.** .NET 10 (LTS atual) está ok?
- **P6. Comportamentos suspeitos.** Pode decidir agora (manter ou corrigir) os itens da seção 5 ou
  deixar para depois da paridade. Até lá, eles são reproduzidos.

### 10.1 Respostas (2026-10-20)

| # | Decisão |
|---|---|
| P1 | **Em aberto.** Não bloqueia: só muda prioridades. |
| P2 | **Manter o front React** e só apontá-lo para a API .NET. Vale também para o app Flutter (`apps/mobile`, já em produção na `main`). |
| P3 | **Mesmo banco e mesmo schema**, sem ETL. A migração de dados vira validação de leitura e escrita; rollback = rotear de volta para o Node. |
| P4 | **Railway** para a API .NET. |
| P5 | **.NET 10 LTS.** |
| P6 | **Depois da paridade.** Os 22 itens ⚠️ são reproduzidos e fixados pelos testes de caracterização; cada correção entra só com aprovação explícita. |

---

## 11. Correções e achados da caracterização (Fase 2)

A suíte `tests/paridade` (154 testes, caixa-preta contra a API em modo produção) confirmou a
análise e corrigiu ou acrescentou estes pontos. **Eles valem mais que o texto das seções 4 e 5.**

| Item | O que a API faz de verdade | Teste |
|---|---|---|
| RN-015 (correção) | O 429 de rate limit passa pelo tratador comum: `{statusCode:429, error:"Error", code:"RATE_LIMITED", message, requestId}` — com `requestId` e `error: "Error"`. | `04-rate-limit` |
| RN-036 (correção) | O access token emitido **não tem `iss`** (a opção do `sign` substitui a padrão). A verificação aceita `iss` ausente ou `grana-api` e recusa outro emissor. Payload: `sub, email, role, iat, exp`. | `02-autenticacao`, `01-transversal` |
| RN-008 (acréscimo) | A **validação do corpo vem antes da autenticação e da autorização**: sem token e corpo inválido → 400; usuário comum com corpo inválido na área de admin → 400, não 403. | `01-transversal`, `03-cadastro-admin` |
| RN-008 (acréscimo) | Campo ausente e enum inválido saem com a mensagem **padrão, em inglês**, do validador (ex.: `Invalid input: expected number, received undefined`, `Invalid option: expected one of "EXPENSE"\|"INCOME"`). | `01-transversal` |
| RN-008 (acréscimo) | Um campo pode trazer **mais de uma mensagem** em `details` (ex.: data `2026-1-1` → formato + "Data inexistente."). | `01-transversal` |
| RN-015 (acréscimo) | O IP do rate limit vem do `X-Forwarded-For` (trustProxy). Os contadores ficam em memória e sobrevivem entre requisições de clientes diferentes. | `04-rate-limit` |
| R-11 (acréscimo) | Colunas `TIMESTAMP(3)` sem fuso guardam **UTC**; um driver que assume o fuso local desloca as datas em 3h (confirmado com o `pg`). O Npgsql tem a mesma armadilha. | `src/db.ts` |
| **RN-162 ⚠️ (novo, segurança)** | O IP do rate limit é o **mais à esquerda** do `X-Forwarded-For` (`trustProxy: true`, `app.ts:57`), valor que o cliente controla: trocando-o, burla-se qualquer rate limit por IP, inclusive o de login. O bloqueio por conta (5 falhas) continua valendo. **Corrigido pela D-02 (2026-10-20)**: ver `plano.md` §9. | `04-rate-limit` |
| **RN-161 ⚠️ (novo)** | **Origem fora da allowlist de CORS → 500 genérico**, não 403. Em produção, os previews `*.vercel.app` caem nesse mesmo 500. | `12-borda` |
| RN-002 ⚠️ (confirmado) | Valor > 2.147.483.647 centavos passa na validação e responde 500 genérico; 2.147.483.647 é aceito. | `11-ajustes` |
| **RN-072 ⚠️ (novo, T-012)** | A checagem de nome repetido é um `name ILIKE $nome` **sem escape** (é o `mode: 'insensitive'` do Prisma): `_` e `%` no nome NOVO viram curinga. Com "Yyabc" cadastrada, criar "Y%" dá 409; renomear "Lazer" para "L_zer" dá 409 (casa com ela mesma). O .NET reproduz (`EF.Functions.ILike`). Impacto baixo; corrigir depois da paridade (escapar o nome). | sonda da T-012 |
| **RN-084 ⚠️ (acréscimo, T-022)** | A busca de lançamentos é `note ILIKE '%' \|\| busca \|\| '%'` **sem escape** (`contains` do Prisma): `%` e `_` na busca viram curinga (`?search=%` traz todos com observação). Lançamento sem observação nunca aparece numa busca. `page` aceita até 2⁵³−1 e devolve a página vazia. O .NET reproduz. | sonda e `m2.cruzado` |
| RN-101 (acréscimo, T-042) | Em `/bills/overdue`, o `today` da query é usado como **texto**: o mês vem do texto e a comparação "vence antes de hoje" é de strings; só `daysLate` usa a data rolada (`today=2026-02-31` → mês 02, atraso contado até 03/03). Com `today` a partir de `9998-11`, o carregador do saldo futuro monta uma data de 5 dígitos, o `Date` fica inválido e a resposta é **500** (se o saldo futuro estiver configurado). O .NET reproduz os dois. | `m4.cruzado`, testes de domínio |
| RN-134/135 (acréscimo, T-052) | Nos cartões, todas as datas são comparadas como **texto** `AAAA-MM-DD`, inclusive o `?today` da listagem: `today=2026-02-31` com fechamento no dia 28 cai na fatura de março e deixa a de fevereiro CLOSED. A data da compra, ao contrário, é gravada rolada (31/02 → 03/03). O .NET reproduz. | `m5.cruzado`, testes de domínio |
| R-12 (acréscimo, T-012) | Erros do parser do Fastify nas rotas: JSON malformado, só espaços, `__proto__` ou `constructor.prototype` → 400 `FST_ERR_CTP_INVALID_JSON_BODY`; JSON vazio → 400 `FST_ERR_CTP_EMPTY_JSON_BODY`; sem `Content-Type` com corpo, ou tipo diferente de `application/json` e `text/plain` → 415 `FST_ERR_CTP_INVALID_MEDIA_TYPE` "Unsupported Media Type"; > 1 MB → 413 `FST_ERR_CTP_BODY_TOO_LARGE`. Em todos, `error: "FastifyError"`. `text/plain` chega como texto ("expected object, received string"); sem corpo, como `null`. Chave repetida no JSON: vale a última. Rotas diferenciam maiúsculas e barra final (404). | sonda da T-012 |
| Todos os ⚠️ da seção 5 | Reproduzidos e fixados como comportamento atual. | ver `tests/paridade/README.md` |
