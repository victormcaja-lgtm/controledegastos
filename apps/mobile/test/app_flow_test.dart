import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:grana_mobile/application/session.dart';
import 'package:grana_mobile/data/api_client.dart';
import 'package:grana_mobile/data/token_store.dart';
import 'package:grana_mobile/main.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// API falsa com o mínimo para o fluxo de entrada.
MockClient fakeApi({required bool mustChangePassword}) => MockClient((request) async {
      http.Response ok(Object body) =>
          http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      switch (request.url.path) {
        case '/api/auth/refresh':
          return http.Response('{"statusCode":401,"code":"UNAUTHORIZED","message":"Sessão inválida."}', 401);
        case '/api/auth/login':
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          if (body['password'] != 'SenhaBoa123') {
            return http.Response(
              jsonEncode({'statusCode': 401, 'code': 'UNAUTHORIZED', 'message': 'E-mail ou senha incorretos.'}),
              401,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }
          return http.Response(
            jsonEncode({
              'accessToken': 'a',
              'expiresIn': 900,
              'user': {
                'id': 'u1',
                'name': 'Ana',
                'email': 'ana@grana.app',
                'role': 'USER',
                'status': 'ACTIVE',
                'mustChangePassword': mustChangePassword,
                'createdAt': '2026-10-01T00:00:00.000Z',
              },
            }),
            200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'set-cookie': 'grana_refresh_token=r1; Path=/api/auth; HttpOnly',
            },
          );
        case '/api/cashflow':
          return ok({
            'configured': false,
            'today': '2026-10-19',
            'openingDate': null,
            'from': '2026-10-05',
            'to': '2026-12-18',
            'todayBalanceCents': 0,
            'endOfMonthCents': 0,
            'lowest': null,
            'firstNegativeDate': null,
            'dailyAverageCents': 0,
            'overdueBills': <Object>[],
            'days': <Object>[],
            'months': <Object>[],
          });
        case '/api/settings':
          return ok({
            'overspendAlerts': true,
            'weeklySummary': true,
            'roundCents': false,
            'autoDarkMode': false,
            'showDailyAllowance': true,
            'openingBalanceCents': 0,
            'openingDate': null,
            'dailyBudgetCents': null,
          });
      }
      return http.Response('{}', 404);
    });

Widget app(MockClient api, MemoryRefreshTokenStore tokens) => ProviderScope(
      overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        apiClientProvider.overrideWithValue(ApiClient(baseUrl: 'http://api', tokens: tokens, httpClient: api)),
      ],
      child: const GranaApp(),
    );

Future<void> login(WidgetTester tester, String password) async {
  await tester.enterText(find.byType(TextField).at(0), 'ana@grana.app');
  await tester.enterText(find.byType(TextField).at(1), password);
  await tester.tap(find.text('Entrar').last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('sem sessão abre o login e mostra o erro da API', (tester) async {
    final tokens = MemoryRefreshTokenStore();
    await tester.pumpWidget(app(fakeApi(mustChangePassword: false), tokens));
    await tester.pumpAndSettle();

    expect(find.text('Use o e-mail e a senha que o administrador cadastrou para você.'), findsOneWidget);

    await login(tester, 'errada');
    expect(find.text('E-mail ou senha incorretos.'), findsOneWidget);
  });

  testWidgets('entrar leva ao primeiro acesso do saldo futuro e guarda a sessão', (tester) async {
    final tokens = MemoryRefreshTokenStore();
    await tester.pumpWidget(app(fakeApi(mustChangePassword: false), tokens));
    await tester.pumpAndSettle();

    await login(tester, 'SenhaBoa123');
    expect(find.text('Quanto você tem hoje na conta?'), findsOneWidget);
    expect(find.text('Diário'), findsOneWidget, reason: 'barra inferior visível');
    expect(tokens.value, 'r1');
  });

  testWidgets('senha provisória obriga a trocar antes de qualquer tela', (tester) async {
    final tokens = MemoryRefreshTokenStore();
    await tester.pumpWidget(app(fakeApi(mustChangePassword: true), tokens));
    await tester.pumpAndSettle();

    await login(tester, 'SenhaBoa123');
    expect(find.text('Criar uma nova senha'), findsOneWidget);

    // Validação local com as mesmas regras do site.
    await tester.enterText(find.byType(TextField).at(0), 'SenhaBoa123');
    await tester.enterText(find.byType(TextField).at(1), 'curta');
    await tester.enterText(find.byType(TextField).at(2), 'outra');
    await tester.tap(find.text('Salvar nova senha'));
    await tester.pumpAndSettle();
    expect(find.text('A senha precisa ter pelo menos 10 caracteres.'), findsOneWidget);
    expect(find.text('As senhas não conferem.'), findsOneWidget);
  });
}
