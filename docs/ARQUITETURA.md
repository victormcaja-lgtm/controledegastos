# Arquitetura

## Por que monorepo

Frontend e backend do Grana falam a mesma linguagem: "competência", "lançamento", "conta fixa",
"centavos". Manter isso em dois repositórios significa duplicar tipos e descobrir a divergência em
produção.

Com `packages/shared`, o **mesmo schema Zod** valida a requisição no Fastify e o formulário no
React. Mudar um campo quebra o `tsc` dos dois lados, no seu terminal, antes do commit.

```
grana/
├── package.json           # workspaces: packages/*, apps/*
├── tsconfig.base.json     # regras de TS herdadas por todos
├── packages/shared/       # @grana/shared — contratos e utilitários puros
└── apps/
    ├── api/               # @grana/api
    └── web/               # @grana/web
```

**Regra de dependência:** `apps/*` dependem de `packages/shared`. `packages/shared` não depende de
ninguém, e `api` e `web` não se importam mutuamente.

---

## Backend: DDD + Clean Architecture

### As quatro camadas

```
┌─────────────────────────────────────────────┐
│  http/         rotas Fastify                │  traduz HTTP ↔ caso de uso
├─────────────────────────────────────────────┤
│  application/  casos de uso                 │  orquestra; sem HTTP, sem SQL
├─────────────────────────────────────────────┤
│  domain/       entidades, VOs, serviços     │  regra pura; não importa NADA externo
├─────────────────────────────────────────────┤
│  infra/        Prisma, Argon2, JWT          │  implementa as portas do domínio
└─────────────────────────────────────────────┘
              dependência aponta para dentro ↑
```

O domínio declara **o que** precisa (interfaces em `domain/ports.ts`); a infraestrutura decide
**como**. É isso que permite testar `calculateBudget` sem banco e trocar Prisma sem tocar em regra.

### Contextos delimitados

**Identity** — usuários, sessões, perfis, auditoria.
**Finance** — categorias, lançamentos, contas fixas, entradas, dívidas, metas, relatórios.

Eles não se importam diretamente. Quando o administrador cria um usuário, Identity chama:

```ts
// identity/domain/ports.ts — Identity declara a necessidade
export interface UserWorkspaceProvisioner {
  provision(userId: string, options: { withDefaultCategories: boolean }): Promise<void>;
}
```

E quem implementa é o Finance (`finance/infra/prisma-workspace-provisioner.ts`). O módulo de
usuários nunca precisa saber o que é uma categoria.

### Composition root

`src/container.ts` é o **único** arquivo que conhece implementações concretas:

```ts
const userRepository = new PrismaUserRepository(prisma);
const hasher = new Argon2PasswordHasher();

return {
  auth: {
    authenticate: new AuthenticateUserUseCase(userRepository, refreshTokens, hasher, tokens, audit),
    // …
  },
};
```

Injeção manual, sem framework de DI: ~100 linhas explícitas, sem mágica de decorator e verificadas
pelo TypeScript em tempo de compilação.

### O núcleo do domínio

`finance/domain/budget.calculator.ts` é o pedaço mais valioso do sistema — o cálculo que produz o
número grande da tela inicial. Tudo ali é **função pura**: entra dado bruto, sai o resumo. Por
isso é o mais fácil de testar e o mais difícil de quebrar por acidente.

Duas regras que merecem destaque:

- **Mês corrente e passado** usam o realizado. **Mês futuro** usa projeção (contas fixas + média
  histórica de gasto variável).
- **Dinheiro é sempre inteiro em centavos.** `Money` é um value object que se recusa a existir com
  valor fracionário. Isso elimina uma classe inteira de bug de arredondamento.

### Contas fixas por competência

O protótipo marcava conta paga com um booleano. Isso não fecha: "aluguel pago" em setembro não diz
nada sobre outubro, e navegar entre meses perderia o histórico.

O modelo separa **`Bill`** (o modelo recorrente: nome, valor, dia de vencimento) de
**`BillPayment`** (a baixa de uma competência específica, com `@@unique([billId, referenceMonth])`).
Marcar como paga é um `upsert` — idempotente, clicar duas vezes não duplica.

---

## Modelo de dados

```
User ──┬── RefreshToken        (sessões, hash SHA-256, rotação)
       ├── AuditLog            (trilha de ações)
       ├── UserSettings        (preferências 1:1)
       ├── Category ──┬── Transaction
       │              └── Bill ── BillPayment   (pagamento por competência)
       ├── Income              (entradas fixas)
       ├── Debt                (parcelamentos)
       └── Goal ── GoalDeposit (metas + extrato)
```

Decisões:

- Todo dado financeiro tem `userId` com **`ON DELETE CASCADE`** — excluir usuário apaga tudo dele.
- `Category` é `ON DELETE RESTRICT` em `Transaction` e `Bill`: categoria em uso **não pode** ser
  apagada, só arquivada. Relatório histórico sem categoria é relatório quebrado.
- Valores em `Int` (centavos). Nunca `Float`, nunca `Decimal` na aplicação.
- `referenceMonth` é sempre o dia 1 do mês em UTC.
- Índices compostos onde a consulta realmente acontece: `[userId, occurredOn]`,
  `[userId, referenceMonth]`, `[userId, kind]`.

---

## Frontend: Atomic Design + DDD leve

### A hierarquia

| Nível         | O que é                              | Exemplos                                             | Pode fazer fetch? |
| ------------- | ------------------------------------ | ---------------------------------------------------- | ----------------- |
| **atoms**     | menor peça com sentido visual        | `Button`, `Input`, `Money`, `Chip`, `Toggle`         | não               |
| **molecules** | dois ou três átomos com um propósito | `FormField`, `StatCard`, `MonthSwitcher`             | não               |
| **organisms** | bloco completo e reconhecível        | `BottomNav`, `Keypad`, `CalendarGrid`, `WeeklyChart` | não               |
| **templates** | esqueleto de página, sem conteúdo    | `PhoneShell`, `AuthLayout`, `AdminLayout`            | não               |
| **pages**     | a tela de verdade                    | `HomePage`, `AddEntryPage`, `UsersPage`              | **sim**           |

A regra que faz o padrão valer alguma coisa: **só `pages` conhecem dados**. Um `StatCard` não sabe
de onde vem o número — o que o torna reutilizável e testável isoladamente.

### Camadas de aplicação e infraestrutura

```
application/
  auth/auth.store.ts        estado de SESSÃO (Zustand) — a única coisa realmente global
  hooks/queries.ts          estado de SERVIDOR (TanStack Query) — cache e invalidação
  month/useMonth.ts         competência selecionada, guardada na URL
  toast/ToastProvider.tsx   avisos efêmeros (contexto, não store)

infra/http/
  api-client.ts             fetch, token em memória, refresh automático
  grana.gateway.ts          a ÚNICA camada que conhece as URLs da API
```

**Separar estado de sessão de estado de servidor** é a decisão que evita cache desatualizado.
Sessão vai para o Zustand (é pequena e global); tudo o que vem da API vive no TanStack Query, com
invalidação precisa por chave.

**A competência na URL** (`?mes=2026-09`) em vez de estado local: o usuário pode compartilhar um
mês específico, o botão "voltar" do navegador funciona, e a seleção sobrevive a um F5.

### Renovação de sessão

Quando um request devolve 401, o cliente tenta **um** refresh e repete a chamada. Requests
concorrentes compartilham a mesma promise — cinco telas carregando ao mesmo tempo não disparam
cinco rotações. Se o refresh falhar, a sessão cai e o roteador manda para o login.

---

## Testes

| Nível                 | Onde                           | O que cobre                                                 |
| --------------------- | ------------------------------ | ----------------------------------------------------------- |
| **Unidade (domínio)** | `apps/api/src/**/*.test.ts`    | `calculateBudget`, `projectDebts` — sem banco, sem HTTP     |
| **Integração (API)**  | `apps/api/tests/*.test.ts`     | a aplicação inteira via `app.inject()` contra Postgres real |
| **Unidade (front)**   | `apps/web/src/**/*.test.ts(x)` | cliente HTTP (refresh, erros) e componentes                 |

A suíte de integração cobre os pontos onde bug custa caro: rotação de refresh token com detecção de
reuso, isolamento entre usuários, bloqueio da área administrativa, pagamento por competência e as
invariantes do último administrador.

---

## Convenções de código

- **Português** em nomes de domínio, mensagens de erro e comentários; **inglês** em identificadores
  técnicos (`userId`, `amountCents`). É o vocabulário que a equipe realmente usa.
- **Comentário explica o _porquê_**, nunca o _o quê_. Se o código precisa de comentário para dizer
  o que faz, o código é que precisa melhorar.
- **Funções pequenas, nomes honestos.** `assertLastAdminIsPreserved` diz exatamente o que garante.
- **Sem `any`.** `strict`, `noUncheckedIndexedAccess` e `noUnusedLocals` ligados no
  `tsconfig.base.json`.
- **Erros de domínio, não de HTTP**, dentro da aplicação. Um único handler traduz para status code.
