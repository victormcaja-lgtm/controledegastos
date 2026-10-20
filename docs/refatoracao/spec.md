# Especificação — API Grana em .NET

> **Fase 3 — Especificação.** Entregável do agente Arquiteto.
> Base: `analise.md` (RN-001 a RN-161, decisões P2–P6 em §10.1, achados em §11) e a suíte
> `tests/paridade` (154 testes). Data: 2026-10-20.

## 1. Objetivo e escopo

Substituir a API Node/Fastify (`apps/api`) por uma API **.NET 10 LTS** em Clean Architecture, com
**comportamento idêntico** ao atual, sem que o site (`apps/web`) nem o app (`apps/mobile`) mudem uma
linha.

**Dentro do escopo:** os 54 endpoints em `/api` e o `/health`; autenticação e sessão; regras de
negócio; formato de respostas e de erros; cabeçalhos HTTP; rate limits; leitura e escrita no mesmo
banco PostgreSQL.

**Fora do escopo:** mudar regra de negócio; corrigir os itens ⚠️ (decisão P6: só depois da
paridade, um a um, com sua aprovação); mudar o schema do banco (P3); mudar o site ou o app (P2);
GraphQL e Redis (ver `plano.md` §5).

### 1.1 A regra que vale acima de todas

> **O sistema novo faz exatamente o que o atual faz.** O critério objetivo é a suíte
> `tests/paridade`: ela passa 100% contra o Node hoje e tem de passar 100%, sem alteração, contra o
> .NET. Se um comportamento não está na suíte e surge uma diferença, o comportamento do Node vence,
> e o teste que faltava é escrito antes da correção.

Melhorias e correções de bug são registradas à parte (§7) e só entram com sua aprovação explícita.

## 2. Rastreabilidade

Cada requisito abaixo aponta para:
- **RN:** a regra de negócio em `analise.md` (com arquivo e linha do código Node de origem);
- **Teste:** o arquivo da suíte de paridade que a fixa (`tests/paridade/specs/NN-*.test.ts`).

A matriz completa RN → teste está em `tests/paridade/README.md`.

## 3. Requisitos funcionais

### RF-01 — Infraestrutura HTTP comum
| ID | Requisito | RN | Teste |
|---|---|---|---|
| RF-01.1 | `GET /health` executa `SELECT 1` e responde `{status:"ok", uptime:<segundos inteiros>, database:"up"}`; sem rate limit. | RN-018 | 01, 04 |
| RF-01.2 | Envelope de erro único `{statusCode, error, code, message, details?, requestId}`; `details` só aparece quando existe. `error` é o nome da classe do erro de domínio (`NotFoundError`, `ConflictError`…). | RN-008–011 | 01 |
| RF-01.3 | Mapeamento de status: VALIDATION 400 (schema) / 422 (domínio), NOT_FOUND 404, CONFLICT 409, BUSINESS_RULE 422, UNAUTHORIZED 401, FORBIDDEN 403, TOO_MANY_ATTEMPTS 429; inesperado 500 com mensagem genérica em produção. | RN-009, 011 | 01, 11 |
| RF-01.4 | Rota inexistente → 404 `ROUTE_NOT_FOUND`, "Rota {MÉTODO} {url} não existe." (url com querystring). | RN-012 | 01 |
| RF-01.5 | `requestId` = `X-Request-Id` recebido ou UUID novo. | RN-014 | 01 |
| RF-01.6 | Validação **antes** da autenticação/autorização; campos desconhecidos descartados; strings com trim chegam aparadas; um campo pode ter várias mensagens, na ordem do validador atual; mensagens padrão (inglês) para campo ausente, tipo errado e enum inválido. | RN-006–008, §11 | 01, 03 |
| RF-01.7 | Mensagens de "não encontrado" no formato `"{Recurso} não encontrado."` (masculino sempre, ⚠️). | RN-013 | 01 |
| RF-01.8 | Datas-hora em ISO 8601 UTC com **3** casas de milissegundo e `Z`; datas puras `AAAA-MM-DD`; competência `AAAA-MM`. | RN-019, R-04 | todos |
| RF-01.9 | Formatação de moeda pt-BR idêntica (`R$ 1.234,56`, negativo com U+2212) em todas as frases montadas pelo servidor. | RN-020, R-05 | 05, 07, 08, 10 |
| RF-01.10 | Arredondamentos idênticos ao `Math.round` do JavaScript (meio para +∞). | R-03 | 07, 08, 10 |
| RF-01.11 | Datas `AAAA-MM-DD` com dia ≤ 31 inexistente são aceitas e "rolam" para o mês seguinte (⚠️); dia > 31 → "Data inexistente.". | RN-004 | 01, 05 |
| RF-01.12 | Isolamento: todo dado financeiro filtrado pelo `sub` do token; recurso de outro usuário → 404. | RN-021 | 01 |

### RF-02 — Borda e segurança
| ID | Requisito | RN | Teste |
|---|---|---|---|
| RF-02.1 | CORS: allowlist `CORS_ORIGINS`, sem Origin passa, credenciais, métodos `GET, POST, PATCH, PUT, DELETE, OPTIONS`, `max-age 86400`; fora de produção aceita `https://*.vercel.app`; **origem negada → 500 genérico** (⚠️ RN-161). | RN-016, 161 | 12 |
| RF-02.2 | Cabeçalhos de segurança em produção equivalentes ao helmet (CSP, HSTS, nosniff, `X-Frame-Options: SAMEORIGIN`); sem `/docs` em produção. | RN-017 | 12 |
| RF-02.3 | IP do cliente: o valor **mais à esquerda** do `X-Forwarded-For` (⚠️ RN-162, burlável pelo cliente). Corpo limitado a 1 MB. | RN-015, 017, 162 | 04 |
| RF-02.4 | Rate limits por IP: global 200/min (`RATE_LIMIT_MAX`), login 8/15 min (`LOGIN_RATE_LIMIT_MAX`), cadastro 5/15 min, troca de senha 5/15 min; `/health` fora. Resposta 429 `{statusCode:429, error:"Error", code:"RATE_LIMITED", message:"Muitas requisições. Tente de novo em {N}s.", requestId}` com `Retry-After`. | RN-015, 038 | 04 |

### RF-03 — Autenticação e sessão (`/api/auth`)
| ID | Requisito | RN | Teste |
|---|---|---|---|
| RF-03.1 | Login: normaliza e-mail; inexistente → mesmo 401 e mesmo custo de CPU; bloqueio 5 falhas/15 min com contador zerado; status checado depois da senha; mensagens exatas; auditoria. | RN-030–035 | 02 |
| RF-03.2 | Sessão: access JWT HS256, payload `{sub,email,role,iat,exp}` **sem `iss`**, 15 min; aceita `iss` ausente ou `grana-api`. Refresh opaco de 64 bytes base64url, SHA-256 hex no banco, 7 dias. | RN-036, §11 | 01, 02 |
| RF-03.3 | Cookie `grana_refresh_token`: `HttpOnly; Path=/api/auth; Expires`; produção `Secure; SameSite=None`; `Domain` = `COOKIE_DOMAIN` se definido. | RN-037 | 02 |
| RF-03.4 | Refresh com rotação, `replacedBy`, detecção de reuso (revoga tudo), expirado, usuário inativo; mensagens exatas; 401 não limpa o cookie. | RN-039 | 02 |
| RF-03.5 | Logout sem autenticação, revoga e limpa o cookie, sempre 204. | RN-040 | 02 |
| RF-03.6 | `GET/PATCH /me` e troca de senha (validações, revoga todas as sessões, limpa cookie, zera troca obrigatória, auditoria). | RN-041, 042 | 02 |
| RF-03.7 | Troca obrigatória **não** imposta pela API (⚠️); perfil e status vêm do token até expirar (⚠️). | RN-043, 044 | 02 |
| RF-03.8 | Autocadastro pendente com espaço financeiro e auditoria sem ator. | RN-050 | 03 |
| RF-03.9 | Compatibilidade de hash: verificar os hashes Argon2id (PHC, m=19456,t=2,p=1) já gravados e gravar novos no mesmo formato. | R-01 | 12 |

### RF-04 — Administração (`/api/admin/users`)
| ID | Requisito | RN | Teste |
|---|---|---|---|
| RF-04.1 | Toda a área exige ADMIN (403 com mensagem exata), depois da validação. | RN-051 | 03 |
| RF-04.2 | Listagem paginada com busca e filtros, ordem `createdAt desc`. | RN-052 | 03 |
| RF-04.3 | Criação com padrões e provisionamento (ajustes + 11 categorias padrão). | RN-053, 062 | 03 |
| RF-04.4 | Edição: própria conta (mensagens com "da a" ⚠️), último admin ativo, suspensão derruba sessões, qualquer status ≠ SUSPENDED ativa (⚠️ PENDING→ACTIVE), auditoria com o corpo. | RN-054–058 | 03 |
| RF-04.5 | Redefinir senha (inclusive a própria) e excluir (cascata, auditoria órfã). | RN-059, 060 | 03 |

### RF-05 — Finanças (`/api/*`)
| ID | Área | RN | Teste |
|---|---|---|---|
| RF-05.1 | Categorias: listagem e ordem, `includeArchived` (⚠️ "false" = true), criação com cor da paleta, edição, arquivamento, exclusão com contagem de uso. | RN-070–074 | 05 |
| RF-05.2 | Lançamentos: criação, edição (arquivada aceita ⚠️), exclusão, listagem com grupos por dia, rótulos Hoje/Ontem em UTC, `summary` da página (⚠️), observação vazia como `""` (⚠️). | RN-080–087 | 05 |
| RF-05.3 | Contas fixas: cadastro, vigência e parcelas, visão do mês e calendário (⚠️ conta antes de criada, dia 31, "pagas" pelo valor da conta), baixa por competência (⚠️ fora da vigência), exclusão, atrasos. | RN-090–101 | 06 |
| RF-05.4 | Entradas fixas, dívidas (projeção e conversão em conta) e metas (destaque, depósitos, extrato de 10). | RN-105–109 | 07 |
| RF-05.5 | Resumo do mês e relatório por categoria com as fórmulas, frases e divergências atuais (⚠️ cartão fora do resumo, dispensada no relatório). | RN-110–117 | 08 |
| RF-05.6 | Cartões, faturas e compras. | RN-130–137 | 09 |
| RF-05.7 | Saldo futuro (eventos, ordem, saldo de hoje, menor saldo, resumo mensal, média diária) e "Posso comprar?" (⚠️ desativar reescreve o passado; baixa antes do saldo inicial some). | RN-140–149 | 10 |
| RF-05.8 | Ajustes (padrões, upsert, data até amanhã UTC) e estouro de INTEGER (⚠️ 500). | RN-150–153, 002 | 11 |

### RF-06 — Contrato
O contrato de cada endpoint (caminho, método, query, corpo, status e formato da resposta) é o de
`packages/shared/src/contracts/*.contract.ts`, como a API Node o aplica hoje, mais o inventário da
`analise.md` §3.3. Os nomes de campo JSON são camelCase; campos `null` são serializados como `null`
(nunca omitidos), exceto `details` no erro.

## 4. Requisitos não funcionais

| ID | Requisito | Critério |
|---|---|---|
| RNF-01 | **Paridade** | `tests/paridade` 100% verde contra o .NET, sem alterar os testes |
| RNF-02 | **Coexistência** | Durante a migração, Node e .NET aceitam os mesmos tokens e cookies e leem/gravam as mesmas linhas; o que um grava, o outro lê (testado nos dois sentidos) |
| RNF-03 | **Sem janela de manutenção** | Cada troca de módulo é uma mudança de roteamento, sem parar o serviço |
| RNF-04 | **Rollback** | Voltar um módulo para o Node em menos de 5 minutos, sem perda de dados |
| RNF-05 | **Desempenho** | p95 de cada endpoint no .NET ≤ p95 do Node para o mesmo volume (medido em homologação); `/api/cashflow` de 90 dias < 200 ms |
| RNF-06 | **Qualidade** | Clean Code, SOLID, DDD e Clean Architecture (regras de dependência verificadas por teste de arquitetura); cobertura ≥ 90% em Domain e Application, ≥ 80% no total |
| RNF-07 | **Segurança** | Mesmas defesas da `SEGURANCA.md` (Argon2id, refresh opaco com hash, rotação com reuso, anti-enumeração, rate limit, CORS, cabeçalhos); segredos só por variável de ambiente |
| RNF-08 | **Observabilidade** | Log estruturado com `requestId`, sem segredos (equivalente ao `redact` atual); health check que toca o banco |
| RNF-09 | **Operação** | Deploy na Railway (P4), mesmas variáveis de ambiente do Node (nomes iguais), graceful shutdown |

## 5. Restrições

- **Banco:** mesmo PostgreSQL e **mesmo schema**, congelado durante a migração (P3, R-10). Nenhuma
  migration nova até o Node ser desligado.
- **Clientes:** o site e o app não mudam (P2). Eles continuam apontando para a mesma URL pública.
- **Comportamento:** nenhuma regra inventada. Em caso de dúvida, pergunta-se antes.
- **Itens ⚠️:** reproduzidos. Corrigir qualquer um exige aprovação explícita (P6).

## 6. Critério de conclusão por módulo

1. Testes de paridade do módulo 100% verdes contra o .NET, e a suíte inteira verde contra a fachada.
2. Cobertura mínima (RNF-06) e revisão **APROVADA** pelo Revisor.
3. Dados validados: compatibilidade de leitura e escrita nos dois sentidos e comparação por
   contagem e por amostragem (`plano.md` §7).
4. Rollback documentado e testado (`plano.md` §8).

## 7. Registro de melhorias e correções (fora do escopo até sua aprovação)

| Item | Origem | Situação |
|---|---|---|
| 22 comportamentos ⚠️ da `analise.md` §5 + RN-161 | Análise e caracterização | Aguardando decisão (P6: depois da paridade) |
| Débitos estruturais da `analise.md` §9 (DIP, mappers na infra, utilitários duplicados, casts) | Análise | Resolvidos **pela própria arquitetura nova**: não mudam nada que o cliente observe |
| Transação nas operações compostas (criar usuário + provisionar, converter dívida, destaque de meta, rotação do refresh) | Análise §9.3 | Proposta: muda o resultado quando há falha no meio; **precisa de aprovação**. Até lá, mesma sequência de passos do Node |
| Limpeza de refresh tokens vencidos, `JWT_REFRESH_SECRET` sem uso, coluna `billId` | Análise §9.6 | Registrados; sem mudança |
| Restringir CORS de previews, imposição de troca de senha no servidor, revalidar perfil no banco | Segurança | Propostas; não entram sem aprovação |
