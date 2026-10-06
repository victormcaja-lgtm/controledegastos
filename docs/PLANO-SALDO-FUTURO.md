# Plano de execução — Saldo futuro

Inspirado no fluxo do "App do Breno": em vez de olhar cada mês como uma caixa isolada, o Grana passa
a mostrar um **saldo contínuo, dia a dia**, com o passado real e o futuro projetado. Duas regras
pedidas saem disso naturalmente:

- **Se não gastar, sobra para o próximo mês** — o saldo de 31/10 é o ponto de partida de 01/11.
- **Se não pagar uma conta fixa, ela acumula** — conta vencida e sem baixa é projetada como saída
  pendente até ser paga.

> **Status:** fases 1 a 6 implementadas num único PR (um commit para a API, um para o front),
> a pedido, para ir direto para produção. A tela de Dívidas continua existindo, agora com
> "mover para Contas"; a remoção da tabela `debts` segue para um PR posterior, como previsto.

---

## 1. Regras de negócio

| Regra              | Definição                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saldo inicial      | Informado pelo usuário uma vez: valor + data (`openingBalanceCents`, `openingDate`).                                                                          |
| Saldo do dia       | `saldo(d) = saldo(d−1) + entradas(d) − saídas(d)`.                                                                                                            |
| Passado (≤ hoje)   | Só o que foi lançado: transações + baixas de contas fixas (`BillPayment.paidAt`).                                                                             |
| Futuro (> hoje)    | Entradas fixas no `receiptDay`, contas fixas no `dueDay`, faturas no vencimento, gasto médio diário.                                                          |
| Conta atrasada     | Conta em vigor numa competência ≥ `openingDate`, com vencimento já passado e sem `BillPayment`: entra como saída **hoje**, com rótulo "atrasada desde dd/mm". |
| Perdoar conta      | `BillPayment` com `status = WAIVED`: sai da projeção e não mexe no saldo.                                                                                     |
| Gasto médio diário | `dailyBudgetCents` se o usuário definir; senão média de gasto variável dos últimos 90 dias.                                                                   |
| Parcelas           | Parcela atrasada continua sendo a mesma parcela ("3/10 de set") — o prazo não estica.                                                                         |

**Sem dupla contagem:** hoje dar baixa numa conta fixa grava só um `BillPayment`, não cria
`Transaction` (o campo `Transaction.billId` existe mas nenhum caso de uso o preenche). A projeção
soma `Transaction` + `BillPayment`; se no futuro a baixa passar a gerar lançamento, um dos dois
precisa ser excluído da soma.

---

## 2. Estratégia de git

- Uma fase = **um PR** contra `main`, mergeado antes da próxima começar. Cada PR deixa o app
  funcionando sozinho (nenhuma tela quebrada no meio do caminho).
- Branch por fase: `feat/saldo-futuro-<n>-<tema>` (ou o branch de desenvolvimento designado).
- Commits pequenos, na ordem **shared → domínio + testes → infra/migração → caso de uso/rota →
  web**. Mensagens no padrão já usado no repo (`feat:`, `fix:`, `docs:`, `test:`).
- Toda migração Prisma é **aditiva** (colunas com default/nullable, tabelas novas). Nada é removido
  até a fase final, então dá para reverter um PR sem perder dados.
- Antes de cada push: `npm run build:shared && npm run typecheck && npm run lint && npm test`.

---

## 2.1 Indo para produção

Produção é o `main` (veja `docs/DEPLOY.md`): o merge dispara o deploy da API na **Railway**, que
roda `prisma migrate deploy` antes de subir o servidor (`npm run release`), e o deploy do front na
**Vercel**. Cada PR passa por este roteiro:

**Antes do merge**

1. CI verde no PR (typecheck, testes com Postgres real, build).
2. Testar no **preview da Vercel** do PR apontando para a API de staging (branch `develop`, se
   houver) — nunca para a API de produção com código de front novo e API antiga.
3. Se o PR tem migração: conferir o SQL gerado em `apps/api/prisma/migrations/*/migration.sql`
   (só `CREATE TABLE`, `ADD COLUMN ... DEFAULT`, `CREATE TYPE`) e fazer **backup do Postgres** na
   Railway (aba Backups) antes de mergear.

**Compatibilidade entre API e front**

- A Railway e a Vercel não terminam o deploy ao mesmo tempo. Por isso a **API sempre sai na
  frente**: rotas novas são aditivas e as antigas (`/dashboard`, `/bills`, `/debts`) continuam
  respondendo igual até a fase 6.
- O front novo fica atrás de uma **feature flag** `VITE_FEATURE_SALDO_FUTURO` (variável da Vercel).
  Fases 1–5 vão para produção com a flag `false` em Production e `true` em Preview; liga-se em
  produção quando a fase 2 estiver validada. Desligar = trocar a variável e fazer redeploy, sem
  reverter código.

**Depois do merge (smoke test em produção, ~5 min)**

1. Railway: deploy verde, log com a migração aplicada, `GET /health` responde 200.
2. Vercel: deploy verde; abrir o app, logar, conferir Home, Contas e um lançamento.
3. Fase com rota nova: `GET /cashflow` com um usuário de teste responde e o saldo bate com o
   esperado.

**Se der errado**

- Bug só no front → _Instant Rollback_ da Vercel para o deploy anterior (ou desligar a flag).
- Bug na API → _Redeploy_ do deploy anterior na Railway. Como as migrações são aditivas, o código
  antigo continua funcionando com o schema novo — **não** reverter migração em produção.
- Dado corrompido → restaurar o backup feito antes do merge.

---

## 3. Fases

### Fase 1 — Motor de projeção + saldo inicial · PR 1

O núcleo. Depois dela a sobra já vira e a conta atrasada já acumula — na API.

1. **shared** — `packages/shared/src/contracts/cashflow.contract.ts`
   - `cashflowQuerySchema` (`from`, `to` ISO, intervalo máx. 400 dias).
   - `cashflowDaySchema` (`date`, `inCents`, `outCents`, `balanceCents`, `projected`, `events[]`).
   - `cashflowSchema` (`days`, `todayBalanceCents`, `endOfMonthCents`, `lowest {date, cents}`,
     `firstNegativeDate | null`, `overdueBills[]`).
   - `settingsSchema` ganha `openingBalanceCents`, `openingDate`, `dailyBudgetCents | null`.
2. **domínio** — `apps/api/src/modules/finance/domain/cashflow.calculator.ts`
   - Função pura `projectCashFlow(input, from, to)`, no mesmo estilo de `calculateBudget`.
   - `findOverdueBills(bills, payments, openingDate, today)`.
   - `cashflow.calculator.test.ts`: saldo encadeado entre meses, conta atrasada aparecendo hoje,
     baixa atrasada saindo da projeção, `WAIVED`, conta com prazo terminando, dia 31 em fevereiro,
     média diária só nos dias futuros.
3. **infra / migração** `add_cashflow`
   - `UserSettings`: `openingBalanceCents Int @default(0)`, `openingDate DateTime? @db.Date`,
     `dailyBudgetCents Int?`.
   - `BillPayment`: enum `BillPaymentStatus { PAID WAIVED }`, `status @default(PAID)`.
   - Repositório: `paymentsBetween(userId, from, to)`, `transactionsBetween(userId, from, to)`.
4. **caso de uso + rota** — `GetCashflowUseCase`; `GET /cashflow?from&to`; `PATCH /bills/:id/payment`
   aceita `waived: true`.
5. **testes e2e** (`apps/api/tests/api.e2e.test.ts`): saldo inicial → lançamento → conta não paga
   no mês anterior aparece em `overdueBills`.

**Pronto quando:** testes de domínio e e2e verdes; endpoint responde em < 200 ms para 90 dias.

### Fase 2 — Nova Home e onboarding do saldo · PR 2

1. Onboarding: se `openingDate` é nulo, a Home pede "Quanto você tem hoje na conta?".
2. Cartão principal: **Saldo hoje**, **Fim do mês**, **Menor saldo em 60 dias (data)**.
3. `organisms/BalanceChart.tsx` — linha do saldo: trecho real sólido, projetado tracejado, ponto
   mais baixo marcado, área abaixo de zero em `clay`.
4. Bloco "Em atraso" acima de "Vence em breve", com **Pagar** e **Não vou pagar**.
5. Ajustes: editar saldo inicial e gasto médio diário.
6. Hooks: `useCashflow(from, to)` em `application/hooks/queries.ts`; invalidar após lançar, dar
   baixa ou editar ajustes.

**Pronto quando:** fluxo completo no navegador (desktop e mobile), sem regressão nas outras telas.

### Fase 3 — Diário · PR 3

1. `pages/DiaryPage.tsx` substitui a Lista na navegação (a rota antiga redireciona).
2. Um bloco por dia: lançamentos + saldo ao fim do dia; dias futuros em cinza com os eventos
   previstos (salário, contas, média diária).
3. Rolagem infinita para trás (real) e para frente (projeção); abre posicionado em hoje.
4. Atalho de lançamento rápido no topo (reaproveita `Keypad`).

### Fase 4 — "Posso comprar?" · PR 4

1. `POST /cashflow/simulate` — recebe `{ amountCents, installments, date, method }`, devolve a
   projeção antes/depois (reusa `projectCashFlow` com um evento extra, sem gravar nada).
2. Tela/modal com o gráfico sobreposto e a resposta em uma frase: "Seu menor saldo cai de R$ 820
   para R$ 120 em 05/11" ou "Fica negativo em 03/12".
3. Botão "Confirmar compra" já cria o lançamento.

### Fase 5 — Cartões de crédito · PR 5

1. Migração `add_cards`: `Card` (nome, `closingDay`, `dueDay`, `limitCents`, `active`) e
   `CardPurchase` (cartão, categoria, valor total, parcelas, data, nota).
2. Domínio: `invoiceFor(card, purchases, month)` — compra após o fechamento cai na fatura seguinte;
   parcelas distribuídas nas faturas futuras. Testes de virada de fechamento.
3. Projeção: a fatura entra como **uma saída no vencimento**; as compras não mexem no saldo no dia.
4. Telas: lista de cartões, fatura atual e próximas, compra parcelada no lançamento.
5. Dívidas: oferecer migração das dívidas atuais para "compra parcelada"; a tela de Dívidas fica
   até a fase 6.

### Fase 6 — Resultado do mês e limpeza · PR 6

1. Resultado do mês: entradas, saídas, lucro/prejuízo, quanto foi para metas.
2. "Guardar sobra": transferir parte do saldo para uma meta (depósito sai do saldo projetado).
3. Remover a tela de Dívidas, o card antigo "Deve sobrar no fim do mês" e a feature flag;
   atualizar `docs/ARQUITETURA.md`.
4. Remoções de schema (ex.: tabela `debts`) vão num **PR separado e posterior**, só depois que os
   dados foram migrados e um deploy estável rodou sem usá-los.

---

## 4. Riscos e decisões

| Risco                                             | Mitigação                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Usuários antigos sem saldo inicial                | Onboarding obrigatório na Home; até lá a Home antiga continua.                                                       |
| Contas de antes de usar o app virarem "atrasadas" | Atraso só conta a partir de `openingDate`.                                                                           |
| Editar lançamento antigo muda o saldo de hoje     | Esperado (é o saldo real); mostrar no Diário.                                                                        |
| Performance da projeção                           | Cálculo em memória sobre o intervalo pedido; índices `[userId, occurredOn]` e `[userId, referenceMonth]` já existem. |
| Fuso horário                                      | Toda data em UTC como o resto do app; "hoje" calculado no servidor.                                                  |

## 5. Ordem resumida

```
PR1 motor + saldo inicial  →  PR2 Home  →  PR3 Diário  →  PR4 Posso comprar?
                                                      →  PR5 Cartões  →  PR6 Resultado + limpeza
```
