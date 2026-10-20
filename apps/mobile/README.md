# Grana — app móvel (Flutter)

App Android/iOS do Grana. Consome **a mesma API** do site (`apps/api`), com as mesmas regras,
mensagens e formatação. Tem todas as telas do usuário; a administração de usuários continua no site.

## Telas

| Aba / rota            | Tela                                                         |
| --------------------- | ------------------------------------------------------------ |
| Início `/`            | Saldo hoje, fim do mês, menor saldo, atrasos, próximos 7 dias |
| Diário `/diario`      | Dia a dia com saldo; "lista do mês" em `/lista`              |
| Lançar `/lancar`      | Teclado em centavos, categoria, conta/Pix ou cartão          |
| Contas `/contas`      | Calendário, baixa por mês, atrasos, cadastro                 |
| Mais                  | Resultado, Cartões, Categorias, Parcelas, Guardar, Ajustes   |
| `/posso-comprar`      | Simulação com e sem a compra                                 |
| `/mes`                | Resumo do mês ("deve sobrar")                                |
| `/entrar`, `/criar-conta`, `/trocar-senha` | Acesso                                  |

## Arquitetura

```
lib/
  core/         dinheiro, datas, cores CSS→Color, tema (tokens do site), env
  data/         ApiClient (sessão), GranaApi (gateway, única camada que conhece URLs), models
  application/  sessão (Riverpod Notifier) e consultas (FutureProviders + invalidateMoney)
  ui/           widgets do design system, gráfico do saldo, telas
  router.dart   go_router com as mesmas rotas e regras de acesso do site
```

**Sessão no celular.** O access token (15 min) fica só em memória. O refresh token chega no cookie
`grana_refresh_token`; como não há navegador, o `ApiClient` lê o `Set-Cookie` das rotas
`/api/auth`, guarda o valor no **Keychain/Keystore** (`flutter_secure_storage`) e o devolve no
cabeçalho `Cookie`. Um 401 dispara um único refresh compartilhado e repete a chamada; se falhar, a
sessão cai. Nenhuma mudança na API foi necessária.

## Rodar

```bash
# API local (na raiz do repo): docker compose up -d postgres && npm run dev:api
cd apps/mobile
flutter pub get
flutter run                                   # emulador Android → http://10.0.2.2:3333
flutter run --dart-define=API_URL=http://192.168.0.10:3333   # celular na mesma rede
```

O build de **debug** libera HTTP sem TLS (só para a API local). O de **release** exige HTTPS.

## Gerar versão

```bash
flutter build apk --release --dart-define=API_URL=https://SUA-API.up.railway.app
flutter build appbundle --release --dart-define=API_URL=https://SUA-API.up.railway.app   # Play Store
flutter build ipa --dart-define=API_URL=...   # só num Mac com Xcode
```

Antes de publicar na Play Store, configure uma chave de assinatura própria em
`android/app/build.gradle.kts` (hoje o release usa a chave de debug do template).

## Testes

```bash
flutter analyze
flutter test                                  # unidade + fluxo de telas com API simulada
# integração contra uma API de verdade (cria e apaga um usuário de teste):
GRANA_API_URL=http://localhost:3333 GRANA_ADMIN_EMAIL=admin@grana.app \
GRANA_ADMIN_PASSWORD=... flutter test test/live_api_test.dart
```

A API limita o login a 8 tentativas por IP a cada 15 minutos; para rodar a integração várias
vezes seguidas localmente, suba a API com `LOGIN_RATE_LIMIT_MAX=500`.

Os valores esperados de `test/core_test.dart` foram gerados executando `packages/shared` no Node:
o app formata dinheiro e datas exatamente como o site.

## Diferenças em relação ao site

- Lançar abre em tela cheia (sem barra inferior); "Resumo do mês" e "Lista" são telas empilhadas,
  com voltar, acessadas por links no Início e no Diário.
- O app não tenta renovar a sessão quando o **login** ou o **cadastro** respondem 401 (o site
  tenta, sem efeito útil).
- Fontes (Archivo e Figtree, licença OFL) vêm embutidas: o app desenha o texto sem internet.
