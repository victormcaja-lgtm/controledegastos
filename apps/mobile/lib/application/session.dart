import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/env.dart';
import '../data/api_client.dart';
import '../data/grana_api.dart';
import '../data/models.dart';
import '../data/token_store.dart';

final tokenStoreProvider = Provider<RefreshTokenStore>((ref) => SecureRefreshTokenStore());

final apiClientProvider = Provider<ApiClient>(
  (ref) => ApiClient(baseUrl: Env.apiUrl, tokens: ref.watch(tokenStoreProvider)),
);

final granaApiProvider = Provider<GranaApi>((ref) => GranaApi(ref.watch(apiClientProvider)));

enum SessionStatus { loading, authenticated, anonymous }

class SessionState {
  const SessionState(this.status, [this.user]);

  final SessionStatus status;
  final AuthUser? user;
}

/// Estado de SESSÃO — a única coisa global do app (igual ao Zustand do site).
/// Todo o resto é estado de servidor, nos providers de `queries.dart`.
class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() {
    // Se um refresh falhar no meio de qualquer requisição, a sessão cai na hora.
    ref.read(apiClientProvider).onSessionLost = () => state = const SessionState(SessionStatus.anonymous);
    Future.microtask(restore);
    return const SessionState(SessionStatus.loading);
  }

  GranaApi get _api => ref.read(granaApiProvider);

  /// Abrir o app de novo não pode exigir login: o refresh token guardado ainda vale.
  Future<void> restore() async {
    try {
      final user = await _api.restore();
      state = user == null
          ? const SessionState(SessionStatus.anonymous)
          : SessionState(SessionStatus.authenticated, user);
    } catch (_) {
      state = const SessionState(SessionStatus.anonymous);
    }
  }

  Future<AuthUser> login(String email, String password) async {
    final user = await _api.login(email, password);
    state = SessionState(SessionStatus.authenticated, user);
    return user;
  }

  Future<void> logout() async {
    try {
      await _api.logout();
    } catch (_) {
      // Sair localmente mesmo sem rede.
    } finally {
      state = const SessionState(SessionStatus.anonymous);
    }
  }
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(SessionController.new);
