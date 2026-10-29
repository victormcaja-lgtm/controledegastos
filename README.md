# controledegastos

Controle de gastos (Grana): orçamento por competência, contas fixas, cartões, dívidas, metas e
saldo futuro.

## O que tem aqui

| Pasta                        | O que é                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `packages/shared`            | `@grana/shared` — schemas Zod e utilitários usados pela API e pelo front |
| `apps/api`                   | API Node (Fastify + Prisma) — **em produção hoje**                       |
| `apps/api-dotnet`            | API .NET 10 que está substituindo a Node (Strangler Fig)                 |
| `apps/web`                   | Front React (Vite)                                                       |
| `apps/mobile`                | App Flutter                                                              |
| `tests/paridade`             | Suíte que caracteriza a API e compara Node × .NET                        |
| `tools/verificador-paridade` | Comparação Node × .NET por amostragem, para homologação                  |
| `tools/homologacao`          | Montagem do ambiente de homologação (cópia anonimizada do banco)         |

## Rodando localmente

```bash
docker compose up -d          # Postgres na porta 5433
npm ci
npm run db:migrate && npm run db:seed
npm run dev                   # API Node na 3333 + front na 5173
npm test                      # testes de todos os workspaces
```

API .NET (precisa do SDK 10):

```bash
cd apps/api-dotnet
dotnet build -c Release
dotnet test -c Release --no-build
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/grana_dev \
NODE_UPSTREAM_URL=http://127.0.0.1:3333 PORT=3335 \
  dotnet run --project src/Grana.Api -c Release --no-build
```

Sem `Strangler__Modules__<Módulo>=dotnet`, tudo é repassado para a API Node; sem
`NODE_UPSTREAM_URL`, o .NET atende sozinho. Detalhes em [docs/DEPLOY.md](docs/DEPLOY.md#etapa-8--api-net-fachada-strangler-fig).

## Documentação

- [Arquitetura](docs/ARQUITETURA.md)
- [Deploy](docs/DEPLOY.md)
- [Segurança](docs/SEGURANCA.md)
- Migração para .NET: [spec](docs/refatoracao/spec.md), [plano](docs/refatoracao/plano.md),
  [tarefas](docs/refatoracao/tasks.md), [análise](docs/refatoracao/analise.md)
