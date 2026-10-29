# Homologação: cópia anonimizada do banco (T-008, D-01)

A homologação roda a fachada .NET, a API Node e uma **cópia anonimizada** do banco de produção. É
onde o verificador de paridade (`tools/verificador-paridade`) compara os dois backends antes de cada
módulo virar.

> ⚠️ **Aguardando aprovação.** O plano (§7, D-01) pede que os campos abaixo sejam aprovados antes da
> primeira execução com dados reais. Até lá, o script só foi testado no banco local.

## O que o `anonimizar.sql` faz

| Tabela | Campo | Na homologação |
|---|---|---|
| `users` | `name` | `Pessoa N` (N pela ordem de criação) |
| `users` | `email` | `pessoa-N@homologacao.invalid` |
| `users` | `passwordHash` | O mesmo hash Argon2id para todos, de uma senha só da homologação |
| `refresh_tokens` | todas as linhas | Apagadas (sessões de produção) |
| `audit_logs` | `actorEmail` | O e-mail anonimizado do autor (ou `NULL`, se o autor foi excluído) |
| `audit_logs` | `ip`, `metadata` | `NULL` (o `metadata` guarda e-mails e as alterações feitas; nenhuma rota o expõe) |
| `categories` | `name` das **personalizadas** | `Categoria N` / `Categoria de entrada N`, por usuário. As de sistema (Mercado, Salário...) ficam |
| `bills`, `incomes`, `debts`, `goals`, `cards` | `name` | `Conta N`, `Entrada N`, `Dívida N`, `Meta N`, `Cartão N`, por usuário |
| `transactions`, `card_purchases` | `note` | `Observação` quando havia texto; `NULL` continua `NULL` |

**Fica como está:** ids e relações, valores em centavos, datas e competências, dias de vencimento e
fechamento, parcelas, papel, status e bloqueio dos usuários, ajustes e a ordem de criação. Com isso,
os cálculos (resumo, faturas, saldo futuro) dão os mesmos números de produção.

O script roda numa transação só e se recusa a rodar sem `-v confirmar=homologacao` e
`-v senha_hash=...`.

## Montar a homologação (Railway)

1. Copiar produção para o Postgres da homologação, **sem passar o dump por outro lugar**:
   ```bash
   pg_dump --no-owner --no-acl "$PRODUCAO_DATABASE_URL" | psql "$HOMOLOGACAO_DATABASE_URL"
   ```
2. Anonimizar na sequência:
   ```bash
   psql "$HOMOLOGACAO_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -v confirmar=homologacao \
     -v senha_hash="$(node tools/homologacao/gerar-hash.mjs 'senha-da-homologacao')" \
     -f tools/homologacao/anonimizar.sql
   ```
3. Subir a API Node e a fachada .NET com o `DATABASE_URL` da homologação e um `JWT_ACCESS_SECRET`
   **diferente** do de produção.
4. Rodar o verificador com tudo em `node`. O critério da T-008 é 0 diferenças.

## Teste local (já feito)

No `grana_test` com os dados de demonstração e um usuário com cartão: as recusas sem confirmação,
com confirmação errada e sem hash funcionaram; depois da anonimização, a senha antiga é recusada, a
nova entra, os 30 valores numéricos do `/api/dashboard` ficaram iguais e o verificador relatou
0 diferenças em 54 GETs.
