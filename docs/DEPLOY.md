# Deploy: Git → Railway (API + banco) → Vercel (front)

Este guia é linear. Faça na ordem: **Git primeiro**, depois **Railway**, depois **Vercel**, e por
último a **ligação entre os dois** (CORS + URL da API). Pular a ordem é a causa nº 1 de
"funciona local, quebra em produção".

Tempo estimado na primeira vez: 30–45 minutos.

---

## Etapa 0 — Antes de começar

Tenha em mãos:

- Uma conta no [GitHub](https://github.com), na [Railway](https://railway.app) e na
  [Vercel](https://vercel.com) (as três aceitam login com o GitHub).
- Node 20.11+ e Git instalados.
- Os dois segredos JWT gerados:

```bash
openssl rand -base64 48   # anote como JWT_ACCESS_SECRET
openssl rand -base64 48   # anote como JWT_REFRESH_SECRET
```

> Gere **dois valores diferentes**. A API se recusa a subir em produção se forem iguais ou se
> ainda forem os de exemplo — é proposital.

---

## Etapa 1 — Subir o monorepo para o Git

O monorepo vai inteiro em **um único repositório**. Railway e Vercel sabem trabalhar com
subdiretórios; não separe em dois repos.

```bash
cd grana

git init
git branch -M main
git add .
git commit -m "feat: aplicação Grana — API Fastify + front React"
```

Confirme que **nenhum `.env` entrou** (o `.gitignore` já cuida disso, mas vale conferir):

```bash
git ls-files | grep -E "\.env$" && echo "⚠️  PARE: tem .env versionado" || echo "✓ ok"
```

Crie o repositório no GitHub e envie:

```bash
gh repo create grana --private --source=. --push
# ou, sem o gh CLI:
# git remote add origin git@github.com:SEU-USUARIO/grana.git
# git push -u origin main
```

### Fluxo de branches sugerido

| Branch      | Ambiente                                          |
| ----------- | ------------------------------------------------- |
| `main`      | produção (Railway + Vercel production)            |
| `develop`   | staging (opcional: um segundo projeto na Railway) |
| `feature/*` | preview automático da Vercel a cada PR            |

---

## Etapa 2 — Railway: banco de dados

1. **New Project** → **Provision PostgreSQL**.
2. Espere o serviço `Postgres` ficar verde.
3. Em **Variables** dele existe `DATABASE_URL`. **Não copie o valor** — você vai referenciá-la.

> Referência (`${{ Postgres.DATABASE_URL }}`) em vez de valor colado: se a Railway rotacionar a
> senha do banco, a API continua funcionando sozinha.

---

## Etapa 3 — Railway: a API

No mesmo projeto: **New** → **GitHub Repo** → selecione `grana`.

### 3.1 Configurações do serviço

Em **Settings** do serviço da API:

| Campo                   | Valor                                                 |
| ----------------------- | ----------------------------------------------------- |
| **Service Name**        | `api`                                                 |
| **Root Directory**      | `/` _(a raiz — o build precisa do workspace inteiro)_ |
| **Build Command**       | `npm ci && npm run build:shared && npm run build:api` |
| **Start Command**       | `npm run release -w @grana/api`                       |
| **Watch Paths**         | `apps/api/**`, `packages/shared/**`                   |
| **Healthcheck Path**    | `/health`                                             |
| **Healthcheck Timeout** | `120`                                                 |

O `npm run release` faz `prisma migrate deploy && node dist/main.js`: **a migration roda a cada
deploy, antes do servidor subir**. É o que mantém o schema do banco em dia sem passo manual.

> **Watch Paths** evita rebuild da API quando você mexeu só no front.

### 3.2 Variáveis de ambiente

Em **Variables** do serviço `api` (use o "Raw Editor" para colar tudo de uma vez):

```env
NODE_ENV=production
PORT=${{PORT}}
HOST=0.0.0.0
LOG_LEVEL=info

DATABASE_URL=${{Postgres.DATABASE_URL}}

JWT_ACCESS_SECRET=<cole o primeiro openssl>
JWT_REFRESH_SECRET=<cole o segundo openssl>
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=7

CORS_ORIGINS=https://SEU-PROJETO.vercel.app
COOKIE_DOMAIN=

RATE_LIMIT_MAX=200
LOGIN_RATE_LIMIT_MAX=8

ADMIN_EMAIL=voce@seudominio.com
ADMIN_PASSWORD=<uma senha forte que você vai trocar no primeiro acesso>
ADMIN_NAME=Administrador
SEED_DEMO_DATA=false
```

`CORS_ORIGINS` você ainda não sabe — coloque um valor temporário e **volte aqui na Etapa 6**.

### 3.3 Domínio público

**Settings → Networking → Generate Domain**. Você recebe algo como
`https://api-production-a1b2.up.railway.app`. **Anote: essa é a `VITE_API_URL`.**

### 3.4 Criar o administrador inicial

O deploy roda as migrations, mas **não** o seed (seed não deve rodar sozinho a cada deploy).
Rode uma vez, pela sua máquina:

```bash
npm i -g @railway/cli
railway login
railway link                       # escolha o projeto e o serviço "api"
railway run npm run db:seed -w @grana/api
```

Saída esperada:

```
🌱 Semeando o banco…
✓ Usuário voce@seudominio.com criado (ADMIN).
✅ Seed concluído.
```

O seed é idempotente: rodar de novo não duplica nada.

### 3.5 Conferir

```bash
curl https://SEU-APP.up.railway.app/health
# {"status":"ok","uptime":12,"database":"up"}
```

Se vier `database: up`, a API subiu **e** está falando com o Postgres.

---

## Etapa 4 — Vercel: o frontend

1. **Add New → Project** → importe o repositório `grana`.
2. Na tela de configuração:

| Campo                | Valor                                                                   |
| -------------------- | ----------------------------------------------------------------------- |
| **Framework Preset** | Vite                                                                    |
| **Root Directory**   | `apps/web` — e **marque "Include files outside of the root directory"** |
| **Build Command**    | `cd ../.. && npm run build:shared && npm run build:web`                 |
| **Output Directory** | `dist`                                                                  |
| **Install Command**  | `cd ../.. && npm ci`                                                    |

> A opção **"Include files outside of the root directory"** é obrigatória num monorepo: sem ela a
> Vercel não enxerga `packages/shared` e o build falha com "Cannot find module '@grana/shared'".

3. **Environment Variables**:

| Nome           | Valor                            | Ambientes                        |
| -------------- | -------------------------------- | -------------------------------- |
| `VITE_API_URL` | `https://SEU-APP.up.railway.app` | Production, Preview, Development |

4. **Deploy**. Anote a URL final: `https://seu-projeto.vercel.app`.

### 4.1 Rewrite de SPA (obrigatório)

Sem isso, abrir `https://seu-projeto.vercel.app/contas` direto devolve 404 — o React Router só
funciona se o servidor devolver o `index.html` para qualquer rota. O arquivo
`apps/web/vercel.json` já está no repositório fazendo exatamente isso:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

---

## Etapa 5 — Fechar o circuito (o passo que todo mundo esquece)

Volte à **Railway → serviço `api` → Variables** e ajuste:

```env
CORS_ORIGINS=https://seu-projeto.vercel.app
```

Sem barra no final. Para liberar também os previews da Vercel, separe por vírgula:

```env
CORS_ORIGINS=https://seu-projeto.vercel.app,https://seu-projeto-git-develop-seuescopo.vercel.app
```

A Railway redeploya sozinha. Espere ficar verde e abra o app.

### Sobre o cookie entre domínios

Front (`vercel.app`) e API (`railway.app`) são domínios diferentes, então o cookie do refresh token
sai como `SameSite=None; Secure`. Isso funciona, mas exige que **as duas pontas estejam em HTTPS**
e que a origem esteja na allowlist — as duas coisas já estão configuradas.

**Melhoria recomendada quando você tiver domínio próprio:** aponte o front para
`app.seudominio.com` e a API para `api.seudominio.com`. Aí basta definir na Railway:

```env
COOKIE_DOMAIN=.seudominio.com
```

O cookie passa a ser _same-site_, o que é mais seguro e imune a navegadores que bloqueiam cookies
de terceiros.

---

## Etapa 6 — Primeiro acesso

1. Abra `https://seu-projeto.vercel.app`.
2. Entre com o `ADMIN_EMAIL` / `ADMIN_PASSWORD` que você configurou.
3. Vá em **Mais → Ajustes → Trocar minha senha** e troque a senha do `.env`.
4. Em **Gerenciar usuários**, cadastre as demais pessoas. Cada uma recebe uma senha provisória e
   é obrigada a trocá-la no primeiro acesso.

---

## Etapa 7 — Deploys seguintes

```bash
git add .
git commit -m "feat: nova regra de X"
git push
```

- A **Vercel** builda o front e publica.
- A **Railway** builda a API, roda `prisma migrate deploy` e sobe a nova versão.

### Quando você mudar o schema do banco

```bash
# 1. na sua máquina, contra o banco LOCAL
npm run db:migrate -- --name adiciona_campo_x

# 2. confira o SQL gerado em apps/api/prisma/migrations/<timestamp>_adiciona_campo_x/
# 3. commite a migration junto com o código
git add apps/api/prisma/migrations
git commit -m "feat(db): adiciona campo x"
git push
```

A Railway aplica em produção no deploy. **Nunca** rode `prisma db push` contra produção: ele altera
o banco sem registrar migration e o histórico sai do lugar.

---

## Solução de problemas

| Sintoma                                                   | Causa provável                                              | O que fazer                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `CORS policy: No 'Access-Control-Allow-Origin'`           | `CORS_ORIGINS` não bate com a URL da Vercel                 | Confira barra no final e `https://`. A URL tem que ser idêntica.                                                         |
| Login funciona, mas o F5 desloga                          | Cookie de refresh não está sendo aceito                     | Confirme HTTPS nas duas pontas e `credentials: 'include'` (já está no cliente). Em domínio próprio, use `COOKIE_DOMAIN`. |
| Build da Vercel: `Cannot find module '@grana/shared'`     | Faltou marcar "Include files outside of the root directory" | Ative a opção e refaça o deploy.                                                                                         |
| Railway: `Can't reach database server`                    | `DATABASE_URL` colada como valor fixo                       | Troque por `${{Postgres.DATABASE_URL}}`.                                                                                 |
| Healthcheck falha no deploy                               | Migration demorou mais que o timeout                        | Aumente **Healthcheck Timeout** para 300 na primeira vez.                                                                |
| `Invalid \`prisma.x\` invocation` após atualizar o Prisma | Versões de engine desalinhadas                              | Alinhe `prisma`, `@prisma/client`, `@prisma/adapter-pg` e `@prisma/query-compiler-wasm` (veja o README).                 |
| 429 no login durante testes                               | Rate limit de 8 tentativas / 15 min por IP                  | Espere a janela ou aumente `LOGIN_RATE_LIMIT_MAX` temporariamente.                                                       |

---

## Custos (referência)

| Serviço | Plano                  | Observação                                           |
| ------- | ---------------------- | ---------------------------------------------------- |
| Railway | Hobby (crédito mensal) | API + Postgres pequenos cabem bem no início.         |
| Vercel  | Hobby                  | Site estático + rewrites: gratuito para uso pessoal. |

Confira os valores atuais nos sites — planos mudam.

---

## Checklist final

- [ ] Nenhum `.env` versionado
- [ ] `JWT_ACCESS_SECRET` ≠ `JWT_REFRESH_SECRET`, ambos gerados por `openssl`
- [ ] `DATABASE_URL` usando referência `${{Postgres.DATABASE_URL}}`
- [ ] `/health` respondendo `database: up`
- [ ] `CORS_ORIGINS` com a URL exata da Vercel
- [ ] `VITE_API_URL` com a URL exata da Railway
- [ ] `vercel.json` com o rewrite de SPA
- [ ] Seed rodado uma vez; senha do administrador trocada pelo app
- [ ] `SEED_DEMO_DATA=false` em produção
