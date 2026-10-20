import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:grana_mobile/data/api_client.dart';
import 'package:grana_mobile/data/token_store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response json(Object body, int status, {Map<String, String> headers = const {}}) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json', ...headers},
    );

const loginBody = {
  'accessToken': 'access-1',
  'expiresIn': 900,
  'user': {
    'id': 'u1',
    'name': 'Ana',
    'email': 'ana@grana.app',
    'role': 'USER',
    'status': 'ACTIVE',
    'mustChangePassword': false,
    'createdAt': '2026-10-01T00:00:00.000Z',
  },
};

void main() {
  late MemoryRefreshTokenStore tokens;

  setUp(() => tokens = MemoryRefreshTokenStore());

  test('guarda o refresh token do Set-Cookie e o envia só para /api/auth', () async {
    final seenCookies = <String, String?>{};
    final client = ApiClient(
      baseUrl: 'http://api',
      tokens: tokens,
      httpClient: MockClient((request) async {
        seenCookies[request.url.path] = request.headers['Cookie'];
        if (request.url.path == '/api/auth/login') {
          return json(loginBody, 200, headers: {
            'set-cookie': 'grana_refresh_token=abc123; Path=/api/auth; Expires=Mon, 26 Oct 2026 12:00:00 GMT; HttpOnly',
          });
        }
        return json(<String, Object>{}, 200);
      }),
    );

    await client.post('/api/auth/login', {'email': 'ana@grana.app', 'password': 'x'});
    expect(tokens.value, 'abc123');

    await client.get('/api/settings');
    await client.get('/api/auth/me');
    expect(seenCookies['/api/settings'], isNull);
    expect(seenCookies['/api/auth/me'], 'grana_refresh_token=abc123');
  });

  test('cookie limpo pelo logout apaga o token guardado', () async {
    tokens.value = 'abc123';
    final client = ApiClient(
      baseUrl: 'http://api',
      tokens: tokens,
      httpClient: MockClient((_) async => http.Response('', 204, headers: {
            'set-cookie': 'grana_refresh_token=; Max-Age=0; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
          })),
    );
    await client.post('/api/auth/logout');
    expect(tokens.value, isNull);
  });

  test('401 renova a sessão uma vez e repete a chamada', () async {
    tokens.value = 'old';
    var refreshes = 0;
    final client = ApiClient(
      baseUrl: 'http://api',
      tokens: tokens,
      httpClient: MockClient((request) async {
        if (request.url.path == '/api/auth/refresh') {
          refreshes++;
          expect(request.headers['Cookie'], 'grana_refresh_token=old');
          return json(loginBody, 200, headers: {'set-cookie': 'grana_refresh_token=new; Path=/api/auth'});
        }
        if (request.headers['Authorization'] == 'Bearer access-1') return json({'ok': true}, 200);
        return json({'statusCode': 401, 'code': 'UNAUTHORIZED', 'message': 'Sessão inválida ou expirada.'}, 401);
      }),
    );

    final results = await Future.wait([client.get('/api/a'), client.get('/api/b'), client.get('/api/c')]);
    expect(results, everyElement({'ok': true}));
    expect(refreshes, 1, reason: 'requisições simultâneas compartilham um único refresh');
    expect(tokens.value, 'new');
  });

  test('refresh recusado derruba a sessão', () async {
    tokens.value = 'stolen';
    var lost = false;
    final client = ApiClient(
      baseUrl: 'http://api',
      tokens: tokens,
      httpClient: MockClient((request) async => json(
            {'statusCode': 401, 'code': 'UNAUTHORIZED', 'message': 'Sessão comprometida. Faça login novamente.'},
            401,
          )),
    )..onSessionLost = () => lost = true;

    await expectLater(client.get('/api/dashboard'), throwsA(isA<ApiError>().having((e) => e.status, 'status', 401)));
    expect(lost, isTrue);
    expect(client.accessToken, isNull);
  });

  test('login errado não tenta renovar a sessão', () async {
    var calls = 0;
    final client = ApiClient(
      baseUrl: 'http://api',
      tokens: tokens,
      httpClient: MockClient((request) async {
        calls++;
        return json({'statusCode': 401, 'code': 'UNAUTHORIZED', 'message': 'E-mail ou senha incorretos.'}, 401);
      }),
    );
    await expectLater(
      client.post('/api/auth/login', {'email': 'a@b.co', 'password': 'x'}),
      throwsA(isA<ApiError>().having((e) => e.message, 'message', 'E-mail ou senha incorretos.')),
    );
    expect(calls, 1);
  });

  test('erro de validação traz as mensagens por campo', () async {
    final client = ApiClient(
      baseUrl: 'http://api',
      tokens: tokens,
      httpClient: MockClient((_) async => json({
            'statusCode': 400,
            'error': 'Bad Request',
            'code': 'VALIDATION_ERROR',
            'message': 'Alguns campos precisam de atenção.',
            'details': [
              {'path': 'password', 'message': 'Inclua ao menos um número.'},
            ],
          }, 400)),
    );
    try {
      await client.post('/api/auth/signup', {});
      fail('deveria lançar');
    } on ApiError catch (error) {
      expect(error.code, 'VALIDATION_ERROR');
      expect(error.fieldErrors, {'password': 'Inclua ao menos um número.'});
    }
  });

  test('sem rede vira ApiError com mensagem amigável', () async {
    final client = ApiClient(
      baseUrl: 'http://api',
      tokens: tokens,
      httpClient: MockClient((_) async => throw http.ClientException('offline')),
    );
    await expectLater(
      client.get('/api/settings'),
      throwsA(isA<ApiError>().having((e) => e.message, 'message', 'Sem conexão com o servidor.')),
    );
  });

  test('query ignora valores vazios', () async {
    Uri? seen;
    final client = ApiClient(
      baseUrl: 'http://api',
      tokens: tokens,
      httpClient: MockClient((request) async {
        seen = request.url;
        return json(<String, Object>{}, 200);
      }),
    );
    await client.get('/api/transactions', query: {'month': '2026-10', 'categoryId': null, 'search': ''});
    expect(seen.toString(), 'http://api/api/transactions?month=2026-10');
  });
}
