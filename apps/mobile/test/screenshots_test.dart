// Capturas das telas principais com respostas reais gravadas da API local
// (test/fixtures). Servem para revisão visual (UI/UX), não para paridade.
//
//   flutter test test/screenshots_test.dart --update-goldens
//
// Os PNGs ficam em test/screenshots/.
@Tags(['screenshots'])
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:grana_mobile/application/session.dart';
import 'package:grana_mobile/data/api_client.dart';
import 'package:grana_mobile/data/token_store.dart';
import 'package:grana_mobile/main.dart';
import 'package:grana_mobile/router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

String _fixture(String name) => File('test/fixtures/$name.json').readAsStringSync();

const _user = '{"id":"u1","name":"Administrador","email":"admin@grana.app","role":"ADMIN",'
    '"status":"ACTIVE","mustChangePassword":false,"createdAt":"2026-10-01T00:00:00.000Z"}';

MockClient _api() => MockClient((request) async {
      http.Response ok(String body) =>
          http.Response.bytes(utf8.encode(body), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      final path = request.url.path;
      if (path == '/api/auth/refresh') return ok('{"accessToken":"a","expiresIn":900,"user":$_user}');
      if (path == '/api/cashflow') return ok(_fixture('cashflow_home'));
      if (path == '/api/bills/overdue') return ok(_fixture('overdue'));
      if (path == '/api/bills') return ok(_fixture('bills'));
      if (path == '/api/cards') return ok(_fixture('cards'));
      if (path.endsWith('/invoice')) return ok(_fixture('invoice'));
      if (path == '/api/categories') return ok(_fixture('categories'));
      if (path == '/api/settings') return ok(_fixture('settings'));
      if (path == '/api/dashboard') return ok(_fixture('dashboard'));
      if (path == '/api/reports/categories') return ok(_fixture('report'));
      if (path == '/api/goals') return ok(_fixture('goals'));
      if (path == '/api/debts') return ok(_fixture('debts'));
      if (path == '/api/incomes') return ok(_fixture('incomes'));
      return http.Response('{}', 404);
    });

Future<void> _loadFonts() async {
  final fonts = {
    'Figtree': ['400', '500', '600', '700'].map((w) => 'assets/fonts/Figtree-$w.ttf'),
    'Archivo': ['400', '500', '600', '700'].map((w) => 'assets/fonts/Archivo-$w.ttf'),
  };
  for (final entry in fonts.entries) {
    final loader = FontLoader(entry.key);
    for (final file in entry.value) {
      loader.addFont(rootBundle.load(file));
    }
    await loader.load();
  }
  final icons = FontLoader('MaterialIcons')..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await icons.load();
}

void main() {
  setUpAll(_loadFonts);

  const screens = {
    'inicio': '/',
    'diario': '/diario',
    'lancar': '/lancar',
    'contas': '/contas',
    'cartoes': '/cartoes',
    'categorias': '/mais',
    'parcelas': '/parcelas',
    'guardar': '/guardar',
    'resumo-do-mes': '/mes',
  };

  for (final MapEntry(key: name, value: route) in screens.entries) {
    testWidgets(name, (tester) async {
      tester.view.physicalSize = const Size(1170, 2532);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);

      final tokens = MemoryRefreshTokenStore()..value = 'r';
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            tokenStoreProvider.overrideWithValue(tokens),
            apiClientProvider.overrideWithValue(ApiClient(baseUrl: 'http://api', tokens: tokens, httpClient: _api())),
          ],
          child: const GranaApp(),
        ),
      );
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(GranaApp)));
      final GoRouter router = container.read(routerProvider);
      route == '/mes' || route == '/lancar' ? router.push(route) : router.go(route);
      await tester.pumpAndSettle();

      await expectLater(find.byType(GranaApp), matchesGoldenFile('screenshots/$name.png'));
    });
  }
}
