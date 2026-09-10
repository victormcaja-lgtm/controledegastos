# Segurança

O que está implementado, por que cada decisão foi tomada e o que ainda vale fazer conforme o
sistema cresce.

---

## 1. Senhas

**Argon2id**, com os parâmetros do _OWASP Password Storage Cheat Sheet_: 19 MiB de memória,
2 iterações, paralelismo 1. O pacote é o `@node-rs/argon2` (binding Rust com binário
pré-compilado), que evita ter toolchain C++ no build da Railway.

A política de senha favorece **comprimento** (mínimo 10) sobre símbolos obrigatórios — a
recomendação atual do NIST SP 800-63B — mas exige maiúscula, minúscula e número, porque o sistema
tem perfil administrativo.

O hash **nunca** sai da camada de infraestrutura: o `UserMapper.toDTO()` simplesmente não tem o
campo, então não existe rota capaz de vazá-lo por descuido.

## 2. Sessão: dois tokens com papéis diferentes

|                       | Access token                     | Refresh token                                 |
| --------------------- | -------------------------------- | --------------------------------------------- |
| Formato               | JWT HS256                        | string aleatória opaca de 512 bits            |
| Validade              | 15 minutos                       | 7 dias                                        |
| Onde fica no cliente  | **memória** (variável de módulo) | cookie `httpOnly` + `Secure` + `SameSite`     |
| Onde fica no servidor | em lugar nenhum (é stateless)    | tabela `refresh_tokens`, **apenas o SHA-256** |
| Revogável             | não (expira)                     | sim, imediatamente                            |

**Por que o access token não vai para o `localStorage`:** qualquer XSS consegue ler o storage
inteiro. Em memória, o token some ao fechar a aba e não é acessível por script injetado em outro
contexto. O custo é precisar renovar após um F5 — resolvido pelo cookie de refresh.

**Por que o refresh não é JWT:** JWT é irrevogável até expirar por definição. Para conseguir
derrubar sessões (suspender usuário, trocar senha, "sair de todos os dispositivos"), o refresh
precisa existir como linha no banco.

**Por que o banco guarda só o hash:** se o banco vazar, nenhum token continua utilizável.

### Rotação com detecção de reuso

Cada refresh consome o token e emite outro. Se um token **já revogado** for apresentado, isso
significa que ele foi roubado (o legítimo já rotacionou) — e a API então derruba **todas** as
sessões daquele usuário. É a defesa padrão do _OAuth 2.0 Security Best Current Practice_, e está
coberta por teste de integração.

## 3. Autorização

Dois níveis, ambos como `preHandler` do Fastify:

- `authenticate` — valida assinatura e validade do JWT e monta o `actor`.
- `requireAdmin` — roda por cima e checa o papel.

Todo o plugin `/api/admin/*` está atrás de `requireAdmin` num `addHook` único: **não existe rota
administrativa que dependa de alguém lembrar de proteger**.

Nenhum caso de uso lê `request` — todos recebem `actor`. Além de testável, isso impede o clássico
"esqueci de filtrar pelo usuário logado".

## 4. Isolamento entre usuários

Todo dado financeiro tem `userId` com `ON DELETE CASCADE`, e **toda assinatura de repositório do
módulo financeiro começa com `userId`**:

```ts
findById(userId: string, id: string): Promise<CategoryRecord | null>;
```

Não existe um `findById(id)` que alguém possa chamar por engano. Nenhuma rota financeira aceita
`userId` no path — a fonte é sempre `request.actor.userId`, extraído do token assinado.

**Nem o administrador vê as finanças de outra pessoa.** Administrar contas e ler dados alheios são
coisas diferentes; misturá-las seria um problema de privacidade e de LGPD. Há teste de integração
cobrindo exatamente isso.

## 5. Anti-força-bruta e anti-enumeração

- **Rate limit por IP**: 200 req/min global, **8 tentativas / 15 min** no `/auth/login`,
  5 / 15 min na troca de senha.
- **Bloqueio de conta**: 5 falhas seguidas travam a conta por 15 minutos. Complementa o rate limit,
  que sozinho não protege contra ataque distribuído.
- **Resposta uniforme**: e-mail inexistente e senha errada devolvem a **mesma mensagem**. E, quando
  o e-mail não existe, a API ainda gasta o mesmo tempo de CPU verificando um hash falso — senão o
  tempo de resposta viraria um oráculo revelando quais e-mails estão cadastrados.
- **Checagem de status depois da senha**: uma conta suspensa não é identificável por quem não sabe
  a senha.

## 6. Invariantes administrativas

Codificadas na entidade `User` e nos casos de uso, não na interface:

- Um administrador **não pode** rebaixar, suspender ou excluir a própria conta.
- O sistema **nunca** fica sem administrador ativo.
- Suspender um usuário **revoga as sessões dele na hora**.
- Trocar ou redefinir senha **derruba todas as sessões** daquele usuário.
- Excluir usuário apaga todo o dado financeiro em cascata (direito ao esquecimento).

## 7. Camada de borda

| Proteção                  | Configuração                                             |
| ------------------------- | -------------------------------------------------------- |
| `@fastify/helmet`         | cabeçalhos de segurança, CSP restritiva em produção      |
| `@fastify/cors`           | **allowlist explícita** de origens + `credentials: true` |
| `@fastify/rate-limit`     | global e por rota                                        |
| `@fastify/under-pressure` | devolve 503 quando o event loop trava                    |
| `bodyLimit`               | 1 MB — nenhum endpoint desta API precisa de mais         |
| `trustProxy`              | `request.ip` é o IP real, não o do proxy da Railway      |

Na Vercel, `vercel.json` adiciona `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy` e `Permissions-Policy`.

## 8. Validação de entrada

Todo corpo, query e parâmetro passa por um schema Zod **antes** de chegar ao caso de uso. A
resposta também é serializada pelo schema — o que significa que um campo novo no banco não vaza
para a API sem alguém declarar que ele deve aparecer.

Os schemas moram em `packages/shared` e são os **mesmos** usados pelos formulários do front.

## 9. Configuração

`apps/api/src/config/env.ts` valida o ambiente no boot e **derruba o processo** se algo estiver
errado. Em produção, ainda recusa subir se os segredos JWT forem os de exemplo ou se forem iguais
entre si. É melhor quebrar no boot do que descobrir em produção que `JWT_ACCESS_SECRET` era
`undefined`.

## 10. Logs e auditoria

Pino em JSON, com `authorization`, `cookie`, `set-cookie` e todos os campos de senha **redigidos
automaticamente**. Cada erro carrega um `requestId` que também está no log.

A tabela `audit_logs` registra: login com sucesso, login com falha (e o motivo), criação,
alteração e exclusão de usuário, e redefinição de senha — com ator, IP e metadados.

---

## O que fazer conforme o sistema cresce

Nada disso é bloqueante hoje, mas entra na fila natural de evolução:

1. **2FA (TOTP)** para os perfis administrativos.
2. **Recuperação de senha por e-mail** — hoje só o administrador redefine. Exige um provedor de
   e-mail (Resend, SES) e tokens de uso único com expiração curta.
3. **Rate limit distribuído com Redis** — o atual é por instância; com múltiplas réplicas na
   Railway, o limite efetivo se multiplica.
4. **Rotação de segredos JWT** com `kid` no header, permitindo trocar a chave sem deslogar todo
   mundo de uma vez.
5. **Tela de auditoria** no painel administrativo (os dados já estão gravados).
6. **Sentry** ou equivalente no front e na API — o `ErrorBoundary` já tem o ponto de plugue.
7. **Backup verificado** do Postgres: a Railway faz backup, mas backup que nunca foi restaurado é
   hipótese, não backup. Teste a restauração uma vez.
8. **`npm audit` / Dependabot** no CI para dependências vulneráveis.
