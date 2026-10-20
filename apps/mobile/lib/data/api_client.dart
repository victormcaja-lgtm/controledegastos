import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'token_store.dart';

/// Erro de API já traduzido — é o que as telas tratam. Mesmo envelope do site:
/// `{statusCode, code, message, details?}`.
class ApiError implements Exception {
  ApiError(this.status, this.code, this.message, [this.details = const []]);

  final int status;
  final String code;
  final String message;
  final List<({String path, String message})> details;

  /// Mensagem por campo, para mostrar embaixo de cada input.
  Map<String, String> get fieldErrors => {for (final d in details) d.path: d.message};

  @override
  String toString() => 'ApiError($status, $code): $message';
}

const refreshCookieName = 'grana_refresh_token';

/// Cliente HTTP do app.
///
/// Sessão igual à do site, adaptada ao celular:
///  • o access token (15 min) fica só em MEMÓRIA;
///  • o refresh token chega no cookie `grana_refresh_token`. Não existe
///    navegador para guardá-lo, então o cliente lê o `Set-Cookie` das rotas de
///    `/api/auth` e guarda o valor no armazenamento seguro do aparelho
///    (Keychain/Keystore), devolvendo-o no cabeçalho `Cookie` quando precisa.
///  • um 401 dispara UM refresh — compartilhado entre requisições
///    simultâneas — e a chamada é repetida uma vez. Se o refresh falhar, a
///    sessão cai (`onSessionLost`).
class ApiClient {
  ApiClient({required this.baseUrl, required this.tokens, http.Client? httpClient})
      : _http = httpClient ?? http.Client();

  final String baseUrl;
  final RefreshTokenStore tokens;
  final http.Client _http;

  String? accessToken;
  void Function()? onSessionLost;
  Future<bool>? _refreshing;

  /// Rotas em que um 401 é resposta de negócio, não sessão vencida.
  static const _noRefreshPaths = ['/api/auth/login', '/api/auth/signup', '/api/auth/refresh', '/api/auth/logout'];

  Future<dynamic> get(String path, {Map<String, Object?> query = const {}}) =>
      request('GET', path, query: query);
  Future<dynamic> post(String path, [Object? body]) => request('POST', path, body: body);
  Future<dynamic> patch(String path, [Object? body, Map<String, Object?> query = const {}]) =>
      request('PATCH', path, body: body, query: query);
  Future<dynamic> put(String path, [Object? body]) => request('PUT', path, body: body);
  Future<dynamic> delete(String path) => request('DELETE', path);

  Uri _uri(String path, Map<String, Object?> query) {
    final params = <String, String>{
      for (final entry in query.entries)
        if (entry.value != null && entry.value.toString().isNotEmpty) entry.key: entry.value.toString(),
    };
    final uri = Uri.parse('$baseUrl$path');
    return params.isEmpty ? uri : uri.replace(queryParameters: params);
  }

  Future<http.Response> _send(String method, Uri uri, Object? body) async {
    final headers = <String, String>{'Accept': 'application/json'};
    if (body != null) headers['Content-Type'] = 'application/json';
    final token = accessToken;
    if (token != null) headers['Authorization'] = 'Bearer $token';
    if (uri.path.startsWith('/api/auth')) {
      final refresh = await tokens.read();
      if (refresh != null) headers['Cookie'] = '$refreshCookieName=$refresh';
    }

    final request = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);
    final response = await http.Response.fromStream(await _http.send(request));
    await _captureRefreshCookie(response);
    return response;
  }

  /// Guarda (ou apaga) o refresh token que veio no `Set-Cookie`.
  Future<void> _captureRefreshCookie(http.Response response) async {
    final header = response.headers['set-cookie'];
    if (header == null) return;
    final match = RegExp('$refreshCookieName=([^;,]*)').firstMatch(header);
    if (match == null) return;
    final value = match.group(1) ?? '';
    final cleared = value.isEmpty || RegExp(r'Expires=Thu, 01 Jan 1970', caseSensitive: false).hasMatch(header);
    if (cleared) {
      await tokens.clear();
    } else {
      await tokens.write(value);
    }
  }

  Future<dynamic> request(
    String method,
    String path, {
    Object? body,
    Map<String, Object?> query = const {},
    bool retried = false,
  }) async {
    final uri = _uri(path, query);
    http.Response response;
    try {
      response = await _send(method, uri, body);
    } on ApiError {
      rethrow;
    } catch (_) {
      throw ApiError(0, 'NETWORK', 'Sem conexão com o servidor.');
    }

    if (response.statusCode == 401 && !retried && !_noRefreshPaths.contains(path)) {
      if (await refresh()) {
        return request(method, path, body: body, query: query, retried: true);
      }
      accessToken = null;
      onSessionLost?.call();
      throw _parseError(response);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) throw _parseError(response);
    if (response.statusCode == 204 || response.body.isEmpty) return null;
    return jsonDecode(utf8.decode(response.bodyBytes));
  }

  /// Renova o access token pelo refresh token guardado. Chamadas simultâneas
  /// compartilham a mesma tentativa.
  Future<bool> refresh() {
    return _refreshing ??= () async {
      try {
        if (await tokens.read() == null) return false;
        final response = await _send('POST', _uri('/api/auth/refresh', const {}), null);
        if (response.statusCode != 200) return false;
        final data = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
        accessToken = data['accessToken'] as String;
        lastRefreshPayload = data;
        return true;
      } catch (_) {
        return false;
      } finally {
        scheduleMicrotask(() => _refreshing = null);
      }
    }();
  }

  /// Resposta completa do último refresh bem-sucedido (traz o usuário).
  Map<String, dynamic>? lastRefreshPayload;

  ApiError _parseError(http.Response response) {
    Map<String, dynamic> payload = const {};
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, dynamic>) payload = decoded;
    } catch (_) {
      // resposta sem corpo JSON
    }
    final details = (payload['details'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map((d) => (path: d['path'] as String? ?? '', message: d['message'] as String? ?? ''))
        .toList();
    return ApiError(
      response.statusCode,
      payload['code'] as String? ?? 'UNKNOWN',
      payload['message'] as String? ?? defaultMessage(response.statusCode),
      details,
    );
  }

  static String defaultMessage(int status) {
    if (status == 0) return 'Sem conexão com o servidor.';
    if (status == 403) return 'Você não tem permissão para isso.';
    if (status == 404) return 'Não encontramos o que você pediu.';
    if (status == 429) return 'Muitas tentativas seguidas. Espere um pouco.';
    if (status >= 500) return 'O servidor teve um problema. Tente de novo em instantes.';
    return 'Não deu para completar a ação.';
  }
}
