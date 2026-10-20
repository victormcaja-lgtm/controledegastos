import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'application/session.dart';
import 'core/theme.dart';
import 'ui/screens/add_entry_screen.dart';
import 'ui/screens/auth_screens.dart';
import 'ui/screens/bills_screen.dart';
import 'ui/screens/cards_screen.dart';
import 'ui/screens/debts_screen.dart';
import 'ui/screens/diary_screen.dart';
import 'ui/screens/goals_screen.dart';
import 'ui/screens/home_screen.dart';
import 'ui/screens/list_screen.dart';
import 'ui/screens/month_screen.dart';
import 'ui/screens/report_screen.dart';
import 'ui/screens/result_screen.dart';
import 'ui/screens/settings_screen.dart';
import 'ui/screens/simulate_screen.dart';

const _publicPaths = {'/entrar', '/criar-conta'};

/// Rotas com os mesmos caminhos do site. Regras de acesso (iguais ao
/// `RequireAuth` do site): sem sessão → login; senha provisória → nenhuma
/// outra tela abre antes da troca.
final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier(0);
  ref
    ..listen(sessionProvider, (_, _) => refresh.value++)
    ..onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final session = ref.read(sessionProvider);
      final path = state.matchedLocation;
      if (session.status == SessionStatus.loading) return path == '/carregando' ? null : '/carregando';
      if (session.status == SessionStatus.anonymous) return _publicPaths.contains(path) ? null : '/entrar';
      if (session.user?.mustChangePassword ?? false) return path == '/trocar-senha' ? null : '/trocar-senha';
      if (_publicPaths.contains(path) || path == '/carregando') return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/carregando', builder: (_, _) => const _Splash()),
      GoRoute(path: '/entrar', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/criar-conta', builder: (_, _) => const SignupScreen()),
      GoRoute(path: '/trocar-senha', builder: (_, _) => const ChangePasswordScreen()),
      GoRoute(path: '/lancar', builder: (_, _) => const AddEntryScreen()),
      ShellRoute(
        builder: (context, state, child) => _AppShell(location: state.matchedLocation, child: child),
        routes: [
          GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
          GoRoute(path: '/diario', builder: (_, _) => const DiaryScreen()),
          GoRoute(path: '/contas', builder: (_, _) => const BillsScreen()),
          GoRoute(path: '/mais', builder: (_, _) => const ReportScreen()),
          GoRoute(path: '/resultado', builder: (_, _) => const ResultScreen()),
          GoRoute(path: '/cartoes', builder: (_, _) => const CardsScreen()),
          GoRoute(path: '/parcelas', builder: (_, _) => const DebtsScreen()),
          GoRoute(path: '/guardar', builder: (_, _) => const GoalsScreen()),
          GoRoute(path: '/ajustes', builder: (_, _) => const SettingsScreen()),
          GoRoute(path: '/posso-comprar', builder: (_, _) => const SimulateScreen()),
          GoRoute(path: '/lista', builder: (_, _) => const ListScreen()),
          GoRoute(path: '/mes', builder: (_, _) => const MonthScreen()),
        ],
      ),
    ],
  );
});

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Grana', style: display(size: 26, weight: FontWeight.w700, letterSpacing: -0.8)),
              const SizedBox(height: 18),
              const SizedBox.square(
                dimension: 22,
                child: CircularProgressIndicator(strokeWidth: 2.4, color: GranaColors.ink),
              ),
            ],
          ),
        ),
      );
}

/// Seções agrupadas sob a aba "Mais".
const _moreSection = ['/mais', '/parcelas', '/guardar', '/ajustes', '/cartoes', '/resultado', '/posso-comprar'];

class _AppShell extends StatelessWidget {
  const _AppShell({required this.location, required this.child});

  final String location;
  final Widget child;

  static const _items = [
    ('/', 'Início', Icons.radio_button_checked_rounded),
    ('/diario', 'Diário', Icons.view_agenda_outlined),
    ('/lancar', 'Lançar', Icons.add_rounded),
    ('/contas', 'Contas', Icons.calendar_month_outlined),
    ('/mais', 'Mais', Icons.pie_chart_outline_rounded),
  ];

  bool _active(String path) {
    if (path == '/mais') return _moreSection.any(location.startsWith);
    if (path == '/') return location == '/' || location == '/mes';
    if (path == '/diario') return location == '/diario' || location == '/lista';
    return location == path;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: child,
        bottomNavigationBar: DecoratedBox(
          decoration: const BoxDecoration(
            color: GranaColors.card,
            border: Border(top: BorderSide(color: GranaColors.line)),
          ),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 8, 10),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  for (final (path, label, icon) in _items)
                    _NavButton(
                      label: label,
                      icon: icon,
                      active: _active(path),
                      primary: path == '/lancar',
                      onTap: () => path == '/lancar' ? context.push(path) : context.go(path),
                    ),
                ],
              ),
            ),
          ),
        ),
      );
}

class _NavButton extends StatelessWidget {
  const _NavButton({
    required this.label,
    required this.icon,
    required this.active,
    required this.primary,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool active;
  final bool primary;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final highlighted = primary || active;
    return Semantics(
      button: true,
      selected: active,
      label: label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: SizedBox(
          width: 60,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: primary ? 44 : 28,
                height: primary ? 34 : 28,
                decoration: BoxDecoration(
                  color: highlighted ? GranaColors.ink : Colors.transparent,
                  borderRadius: BorderRadius.circular(primary ? 14 : 14),
                ),
                child: Icon(icon, size: primary ? 22 : 17, color: highlighted ? GranaColors.surface : GranaColors.faint),
              ),
              const SizedBox(height: 4),
              Text(
                label,
                style: body(size: 10.5, weight: FontWeight.w500, color: highlighted ? GranaColors.ink : GranaColors.faint),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
