# Verificador de paridade (T-008)

Compara a API Node e a API .NET **sobre dados reais** da homologação (plano.md §7.1). A suíte de
paridade (`tests/paridade`) prova o comportamento com dados montados pelo teste. O verificador prova
que os dois backends leem do mesmo jeito o que já está gravado: uma amostra de usuários, todos os
`GET` de cada módulo e o JSON comparado campo a campo.

- **Só leitura:** faz apenas `GET` na API e `SELECT` no banco. Pode rodar quantas vezes for preciso.
- **Mesmo token nos dois lados:** emite um access token para cada usuário da amostra com o
  `JWT_ACCESS_SECRET` (R-02). Ninguém precisa saber a senha de ninguém.
- **Critério:** 0 diferenças nas respostas (status e corpo, sem normalização: ordem de lista,
  `null` × ausente e número × texto contam) e nenhuma contagem de linhas alterada entre o antes e o
  depois (por tabela e por usuário da amostra).

## Rodar

```bash
VERIFICADOR_URL_NODE=http://api-node.railway.internal:3333 \
VERIFICADOR_URL_DOTNET=http://api-dotnet.railway.internal:8080 \
VERIFICADOR_DATABASE_URL=postgresql://... \
VERIFICADOR_JWT_SECRET=... \
npm run verificar -w @grana/verificador-paridade
```

| Variável | Padrão | Para quê |
|---|---|---|
| `VERIFICADOR_URL_NODE` | obrigatória | API Node chamada **direto** |
| `VERIFICADOR_URL_DOTNET` | obrigatória | API .NET direto (ou a fachada, enquanto o módulo está em `node`) |
| `VERIFICADOR_DATABASE_URL` | obrigatória | O banco que as duas APIs usam (só leitura) |
| `VERIFICADOR_JWT_SECRET` | obrigatória | O mesmo `JWT_ACCESS_SECRET` das duas APIs |
| `VERIFICADOR_AMOSTRA` | `50` | Quantos usuários **ativos** sortear (todos, se houver menos) |
| `VERIFICADOR_SEMENTE` | aleatória | Repete a mesma amostra (a semente usada aparece na saída) |
| `VERIFICADOR_MODULOS` | todos | Ex.: `Settings,Incomes,Categories` (nomes de `Strangler:Modules:*`) |
| `VERIFICADOR_HOJE` | data UTC atual | Valor de `today`, do mês atual e dos intervalos do saldo futuro |
| `VERIFICADOR_CONCORRENCIA` | `4` | Pares de chamadas em paralelo |
| `VERIFICADOR_RELATORIO` | — | Grava o relatório completo em JSON |

Saída: `0` = 0 diferenças; `1` = há diferenças; `2` = configuração inválida ou erro.

## O que é comparado

Por usuário: `/api/auth/me`, ajustes, entradas, categorias (com e sem arquivadas), lançamentos (sem
filtro, página 2, mês atual, anterior e os 2 meses mais recentes com dados, só entradas), dívidas,
metas, contas fixas (mês anterior, atual e seguinte, e atrasadas), cartões e a fatura de cada um
(sem mês, atual e seguinte), resumo e relatório (mês atual e anterior) e saldo futuro (90 dias à
frente e ±30 dias). Uma vez, com o token do primeiro administrador ativo: a listagem de
`/api/admin/users` e o detalhe de cada usuário da amostra.

O resumo (`/api/dashboard`) usa o relógio do servidor para "hoje". As duas chamadas de cada par saem
em sequência, então só uma execução que atravesse a meia-noite UTC pode acusar diferença por isso.
Nesse caso, rode de novo com a mesma semente.

## Testes

```bash
npm test -w @grana/verificador-paridade
```
