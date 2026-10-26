# Tarefas — Migração da API Grana para .NET 10

> **Fase 3 — Tarefas.** Entregável do agente Arquiteto. Executadas na Fase 4, na ordem abaixo.
> Cada tarefa de código segue o fluxo **Teste → Dev → Teste → Revisor** (`plano.md` §13), com no
> máximo 3 reprovações antes de parar e consultar você.

**Legenda:** RF = requisito da `spec.md` · RN = regra da `analise.md` · Pq = arquivo da suíte de
paridade (`tests/paridade/specs/NN`) · ✋ = precisa de aprovação ou ação sua antes de começar.

## Decisões pendentes (bloqueiam as tarefas marcadas)

| ID | Decisão | Bloqueia | Recomendação |
|---|---|---|---|
| D-01 ✅ | Cópia do banco de produção para a homologação: integral e restrita, ou anonimizada (LGPD) | T-008 e as validações de dados de cada módulo | **Decidido (2026-10-20): anonimizada** |
| D-02 ✅ | Corrigir já o RN-162 (rate limit burlável pelo `X-Forwarded-For`), nos dois backends | T-00A | **Decidido (2026-10-20): corrigir no M0** |
| D-03 ✅ | Criar os serviços novos na Railway (fachada .NET e homologação), com custo adicional | T-007, T-008 | **Autorizado (2026-10-20)** |
| D-04 ✋ | Momento de apontar o domínio público para a fachada (janela de baixo uso) | T-007 | Combinar data |
| D-05 | P1: motivação da migração (ajuda a priorizar, não bloqueia) | — | — |
| D-06 ✅ | Datas do **ano 0000** (`0000-01-01`): o Node aceita; o `DateOnly` do .NET começa no ano 1. Única diferença irreprodutível achada até aqui | Nada (caso sem uso real) | **Decidido (2026-10-20): responder 400 "Data inexistente."** (já implementado na validação .NET) |

## M0 — Fundação e fachada

| ID | Tarefa | Rastreio | Pronto quando |
|---|---|---|---|
| T-001 | Instalar o .NET 10 SDK na máquina e no CI | R-13 | `dotnet --version` 10.x local e no CI |
| T-002 | Criar a solução `apps/api-dotnet` (4 projetos + 4 de teste), regras de dependência no `Grana.ArchitectureTests`, CI (build, testes, cobertura) | plano §2.1, RNF-06 | CI verde; teste de arquitetura falha se o Domain referenciar Infrastructure |
| T-003 | Utilitários de compatibilidade: `JsMath.Round`, `JsDate.Parse`, `MoneyFormatter`, conversor JSON de data-hora (3 ms, `Z`), `MonthRef`, `IsoDate` | RF-01.8–01.11, R-03–R-05 | Testes unitários com os mesmos valores esperados do `apps/mobile/test/core_test.dart` e de `packages/shared` |
| T-004 | `ZodCompat`: regras, mensagens, `path`, acúmulo, mensagens padrão em inglês; parse de JSON malformado | RF-01.6, R-07, R-12 | Unidade para cada regra usada nos contratos; casos de Pq 01 |
| T-005 | Pipeline HTTP: envelope de erro, 404 de rota, `requestId`, limite de corpo, logs sem segredo, CORS (inclui 500 de origem negada), cabeçalhos de segurança, `ForwardedHeaders`, rate limit global e por rota, `/health` | RF-01.1–01.5, RF-02 | Pq 01, 04 e 12 verdes **contra a fachada** |
| T-006 | Fachada YARP: *fallback* para o Node, transformações (remove cabeçalhos duplicados, preserva cookies e `X-Forwarded-For`), chave `Strangler:Modules:*` | plano §6 | Suíte inteira (155) verde contra a fachada com todos os módulos em `node` |
| T-007 ✋ | Deploy da fachada na Railway (produção) e virada do domínio público (D-03, D-04); teste do rollback de domínio | RNF-03, RNF-04, plano §8 | Domínio na fachada; suíte de leitura em produção sem escrita; rollback ensaiado e cronometrado |
| T-008 ✋ | Homologação: fachada + Node + cópia do banco (D-01); `tools/verificador-paridade` (comparação Node × .NET por amostragem e contagem) | plano §7 | Verificador roda contra homologação e relata 0 diferenças com tudo em `node` — **Em andamento:** verificador e `tools/homologacao/anonimizar.sql` prontos e testados no banco local; falta aprovar os campos anonimizados (`tools/homologacao/README.md`) e montar os serviços na Railway |
| T-009 | Mapeamento EF Core de **todas** as tabelas (schema congelado) + teste que lê uma linha de cada tabela gravada pelo Node | R-10, R-11 | Teste de integração verde; nenhuma migration gerada |
| T-00A | Corrigir o RN-162 confiando só no último salto, no Node e na fachada; ajustar a suíte | RN-162 | Pq 04 atualizado e verde nos dois backends |

## M1 — Ajustes, entradas fixas, categorias

| ID | Tarefa | Rastreio | Pronto quando |
|---|---|---|---|
| T-011 | Domínio: `UserSettings`, `Income`, `Category` (+ paleta, sistema × personalizada) | RN-070–074, 105, 150–153 | Unidade ≥ 90% — **Feita** (100% nas classes novas) |
| T-012 | Casos de uso e endpoints de `/api/settings`, `/api/incomes`, `/api/categories` | RF-05.1, RF-05.4, RF-05.8 | Pq 05 (categorias), 07 (entradas), 11 verdes contra o .NET direto — **Feita:** suíte inteira 155/155 contra a fachada com o M1 em `dotnet` e com tudo em `node`; inclui autenticação, rate limit, parser de corpo e a chave `Strangler__Modules__*` |
| T-013 | Testes cruzados de escrita (.NET grava → Node lê, e vice-versa) para os 3 recursos | RNF-02, plano §7.2 | `m1.cruzado.test.ts` verde — **Feita:** 6 testes nos dois sentidos + forma da linha gravada (§7.3); no CI com `PARITY_NODE_URL`/`PARITY_DOTNET_URL` |
| T-018 | Validação de dados em homologação (contagem + amostragem) | plano §7.1 | 0 diferenças |
| T-019 | Virar `Settings/Incomes/Categories=dotnet`, monitorar 48 h e ensaiar rollback | §6.2, §8 | Suíte inteira verde contra a fachada nos dois estados; métricas dentro do critério |

## M2 — Lançamentos

| ID | Tarefa | Rastreio | Pronto quando |
|---|---|---|---|
| T-021 | Domínio `Transaction` e `TransactionGrouping` (Hoje/Ontem em UTC, `summary`) | RN-080–087 | Unidade ≥ 90% |
| T-022 | Endpoints `/api/transactions` (listar com filtros e paginação, criar, editar, excluir) | RF-05.2 | Pq 05 verde contra o .NET |
| T-023 | Testes cruzados de lançamentos | RNF-02 | Verde |
| T-028 | Validação de dados em homologação | §7.1 | 0 diferenças |
| T-029 | Virar `Transactions=dotnet`, monitorar e ensaiar rollback | §6.2, §8 | Idem T-019 |

## M3 — Dívidas e metas

| ID | Tarefa | Rastreio | Pronto quando |
|---|---|---|---|
| T-031 | Domínio `Debt` + `DebtProjector`; `Goal` + `GoalDeposit` (extrato de 10, destaque único) | RN-106–109 | Unidade ≥ 90% (inclui os casos portados de `budget.calculator.test.ts`) |
| T-032 | Endpoints `/api/debts` (inclui `/convert`, que cria conta fixa) e `/api/goals` | RF-05.4 | Pq 07 verde contra o .NET |
| T-033 | Testes cruzados | RNF-02 | Verde |
| T-038 | Validação de dados | §7.1 | 0 diferenças |
| T-039 | Virar `Debts/Goals=dotnet`, monitorar e ensaiar rollback | §6.2, §8 | Idem T-019 |

> Observação: `/convert` grava em `bills`. Enquanto o M4 estiver no Node, a conta criada pelo .NET
> é lida pelo Node, coberta pelo teste cruzado T-033.

## M4 — Contas fixas

| ID | Tarefa | Rastreio | Pronto quando |
|---|---|---|---|
| T-041 | Domínio `Bill` + `BillPayment` (vigência, parcela, baixa/dispensa/desfazer), `BillsCalendar`, `OverdueBillsFinder` | RN-090–101 | Unidade ≥ 90% (inclui os casos de `findOverdueBills`) |
| T-042 | Endpoints `/api/bills`, `/api/bills/overdue`, `/api/bills/:id/payment` | RF-05.3 | Pq 06 verde contra o .NET |
| T-043 | Testes cruzados | RNF-02 | Verde |
| T-048 | Validação de dados | §7.1 | 0 diferenças |
| T-049 | Virar `Bills=dotnet`, monitorar e ensaiar rollback | §6.2, §8 | Idem T-019 |

## M5 — Cartões

| ID | Tarefa | Rastreio | Pronto quando |
|---|---|---|---|
| T-051 | Domínio `Card`, `CardPurchase`, `CardInvoiceCalculator` | RN-130–137 | Unidade ≥ 90% (inclui `card.calculator.test.ts`) |
| T-052 | Endpoints `/api/cards*` e `/api/card-purchases/:id` | RF-05.6 | Pq 09 verde contra o .NET |
| T-053 | Testes cruzados | RNF-02 | Verde |
| T-058 | Validação de dados | §7.1 | 0 diferenças |
| T-059 | Virar `Cards=dotnet`, monitorar e ensaiar rollback | §6.2, §8 | Idem T-019 |

## M6 — Resumo do mês e relatório

| ID | Tarefa | Rastreio | Pronto quando |
|---|---|---|---|
| T-061 | `BudgetCalculator` e `CategoryReportBuilder` (frases, barras, semanas, média de meses futuros) | RN-110–117 | Unidade ≥ 90% (inclui `budget.calculator.test.ts`) |
| T-062 | Endpoints `/api/dashboard` e `/api/reports/categories` | RF-05.5 | Pq 08 verde contra o .NET |
| T-068 | Validação de dados (só leitura) | §7.1 | 0 diferenças |
| T-069 | Virar `Dashboard=dotnet`, monitorar e ensaiar rollback | §6.2, §8 | Idem T-019 |

## M7 — Saldo futuro e "Posso comprar?"

| ID | Tarefa | Rastreio | Pronto quando |
|---|---|---|---|
| T-071 | `CashflowProjector` (eventos e ordem, saldo de hoje, menor saldo, resumo mensal, média diária) e veredito da simulação | RN-140–149 | Unidade ≥ 90% (inclui `cashflow.calculator.test.ts`) |
| T-072 | Endpoints `/api/cashflow` e `/api/cashflow/simulate` | RF-05.7 | Pq 10 verde contra o .NET; p95 de 90 dias < 200 ms (RNF-05) |
| T-078 | Validação de dados (só leitura) | §7.1 | 0 diferenças |
| T-079 | Virar `Cashflow=dotnet`, monitorar e ensaiar rollback | §6.2, §8 | Idem T-019 |

## M8 — Identity (autenticação, sessão, administração)

| ID | Tarefa | Rastreio | Pronto quando |
|---|---|---|---|
| T-081 | Domínio `User`, `Session`, `Email`; hash Argon2id PHC (Isopoh) com *dummy hash*; emissão de JWT sem `iss` e refresh opaco | RN-030–046, R-01, R-02 | Unidade ≥ 90%; teste que verifica um hash gerado pelo Node |
| T-082 | Endpoints `/api/auth/*` (login, cadastro, refresh, logout, me, senha), cookie e rate limits por rota | RF-03 | Pq 02, 04 verdes contra o .NET |
| T-083 | Endpoints `/api/admin/users*` e provisionamento do espaço financeiro | RF-04 | Pq 03 verde contra o .NET |
| T-084 | Testes cruzados de sessão: login no .NET → refresh no Node e vice-versa; hash gravado pelo .NET verificado pelo Node | RNF-02 | Verde |
| T-088 | Validação de dados (usuários, sessões, auditoria) | §7.1 | 0 diferenças |
| T-089 | Virar `Identity=dotnet`, monitorar e ensaiar rollback | §6.2, §8 | Idem T-019 |

## M9 — Desligamento do Node

| ID | Tarefa | Rastreio | Pronto quando |
|---|---|---|---|
| T-091 | Remover o *fallback* do YARP; o `/health` passa a ser só do .NET | plano §6 | Suíte inteira verde sem Node rodando |
| T-092 | Passar o dono do schema para o .NET: migration *baseline* do EF Core igual ao schema atual; desligar o Prisma Migrate | R-10 | `dotnet ef migrations` sem diferença contra o banco de produção |
| T-093 | Suíte de paridade passa a rodar só contra o .NET no CI; job do Node removido | — | CI verde |
| T-094 | Atualizar `README`, `docs/DEPLOY.md`, `docs/ARQUITETURA.md`, `docs/SEGURANCA.md` | — | Revisão aprovada |
| T-095 | Serviço Node parado (não apagado) por 30 dias; rollback do desligamento ensaiado | plano §8 | Ensaio cronometrado < 15 min |
| T-096 ✋ | Remover `apps/api` do repositório (depois dos 30 dias) | — | Sua aprovação |

## Depois da paridade (P6)

Para cada item ⚠️ (22 da `analise.md` §5, mais o RN-161 e o RN-162), você decide **manter** ou
**corrigir**. Cada correção aprovada vira uma tarefa própria: muda o teste de paridade primeiro e o
código .NET depois. A partir daí, o Node já não existe.
