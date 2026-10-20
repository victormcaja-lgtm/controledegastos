/// Configuração de build. Passe com `--dart-define=API_URL=https://...`.
///
/// O padrão aponta para a API local vista de dentro do emulador Android
/// (10.0.2.2 é o `localhost` da máquina hospedeira).
abstract final class Env {
  static const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3333');
}
