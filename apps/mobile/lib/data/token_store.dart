import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Onde o refresh token mora no aparelho.
abstract interface class RefreshTokenStore {
  Future<String?> read();
  Future<void> write(String token);
  Future<void> clear();
}

/// Keychain (iOS) / Keystore (Android): o equivalente móvel do cookie httpOnly.
class SecureRefreshTokenStore implements RefreshTokenStore {
  SecureRefreshTokenStore([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'grana_refresh_token';
  final FlutterSecureStorage _storage;

  @override
  Future<String?> read() => _storage.read(key: _key);

  @override
  Future<void> write(String token) => _storage.write(key: _key, value: token);

  @override
  Future<void> clear() => _storage.delete(key: _key);
}

/// Para testes.
class MemoryRefreshTokenStore implements RefreshTokenStore {
  String? value;

  @override
  Future<String?> read() async => value;

  @override
  Future<void> write(String token) async => value = token;

  @override
  Future<void> clear() async => value = null;
}
