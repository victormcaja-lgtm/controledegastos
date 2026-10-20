# Plano — Migração da API Grana para .NET 10

> **Fase 3 — Plano.** Entregável do agente Arquiteto (único que decide arquitetura e
> infraestrutura). Base: `spec.md`, `analise.md`, `tests/paridade`. Data: 2026-10-20.

## 1. Estratégia em uma frase

Uma **fachada .NET** passa a atender o domínio público da API. No primeiro dia ela repassa 100% das
rotas ao Node, sem mudar nada. Depois, módulo a módulo, ela passa a responder rotas com código
próprio (Strangler Fig). A cada passo a suíte de paridade roda inteira contra a fachada. O Node só é
desligado quando não sobra nenhuma rota repassada.

```
 site (Vercel) ─┐                         ┌─► rotas já migradas: código .NET ─┐
 app (Flutter) ─┼─► API pública (fachada .NET) ─┤                                  ├─► PostgreSQL (mesmo schema)
                │                         └─► demais rotas: YARP → API Node ──┘
```

## 2. Arquitetura alvo

### 2.1 Solução

```
apps/api-dotnet/
  Grana.sln
  src/
    Grana.Domain/          entidades, value objects, serviços de domínio, erros — sem dependências
    Grana.Application/     casos de uso, portas (interfaces), DTOs de saída — depende só do Domain
    Grana.Infrastructure/  EF Core/Npgsql, Argon2, JWT, relógio, auditoria — implementa as portas
    Grana.Api/             host ASP.NET Core: endpoints, validação de contrato, erros, borda, fachada YARP
  tests/
    Grana.Domain.Tests/          unidade (inclui os casos portados dos testes de domínio do Node)
    Grana.Application.Tests/     casos de uso com portas falsas
    Grana.Api.IntegrationTests/  API inteira contra Postgres real (Testcontainers)
    Grana.ArchitectureTests/     regras de dependência (NetArchTest)
tests/paridade/                  (já existe) suíte caixa-preta — o critério de paridade
```

**Regra de dependência:** `Api → Application → Domain` e `Infrastructure → Application/Domain`.
O Domain não referencia nada. O `Grana.ArchitectureTests` quebra o build se alguém violar isso.

### 2.2 Escolhas técnicas

| Tema | Decisão | Por quê |
|---|---|---|
| Runtime | **.NET 10 LTS**, ASP.NET Core **Minimal APIs** com grupos de rota | P5; espelha um-para-um as rotas do Fastify, sem a cerimônia de controllers |
| Persistência | **EF Core 10 + Npgsql**, mapeamento **explícito** do schema existente (tabelas `snake_case`, colunas `camelCase` entre aspas, enums nativos via `MapEnum`), **sem migrations** | P3/R-10/R-11: o Prisma continua dono do schema até o Node sair |
| Datas | `timestamp(3)` sem fuso mapeado como UTC (`DateTime` com `Kind=Utc` na leitura e na escrita); `date` como `DateOnly` | R-11, achado §11 (desvio de 3h) |
| JSON | `System.Text.Json`, camelCase, `null` sempre serializado (exceto `details` do erro), conversor próprio de data-hora com **3** casas de milissegundo e `Z` | RF-01.8, R-04 |
| Validação | **Biblioteca interna `ZodCompat`**: regras declaradas por contrato que reproduzem mensagens, `path`, ordem e acúmulo de erros do Zod (inclusive as mensagens padrão em inglês) | RF-01.6, R-07. FluentValidation exigiria tantos ajustes para ficar idêntica que a camada própria sai mais simples e testável |
| Ordem do pipeline | parse do JSON → validação de params/query/corpo → autenticação → autorização → caso de uso | Achado §11: validação antes da autenticação |
| Datas inválidas | `JsDate.Parse` reproduz o `Date.parse` do V8 (dia ≤ 31 rola para o mês seguinte) | RN-004 ⚠️ |
| Dinheiro | VO `Money` em `long` de centavos; a conversão para a coluna `integer` falha acima de 2.147.483.647 e vira o mesmo 500 genérico | RN-001, RN-002 ⚠️ |
| Arredondamento | Utilitário `JsMath.Round` (meio para +∞) usado em todo lugar onde o Node usa `Math.round` | R-03 |
| Moeda | `MoneyFormatter` próprio (não `CultureInfo`) reproduzindo o `toLocaleString('pt-BR')` e o U+2212 | R-05 |
| Senha | **Isopoh.Cryptography.Argon2** (lê e grava strings PHC), mesmos parâmetros; *dummy hash* para igualar o tempo do e-mail inexistente | R-01, RN-032 |
| Token | `Microsoft.IdentityModel.JsonWebTokens`, HS256, mesmo segredo; emite **sem `iss`**; valida assinatura e `exp`, aceita `iss` ausente ou `grana-api` | RF-03.2, R-02 |
| Refresh | 64 bytes aleatórios em base64url; SHA-256 hex; mesma tabela | RF-03.2 |
| Rate limit | `Microsoft.AspNetCore.RateLimiting` com janela fixa por IP, mesmas janelas e corpo do 429 | RF-02.4 |
| IP do cliente | `ForwardedHeaders` replicando o comportamento atual (ver §9, RN-162 ⚠️) | RF-02.3 |
| CORS e cabeçalhos | Política própria idêntica, incluindo o 500 para origem negada (RN-161 ⚠️) | RF-02.1, 02.2 |
| Fachada | **YARP** dentro do próprio `Grana.Api`, com rota de *fallback* para o Node | §6 |
| Logs | Logging nativo em JSON com `requestId`, sem `Authorization`, `Cookie` nem senhas | RNF-08 |
| Testes | xUnit, Testcontainers.PostgreSql, NetArchTest, coverlet; sem bibliotecas de licença comercial (ex.: FluentAssertions 8, MediatR 13) | RNF-06 |
| Casos de uso | Classes simples injetadas pelo DI nativo, uma por operação, interface `IUseCase<TIn,TOut>` | Mesmo desenho do Node, sem mediator |

## 3. Modelo de domínio (DDD)

### 3.1 Contextos delimitados

| Contexto | Responsabilidade | Fala com o outro por |
|---|---|---|
| **Identity** | usuários, sessões, perfis, auditoria | porta `IUserWorkspaceProvisioner` (implementada pelo Finance) |
| **Finance** | categorias, lançamentos, contas, entradas, dívidas, metas, cartões, ajustes, cálculos | só recebe `UserId` |

### 3.2 Agregados, entidades e value objects

| Agregado (raiz) | Contém | Invariantes que moram nele | RN |
|---|---|---|---|
| `User` | — | bloqueio após 5 falhas, status, troca de senha, "não pode na própria conta" | 033–036, 054, 060 |
| `Session` (refresh token) | — | rotação, revogação, reuso | 039, 040 |
| `Category` | — | arquivar/desarquivar, nome, sistema × personalizada | 072–074 |
| `Transaction` | — | tipo imutável, categoria compatível | 080–083 |
| `Bill` | `BillPayment` (uma por competência) | vigência, parcela, baixa/dispensa/desfazer | 090–095 |
| `Income` | — | ativo/inativo | 105 |
| `Debt` | — | pagas ≤ total, quitada, conversão | 106–108 |
| `Goal` | `GoalDeposit` | depósito incrementa o guardado | 109 |
| `Card` | — | dias de fechamento e vencimento | 130 |
| `CardPurchase` | — | parcelas 1–48, categoria de despesa | 133 |
| `UserSettings` | — | data do saldo inicial ≤ amanhã | 150, 151 |

**Value objects:** `Money` (centavos), `MonthRef` (competência), `IsoDate`, `Email`, `DayOfMonth`,
`CssColor`, `UserRole`, `UserStatus`.

**Serviços de domínio (funções puras, portadas uma a uma):** `BudgetCalculator` (resumo),
`DebtProjector`, `CardInvoiceCalculator`, `CashflowProjector` (inclui `OverdueBillsFinder` e o
veredito), `CategoryReportBuilder`, `TransactionGrouping`, `BillsCalendar`. Os testes de domínio do
Node (`*.calculator.test.ts`) são portados para `Grana.Domain.Tests` como primeira bateria.

**Erros de domínio:** `ValidationError`, `NotFoundError`, `ConflictError`, `BusinessRuleError`,
`UnauthorizedError`, `ForbiddenError`, `TooManyAttemptsError`. O nome da classe vai para o campo
`error` do envelope, então os nomes são mantidos.

## 4. Contrato e compatibilidade

- O contrato é o da `spec.md` RF-06. Cada endpoint .NET tem um teste de integração e é coberto
  pela suíte de paridade.
- Os tipos TypeScript dos clientes continuam vindo de `packages/shared` (R-08). O risco de divergência
  fica coberto pela suíte de paridade, que valida contra os mesmos formatos.

## 5. Decisões sobre GraphQL e Redis

### GraphQL — **não usar**

- **Por quê:** os dois clientes (site e app) consomem o REST atual, e a paridade exige o mesmo
  contrato. Nenhum fluxo hoje precisa de consultas compostas que o REST não resolva.
- **Critério para reabrir:** um cliente novo, ou uma tela existente, que precise de **mais de 4
  chamadas** para montar uma visão, ou que gaste mais de 30% do tempo de carregamento em ida e volta
  de rede, medido em produção. Mesmo assim, entraria como endpoint **adicional**, sem tirar o REST.

### Redis — **não usar agora**

- **Por quê:** o único estado compartilhado em memória é o rate limit (R-09). Com **uma réplica** de
  cada serviço e a regra de que cada rota é atendida por um só backend (§6.3), os contadores não se
  dividem. O cache de leitura não se paga com o volume atual.
- **Critério para adotar:** (a) a API .NET precisar de **mais de uma réplica**, ou (b) o p95 de
  `/api/cashflow` passar de 200 ms em produção, ou (c) a correção do RN-162 ⚠️ for aprovada e exigir
  contadores por usuário compartilhados. Nesse caso, Redis na Railway para os contadores do rate limit
  (e, se for o item b, cache do saldo futuro por usuário com invalidação nas escritas).

## 6. Strangler Fig

### 6.1 A fachada

- O `Grana.Api` sobe com YARP e uma rota de *fallback* `/{**catch-all}` → API Node (rede privada da
  Railway). O domínio público da API passa a apontar para ele.
- **Repasse transparente** *(decisão revista na T-006, 2026-10-20)*: a rota que ainda está no Node é
  repassada sem que a fachada aplique borda nenhuma. O Node continua fazendo CORS, cabeçalhos, rate
  limit e erros para ela, exatamente como hoje. A borda .NET (cabeçalhos do helmet, CORS, envelope de
  erro e, no M1, validação, autenticação e rate limit) vale **só para as rotas nativas**.
  *Por que mudou:* aplicar a borda .NET por cima das rotas repassadas exigiria remover e reescrever
  cabeçalhos do Node e deixaria os contadores de rate limit incoerentes. O repasse transparente é
  verificável: a suíte de paridade passou 155/155 contra a fachada.
- O `X-Forwarded-For` é **acrescentado** (não substituído, que é o padrão do YARP). Assim o Node
  continua vendo como cliente o mesmo IP mais à esquerda de hoje (RN-162). `Set-Cookie`, `Cookie` e
  `Authorization` passam intactos (mesmo domínio e mesmo `Path=/api/auth`).
- **Diferença de transição registrada:** com rotas nos dois backends, o rate limit **global**
  (200/min por IP) passa a valer separadamente no Node e no .NET, ou seja, até 2 × 200 durante a
  migração. Os limites por rota (login, cadastro, troca de senha) não mudam, porque cada rota está
  num backend só. Como o global já é burlável (RN-162), o impacto é nulo na prática. Some no M9.

### 6.2 Chave de roteamento por módulo

Configuração `Strangler:Modules:<Módulo> = dotnet | node`, lida a cada requisição a partir de
variável de ambiente. Voltar um módulo para o Node é trocar a variável e reiniciar o serviço
(RNF-04: menos de 5 min). Quando um módulo está em `node`, as rotas dele caem no *fallback*.

### 6.3 Regras de coexistência

1. Uma rota é atendida por **um** backend por vez (sem *dual write*).
2. Rate limits são aplicados por quem atende a rota (ver a diferença de transição do global em §6.1).
3. **Schema congelado** até o fim (§2.2).
4. Tokens, cookies e hashes compatíveis nos dois sentidos (RNF-02).

### 6.4 Ordem dos módulos

A ordem começa pelo mais simples e isolado e termina pelo de maior risco.

| # | Módulo | Rotas | Por que nesta posição | Testes de paridade |
|---|---|---|---|---|
| M0 | **Fundação + fachada** | `/health` (nativo), resto via YARP | Põe a fachada em produção sem mudar nada; prova a borda | 01, 04, 12 (contra a fachada) |
| M1 | Ajustes, entradas fixas, categorias | `/api/settings`, `/api/incomes`, `/api/categories` | CRUD simples; exercita validação, erros, EF e isolamento | 05 (categorias), 07 (entradas), 11 |
| M2 | Lançamentos | `/api/transactions` | Primeiro módulo com listagem, agrupamento e frases | 05 |
| M3 | Dívidas e metas | `/api/debts`, `/api/goals` | Agregados com filhos e projeção simples | 07 |
| M4 | Contas fixas | `/api/bills*` (inclui `/overdue`) | Vigência, baixas e o primeiro pedaço do saldo futuro (atrasos) | 06 |
| M5 | Cartões | `/api/cards*`, `/api/card-purchases/*` | Cálculo de faturas | 09 |
| M6 | Resumo e relatório | `/api/dashboard`, `/api/reports/categories` | Depende de M2, M4 e M5 | 08 |
| M7 | Saldo futuro e simulação | `/api/cashflow*` | O cálculo mais complexo; depende de tudo acima | 10 |
| M8 | Identity | `/api/auth/*`, `/api/admin/users*` | Maior risco: sessões, cookies, rate limits de login, hash | 02, 03, 04 |
| M9 | Desligamento do Node | — | Sem rotas no *fallback*; passa o schema para o .NET | suíte inteira |

**Por que Identity por último:** até lá o Node emite os tokens e o .NET só os valida (R-02). Assim a
parte mais sensível só muda quando todo o resto já está estável.

## 7. Migração e validação de dados

Pela decisão P3 **não há ETL**: Node e .NET leem e gravam as mesmas tabelas. A "migração de dados"
de cada módulo é provar que o .NET lê e grava exatamente como o Node, com quatro verificações.

1. **Compatibilidade de leitura (contagem e amostragem).** Num ambiente de homologação com uma cópia
   do banco de produção, a ferramenta `tools/verificador-paridade` sorteia N usuários (padrão: 50, ou
   todos se houver menos), chama cada `GET` do módulo **direto no Node** e **direto no .NET**, com o
   mesmo token, e compara os JSONs campo a campo. Também confere a contagem de linhas por tabela e por
   usuário antes e depois. **Critério:** 0 diferenças.
2. **Compatibilidade de escrita, .NET → Node.** Testes que gravam pelo .NET e leem pelo Node direto
   (e vice-versa). Eles entram na suíte de paridade como arquivos `*.cruzado.test.ts`, que precisam
   das duas URLs. **Critério:** os registros são lidos de forma idêntica pelos dois lados.
3. **Forma do dado gravado.** Teste de integração que compara a linha gravada pelo .NET com a linha
   gravada pelo Node para a mesma operação: ids UUID v4, `updatedAt` preenchido, datas em UTC,
   enums, `null` × string vazia (RN-081). **Critério:** só ids e instantes podem diferir.
4. **Monitoramento após a troca.** Nas primeiras 48 h do módulo em `dotnet`: taxa de 5xx, contagem
   de 4xx por código e p95, comparados com a semana anterior. **Critério:** nenhum aumento acima de
   10%.

> **D-01 decidida (2026-10-20): cópia anonimizada.** A homologação recebe uma cópia do banco de
> produção com nomes e e-mails trocados e os valores mantidos, para que os cálculos continuem
> comparáveis. O script de anonimização faz parte da T-008. Os campos de texto livre a anonimizar
> (observações, nomes de contas, metas e cartões) e o tratamento de hashes de senha, tokens e IPs da
> auditoria serão listados nela e levados à sua aprovação antes de rodar.

## 8. Rollback

| Situação | Como voltar | Tempo | Testado em |
|---|---|---|---|
| Problema num módulo migrado | `Strangler:Modules:<M>=node` e reiniciar a fachada | < 5 min | T-019, T-029 … T-089 |
| Problema na fachada (M0) | Apontar o domínio público da Railway de volta para o serviço Node | < 5 min | T-007 |
| Dado gravado pelo .NET | Nenhuma ação: o Node lê o que o .NET gravou (§7.2) | — | `*.cruzado.test.ts` |
| Depois do M9 | O serviço Node fica parado, não apagado, por 30 dias, com a imagem da última versão | < 15 min | T-095 |

**Teste de rollback de cada módulo** (obrigatório para concluir o módulo): em homologação, (1) o
módulo em `dotnet` grava dados; (2) troca para `node`; (3) a suíte inteira roda verde contra a
fachada; (4) os dados gravados pelo .NET aparecem iguais pelo Node; (5) volta para `dotnet`.

## 9. Segurança: RN-162 ⚠️ (encontrado nesta fase)

A API Node confia em **todo** o `X-Forwarded-For` (`trustProxy: true`) e usa o valor **mais à
esquerda**, que é o que o cliente envia. Então, em produção, qualquer pessoa pode escapar dos rate
limits mandando um IP falso, **inclusive o limite de tentativas de login por IP**. O bloqueio por
conta (5 falhas → 15 min) continua valendo.

- Pela regra de paridade, o .NET reproduz esse comportamento até você decidir.
- **Recomendo corrigir cedo**, já no M0, para valer nos dois backends. A correção é confiar só no
  último salto (o proxy da Railway). Ela muda a forma como a suíte de paridade varia o IP: a API de
  teste passaria a rodar com uma configuração que confia no `X-Forwarded-For`, como ambiente de
  teste. **Precisa da sua aprovação (D-02).**

## 10. Ambientes e deploy (Railway)

| Ambiente | Serviços | Banco |
|---|---|---|
| Local | `docker compose` (Postgres) + Node + .NET | `grana_dev` / `grana_test` |
| CI | GitHub Actions: build, testes .NET, suíte de paridade contra Node **e** contra a fachada .NET | Postgres de serviço |
| Homologação | Fachada .NET + Node na rede privada | Cópia do banco de produção (D-01) |
| Produção | Fachada .NET (domínio público) + Node (privado) | Banco atual |

- Variáveis com os **mesmos nomes** do Node (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `CORS_ORIGINS`,
  `COOKIE_DOMAIN`, `RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_MAX`, `ACCESS_TOKEN_TTL`,
  `REFRESH_TOKEN_TTL_DAYS`…), mais `NODE_UPSTREAM_URL` e `Strangler__Modules__*`.
- Build por Dockerfile multi-stage (imagem `aspnet:10.0` com *chiseled* ou Alpine); healthcheck
  `/health`; graceful shutdown no SIGTERM.

## 11. Estratégia de testes

| Nível | Onde | O que garante |
|---|---|---|
| Unidade de domínio | `Grana.Domain.Tests` | Cálculos, invariantes, `JsMath`, `JsDate`, `MoneyFormatter`, `ZodCompat` |
| Casos de uso | `Grana.Application.Tests` | Orquestração com portas falsas |
| Integração | `Grana.Api.IntegrationTests` | Pipeline real + EF + Postgres (Testcontainers) |
| Arquitetura | `Grana.ArchitectureTests` | Regras de dependência e nomes |
| **Paridade** | `tests/paridade` | **Critério de aceite**: igual ao Node |
| Cruzados | `tests/paridade/*.cruzado.test.ts` | Escrita num backend, leitura no outro |

Cobertura mínima: ≥ 90% de linhas em Domain e Application e ≥ 80% no total (coverlet no CI).

## 12. Riscos (da `analise.md` §8) e onde são tratados

| Risco | Tratamento | Onde |
|---|---|---|
| R-01 hash | Isopoh PHC + teste com hash do Node | T-081, suíte 12 |
| R-02 coexistência | Mesmo segredo, emissão sem `iss`, cookie no mesmo domínio, fachada | M0, suíte 01/02 |
| R-03 arredondamento | `JsMath.Round` | T-003, suíte 08 |
| R-04 datas | Conversor de 3 ms, `JsDate`, `IClock` UTC | T-003 |
| R-05 moeda | `MoneyFormatter` | T-003 |
| R-06 ordenação | `ORDER BY` no SQL, com a mesma collation | cada módulo |
| R-07 validação | `ZodCompat` | T-004 |
| R-08 contrato | Suíte de paridade | sempre |
| R-09 rate limit | §5 e §6.3 | M0, M8 |
| R-10 dono do schema | Schema congelado; EF sem migrations até o M9 | M9 |
| R-11 mapeamento | Mapeamento explícito + teste de leitura de todas as tabelas | T-009 |
| R-12 erros do framework | Caracterizar JSON malformado e content-type; diferenças restantes registradas | T-004, suíte 01 |
| R-13 SDK | Instalar o .NET 10 SDK | T-001 |
| **RN-161, RN-162** | Reproduzidos; correção do RN-162 sob decisão (D-02) | T-005, T-00A |

## 13. Fluxo de trabalho dos agentes

Para cada tarefa de código: **Teste → Dev → Teste → Revisor → UI/UX (só se houver tela)**.

1. **Teste:** escreve ou confirma os testes da tarefa (unidade/integração) a partir da `spec.md` e
   aponta quais testes de paridade precisam passar. Só mexe em arquivos de teste.
2. **Dev:** implementa até os testes passarem. É o único que mexe em código de produção.
3. **Teste:** roda tudo, mede a cobertura e valida a paridade.
4. **Revisor:** confere contra a `spec.md`, este plano e os padrões, e emite **APROVADO** ou
   **REPROVADO** com os pontos bloqueantes.
5. Uma reprovação volta para o Dev. **No máximo 3 ciclos**; depois disso, paro e consulto você.

Nesta migração não há tela nova. O UI/UX só entra se algum item ⚠️ aprovado mexer na experiência do
site ou do app.
