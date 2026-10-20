import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/session.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../widgets.dart';

/// Moldura das telas de acesso: marca no topo, cartão no meio, rodapé.
class _AuthLayout extends StatelessWidget {
  const _AuthLayout({required this.title, required this.subtitle, required this.child, this.footer});

  final String title;
  final String subtitle;
  final Widget child;
  final Widget? footer;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 40),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 400),
                child: Column(
                  children: [
                    Text('Grana', style: display(size: 24, weight: FontWeight.w700, letterSpacing: -0.7)),
                    const SizedBox(height: 4),
                    Text('controle financeiro pessoal', style: body(size: 13, color: GranaColors.muted)),
                    const SizedBox(height: 28),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.fromLTRB(24, 28, 24, 28),
                      decoration: BoxDecoration(
                        color: GranaColors.card,
                        borderRadius: BorderRadius.circular(26),
                        border: Border.all(color: GranaColors.line),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(title, style: display(size: 20, letterSpacing: -0.4)),
                          const SizedBox(height: 6),
                          Text(subtitle, style: body(size: 13, color: GranaColors.muted, height: 1.45)),
                          const SizedBox(height: 24),
                          child,
                        ],
                      ),
                    ),
                    if (footer != null) ...[
                      const SizedBox(height: 20),
                      DefaultTextStyle.merge(
                        textAlign: TextAlign.center,
                        style: body(size: 12, color: GranaColors.muted),
                        child: footer!,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      );
}

class _FormError extends StatelessWidget {
  const _FormError(this.message);

  final String message;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: GranaColors.clay.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(message, style: body(size: 13, color: GranaColors.clay)),
      );
}

/* ────────────────── Validação (mesmas regras do Zod) ────────────────── */

final _emailPattern = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$');

String? _validateEmail(String value) {
  final email = value.trim().toLowerCase();
  if (email.length > 160 || !_emailPattern.hasMatch(email)) return 'E-mail inválido.';
  return null;
}

/// Política de senha do sistema (`passwordSchema`).
String? validatePassword(String value) {
  if (value.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (value.length > 128) return 'A senha pode ter no máximo 128 caracteres.';
  if (!RegExp('[a-z]').hasMatch(value)) return 'Inclua ao menos uma letra minúscula.';
  if (!RegExp('[A-Z]').hasMatch(value)) return 'Inclua ao menos uma letra maiúscula.';
  if (!RegExp(r'\d').hasMatch(value)) return 'Inclua ao menos um número.';
  return null;
}

/* ─────────────────────────────── Entrar ─────────────────────────────── */

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  Map<String, String> _errors = {};
  String? _formError;
  bool _busy = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final errors = <String, String>{
      'email': ?_validateEmail(_email.text),
      if (_password.text.isEmpty) 'password': 'Informe a senha.',
    };
    setState(() {
      _errors = errors;
      _formError = null;
    });
    if (errors.isNotEmpty) return;

    setState(() => _busy = true);
    try {
      // O roteador decide o destino: senha provisória vai direto para a troca.
      await ref.read(sessionProvider.notifier).login(_email.text.trim().toLowerCase(), _password.text);
    } catch (error) {
      if (mounted) {
        setState(() {
          _formError = errorMessage(error, 'Não foi possível entrar agora.');
          if (error is ApiError) _errors = error.fieldErrors;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => _AuthLayout(
        title: 'Entrar',
        subtitle: 'Use o e-mail e a senha que o administrador cadastrou para você.',
        footer: Column(
          children: [
            const Text('Esqueceu a senha? Peça ao administrador para redefinir.'),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('Não tem conta? '),
                LinkText('Criar conta', size: 12, onTap: () => context.go('/criar-conta')),
              ],
            ),
          ],
        ),
        child: AutofillGroup(
          child: Column(
            children: [
              LabeledField(
                label: 'E-mail',
                error: _errors['email'],
                child: GranaInput(
                  controller: _email,
                  hint: 'voce@empresa.com',
                  keyboard: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                ),
              ),
              const SizedBox(height: 16),
              LabeledField(
                label: 'Senha',
                error: _errors['password'],
                child: GranaInput(
                  controller: _password,
                  obscure: true,
                  autofillHints: const [AutofillHints.password],
                  onSubmitted: (_) => _submit(),
                ),
              ),
              if (_formError != null) ...[const SizedBox(height: 16), _FormError(_formError!)],
              const SizedBox(height: 20),
              GranaButton(label: 'Entrar', size: ButtonSize.lg, fullWidth: true, loading: _busy, onPressed: _submit),
            ],
          ),
        ),
      );
}

/* ───────────────────────────── Criar conta ──────────────────────────── */

class SignupScreen extends ConsumerStatefulWidget {
  const SignupScreen({super.key});

  @override
  ConsumerState<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends ConsumerState<SignupScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  Map<String, String> _errors = {};
  String? _formError;
  bool _busy = false;
  bool _submitted = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final errors = <String, String>{
      if (name.length < 2 || name.length > 80) 'name': 'Informe o nome completo.',
      'email': ?_validateEmail(_email.text),
      'password': ?validatePassword(_password.text),
    };
    setState(() {
      _errors = errors;
      _formError = null;
    });
    if (errors.isNotEmpty) return;

    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).signup(
            name: name,
            email: _email.text.trim().toLowerCase(),
            password: _password.text,
          );
      if (mounted) setState(() => _submitted = true);
    } catch (error) {
      if (mounted) {
        setState(() {
          _formError = errorMessage(error, 'Não foi possível enviar agora.');
          if (error is ApiError) _errors = error.fieldErrors;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_submitted) {
      return _AuthLayout(
        title: 'Solicitação enviada',
        subtitle: 'Falta pouco.',
        child: Column(
          children: [
            Text(
              'Um administrador precisa aprovar seu acesso antes que você possa entrar. Assim que isso '
              'acontecer, use o e-mail e a senha que você acabou de escolher para entrar normalmente.',
              style: body(size: 13, color: GranaColors.soft, height: 1.5),
            ),
            const SizedBox(height: 20),
            GranaButton(
              label: 'Voltar para o login',
              variant: ButtonVariant.secondary,
              fullWidth: true,
              onPressed: () => context.go('/entrar'),
            ),
          ],
        ),
      );
    }

    return _AuthLayout(
      title: 'Criar conta',
      subtitle: 'Escolha seu e-mail e senha. Um administrador precisa aprovar antes de você conseguir entrar.',
      footer: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text('Já tem conta? '),
          LinkText('Entrar', size: 12, onTap: () => context.go('/entrar')),
        ],
      ),
      child: AutofillGroup(
        child: Column(
          children: [
            LabeledField(
              label: 'Nome',
              error: _errors['name'],
              child: GranaInput(controller: _name, hint: 'Seu nome completo', autofillHints: const [AutofillHints.name]),
            ),
            const SizedBox(height: 16),
            LabeledField(
              label: 'E-mail',
              error: _errors['email'],
              child: GranaInput(
                controller: _email,
                hint: 'voce@empresa.com',
                keyboard: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
              ),
            ),
            const SizedBox(height: 16),
            LabeledField(
              label: 'Senha',
              error: _errors['password'],
              hint: 'Mínimo de 10 caracteres, com letra maiúscula, minúscula e número.',
              child: GranaInput(controller: _password, obscure: true, autofillHints: const [AutofillHints.newPassword]),
            ),
            if (_formError != null) ...[const SizedBox(height: 16), _FormError(_formError!)],
            const SizedBox(height: 20),
            GranaButton(
              label: 'Solicitar acesso',
              size: ButtonSize.lg,
              fullWidth: true,
              loading: _busy,
              onPressed: _submit,
            ),
          ],
        ),
      ),
    );
  }
}

/* ──────────────────────────── Trocar senha ──────────────────────────── */

class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  Map<String, String> _errors = {};
  String? _formError;
  bool _busy = false;
  bool _done = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final errors = <String, String>{
      if (_current.text.isEmpty) 'currentPassword': 'Informe a senha atual.',
      'newPassword': ?validatePassword(_next.text),
      if (_next.text.isNotEmpty && _next.text == _current.text)
        'newPassword': 'A nova senha precisa ser diferente da atual.',
      if (_confirm.text != _next.text) 'confirmPassword': 'As senhas não conferem.',
    };
    setState(() {
      _errors = errors;
      _formError = null;
    });
    if (errors.isNotEmpty) return;

    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).changePassword(
            currentPassword: _current.text,
            newPassword: _next.text,
            confirmPassword: _confirm.text,
          );
      // Trocar a senha derruba todas as sessões — inclusive esta. É o esperado.
      if (!mounted) return;
      setState(() => _done = true);
      unawaited(
        Future<void>.delayed(const Duration(milliseconds: 1600), () => ref.read(sessionProvider.notifier).logout()),
      );
    } catch (error) {
      if (mounted) {
        setState(() {
          _formError = errorMessage(error, 'Não foi possível trocar a senha.');
          if (error is ApiError) _errors = error.fieldErrors;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_done) {
      return _AuthLayout(
        title: 'Senha atualizada',
        subtitle: 'Entre novamente com a nova senha.',
        child: Text('Redirecionando para o login…', style: body(size: 13, color: GranaColors.soft)),
      );
    }

    final mustChange = ref.watch(sessionProvider).user?.mustChangePassword ?? false;
    return _AuthLayout(
      title: 'Criar uma nova senha',
      subtitle: 'Mínimo de 10 caracteres, com letra maiúscula, minúscula e número.',
      footer: mustChange
          ? LinkText('Sair', size: 12, onTap: () => ref.read(sessionProvider.notifier).logout())
          : LinkText('Voltar', size: 12, onTap: () => context.canPop() ? context.pop() : context.go('/ajustes')),
      child: Column(
        children: [
          LabeledField(
            label: 'Senha atual',
            error: _errors['currentPassword'],
            child: GranaInput(controller: _current, obscure: true, autofillHints: const [AutofillHints.password]),
          ),
          const SizedBox(height: 16),
          LabeledField(
            label: 'Nova senha',
            error: _errors['newPassword'],
            child: GranaInput(controller: _next, obscure: true, autofillHints: const [AutofillHints.newPassword]),
          ),
          const SizedBox(height: 16),
          LabeledField(
            label: 'Repita a nova senha',
            error: _errors['confirmPassword'],
            child: GranaInput(controller: _confirm, obscure: true, onSubmitted: (_) => _submit()),
          ),
          if (_formError != null) ...[const SizedBox(height: 16), _FormError(_formError!)],
          const SizedBox(height: 20),
          GranaButton(
            label: 'Salvar nova senha',
            size: ButtonSize.lg,
            fullWidth: true,
            loading: _busy,
            onPressed: _submit,
          ),
        ],
      ),
    );
  }
}
