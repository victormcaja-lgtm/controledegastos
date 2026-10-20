import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme.dart';
import 'router.dart';

void main() {
  // Uma falha de rede não deve virar várias tentativas silenciosas: no máximo
  // uma repetição (o site usa `retry: 1`); depois a tela mostra o erro.
  runApp(
    ProviderScope(
      retry: (retryCount, error) => retryCount < 1 ? const Duration(milliseconds: 400) : null,
      child: const GranaApp(),
    ),
  );
}

class GranaApp extends ConsumerWidget {
  const GranaApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp.router(
        title: 'Grana',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        routerConfig: ref.watch(routerProvider),
        locale: const Locale('pt', 'BR'),
        supportedLocales: const [Locale('pt', 'BR')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
      );
}
