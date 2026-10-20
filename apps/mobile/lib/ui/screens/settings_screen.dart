import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/queries.dart';
import '../../application/session.dart';
import '../../core/dates.dart';
import '../../core/money.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../widgets.dart';

const _toggles = [
  ('overspendAlerts', 'Avisar quando eu estourar', 'Um toque quando uma categoria passa da média'),
  ('weeklySummary', 'Resumo toda segunda', 'Quanto gastei na semana, em uma frase'),
  ('roundCents', 'Arredondar centavos', 'Mostra R\$ 214 no lugar de R\$ 214,90'),
  ('showDailyAllowance', 'Mostrar quanto posso gastar por dia', 'O segundo cartão do resumo do mês'),
  ('autoDarkMode', 'Modo noturno automático', 'Acompanha o sistema à noite'),
];

/// Entradas fixas, categorias, saldo futuro, preferências e conta.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsProvider);
    Future<void> reload() {
      ref
        ..invalidate(incomesProvider)
        ..invalidate(categoriesProvider);
      return ref.refresh(settingsProvider.future).then((_) {});
    }

    return PageBody(
      onRefresh: reload,
      children: [
        const MoreTabs(current: '/ajustes'),
        AsyncBody<Settings>(
          value: settings,
          onRetry: reload,
          builder: (data) => Column(
            children: [
              const _IncomesCard(),
              gap14,
              const _CategoriesCard(),
              gap14,
              _OpeningBalanceCard(key: ValueKey('${data.openingDate}-${data.openingBalanceCents}'), settings: data),
              gap14,
              _PreferencesCard(settings: data),
              gap14,
              const _AccountCard(),
            ],
          ),
        ),
      ],
    );
  }
}

/* ───────────────────────────── Entradas fixas ───────────────────────── */

class _IncomesCard extends ConsumerStatefulWidget {
  const _IncomesCard();

  @override
  ConsumerState<_IncomesCard> createState() => _IncomesCardState();
}

class _IncomesCardState extends ConsumerState<_IncomesCard> {
  bool _formOpen = false;
  bool _busy = false;
  final _name = TextEditingController();
  final _value = TextEditingController();
  final _day = TextEditingController(text: '5');

  @override
  void dispose() {
    for (final controller in [_name, _value, _day]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _create() async {
    final name = _name.text.trim();
    final cents = parseBRLToCents(_value.text);
    final day = int.tryParse(_day.text.trim());
    String? problem;
    if (name.length < 2) problem = 'Informe pelo menos 2 caracteres.';
    if (cents == null || cents <= 0) problem ??= 'O valor precisa ser maior que zero.';
    if (day == null || day < 1 || day > 31) problem ??= 'O dia precisa estar entre 1 e 31.';
    if (problem != null) {
      showToast(context, problem, error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).createIncome(name: name, amountCents: cents!, receiptDay: day!);
      if (!mounted) return;
      showToast(context, 'Entrada cadastrada');
      for (final controller in [_name, _value]) {
        controller.clear();
      }
      setState(() => _formOpen = false);
      ref.invalidateMoney();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para cadastrar.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(Income income) async {
    final confirmed = await confirmDialog(
      context,
      title: 'Remover esta entrada?',
      description: 'Ela deixa de contar no cálculo do mês.',
      confirmLabel: 'Remover',
      destructive: true,
    );
    if (!confirmed) return;
    try {
      await ref.read(granaApiProvider).deleteIncome(income.id);
      if (!mounted) return;
      showToast(context, 'Entrada removida');
      ref.invalidateMoney();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para remover.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final incomes = ref.watch(incomesProvider).value ?? const <Income>[];
    return GranaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(title: 'Suas entradas fixas', aside: Text('${incomes.length} cadastradas')),
          const SizedBox(height: 4),
          for (var i = 0; i < incomes.length; i++)
            ListRow(
              last: i == incomes.length - 1,
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(incomes[i].name, style: body(weight: FontWeight.w500)),
                        Text('todo dia ${incomes[i].receiptDay}', style: body(size: 11.5, color: GranaColors.muted)),
                      ],
                    ),
                  ),
                  MoneyText(incomes[i].amountCents, style: display()),
                  DeleteIconButton(tooltip: 'Remover ${incomes[i].name}', onPressed: () => _delete(incomes[i])),
                ],
              ),
            ),
          gap8,
          LinkText(_formOpen ? 'fechar' : '+ nova entrada', onTap: () => setState(() => _formOpen = !_formOpen)),
          if (_formOpen) ...[
            gap12,
            LabeledField(label: 'Nome', child: GranaInput(controller: _name, hint: 'Salário')),
            gap12,
            Row(
              children: [
                Expanded(
                  child: LabeledField(
                    label: 'Valor (R\$)',
                    child: GranaInput(controller: _value, hint: '4200,00', keyboard: GranaInput.money),
                  ),
                ),
                const SizedBox(width: 12),
                SizedBox(width: 96, child: LabeledField(label: 'Dia', child: GranaInput(controller: _day, keyboard: GranaInput.number))),
              ],
            ),
            gap12,
            GranaButton(label: 'Cadastrar', fullWidth: true, loading: _busy, onPressed: _create),
          ],
        ],
      ),
    );
  }
}

/* ───────────────────────────── Categorias ───────────────────────────── */

class _CategoriesCard extends ConsumerStatefulWidget {
  const _CategoriesCard();

  @override
  ConsumerState<_CategoriesCard> createState() => _CategoriesCardState();
}

class _CategoriesCardState extends ConsumerState<_CategoriesCard> {
  bool _formOpen = false;
  bool _busy = false;
  String _kind = 'EXPENSE';
  final _name = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final name = _name.text.trim();
    if (name.length < 2) {
      showToast(context, 'Informe pelo menos 2 caracteres.', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).createCategory(name: name, kind: _kind);
      if (!mounted) return;
      showToast(context, 'Categoria cadastrada');
      _name.clear();
      setState(() => _formOpen = false);
      ref.invalidate(categoriesProvider);
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para cadastrar.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _archive(Category category) async {
    try {
      await ref.read(granaApiProvider).archiveCategory(category.id);
      if (!mounted) return;
      showToast(context, '${category.name} arquivada');
      ref.invalidate(categoriesProvider);
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para arquivar.');
    }
  }

  Future<void> _delete(Category category) async {
    final confirmed = await confirmDialog(
      context,
      title: 'Excluir esta categoria?',
      description: 'Só é possível excluir categorias sem nenhum lançamento ou conta usando elas.',
      confirmLabel: 'Excluir',
      destructive: true,
    );
    if (!confirmed) return;
    try {
      await ref.read(granaApiProvider).deleteCategory(category.id);
      if (!mounted) return;
      showToast(context, 'Categoria excluída');
      ref.invalidate(categoriesProvider);
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para excluir.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final categories = ref.watch(categoriesProvider).value ?? const <Category>[];
    return GranaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(title: 'Categorias', aside: Text('${categories.length} cadastradas')),
          const SizedBox(height: 4),
          for (var i = 0; i < categories.length; i++)
            ListRow(
              last: i == categories.length - 1,
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                children: [
                  ColorDot(categories[i].color),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(categories[i].name, overflow: TextOverflow.ellipsis, style: body(weight: FontWeight.w500)),
                        Text(
                          categories[i].isExpense ? 'despesa' : 'receita',
                          style: body(size: 11.5, color: GranaColors.muted),
                        ),
                      ],
                    ),
                  ),
                  TextButton(
                    onPressed: () => _archive(categories[i]),
                    child: Text('arquivar', style: body(size: 12.5, weight: FontWeight.w500, color: GranaColors.soft)),
                  ),
                  if (!categories[i].isSystem)
                    DeleteIconButton(tooltip: 'Excluir ${categories[i].name}', onPressed: () => _delete(categories[i])),
                ],
              ),
            ),
          gap8,
          LinkText(_formOpen ? 'fechar' : '+ nova categoria', onTap: () => setState(() => _formOpen = !_formOpen)),
          if (_formOpen) ...[
            gap12,
            LabeledField(label: 'Nome', child: GranaInput(controller: _name, hint: 'Farmácia', maxLength: 60)),
            gap12,
            LabeledField(
              label: 'Tipo',
              child: GranaSelect<String>(
                value: _kind,
                items: const [('EXPENSE', 'Despesa'), ('INCOME', 'Receita')],
                onChanged: (kind) => setState(() => _kind = kind ?? 'EXPENSE'),
              ),
            ),
            gap12,
            GranaButton(label: 'Cadastrar', fullWidth: true, loading: _busy, onPressed: _create),
          ],
        ],
      ),
    );
  }
}

/* ───────────────────────────── Saldo futuro ─────────────────────────── */

/// Ponto de partida do saldo futuro e o gasto médio usado na previsão.
class _OpeningBalanceCard extends ConsumerStatefulWidget {
  const _OpeningBalanceCard({super.key, required this.settings});

  final Settings settings;

  @override
  ConsumerState<_OpeningBalanceCard> createState() => _OpeningBalanceCardState();
}

class _OpeningBalanceCardState extends ConsumerState<_OpeningBalanceCard> {
  late final _balance = TextEditingController(text: centsToInput(widget.settings.openingBalanceCents));
  late final _average = TextEditingController(
    text: widget.settings.dailyBudgetCents == null ? '' : centsToInput(widget.settings.dailyBudgetCents!),
  );
  late String _date = widget.settings.openingDate ?? localTodayISO();
  bool _busy = false;

  @override
  void dispose() {
    _balance.dispose();
    _average.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.parse(_date),
      firstDate: DateTime(2000),
      lastDate: DateTime(now.year, now.month, now.day),
    );
    if (picked != null) setState(() => _date = localTodayISO(picked));
  }

  Future<void> _save() async {
    final balance = parseBRLToCents(_balance.text);
    final averageText = _average.text.trim();
    final average = averageText.isEmpty ? null : parseBRLToCents(averageText);
    if (balance == null || (averageText.isNotEmpty && average == null)) {
      showToast(context, 'Confira os valores — use o formato 1.250,00.', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).updateSettings({
        'openingBalanceCents': balance,
        'openingDate': _date,
        'dailyBudgetCents': average == null ? null : (average < 0 ? 0 : average),
      });
      if (!mounted) return;
      showToast(context, 'Saldo atualizado');
      ref
        ..invalidate(settingsProvider)
        ..invalidateMoney();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para salvar.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final openingDate = widget.settings.openingDate;
    return GranaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(
            title: 'Saldo futuro',
            aside: Text(openingDate == null ? 'não configurado' : 'desde ${fullDate(openingDate)}'),
          ),
          const SizedBox(height: 4),
          Text(
            'Tudo o que aconteceu antes dessa data já está dentro do saldo. Se o saldo do app se afastar do banco, '
            'informe o valor de hoje para recomeçar daqui.',
            style: body(size: 12.5, color: GranaColors.soft, height: 1.45),
          ),
          gap12,
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: LabeledField(
                  label: 'Saldo (R\$)',
                  child: GranaInput(controller: _balance, keyboard: GranaInput.money),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: LabeledField(
                  label: 'No início do dia',
                  child: GranaButton(
                    label: fullDate(_date),
                    variant: ButtonVariant.secondary,
                    fullWidth: true,
                    onPressed: _pickDate,
                  ),
                ),
              ),
            ],
          ),
          gap12,
          LabeledField(
            label: 'Gasto médio por dia (R\$)',
            hint: 'Deixe vazio para calcular pelos seus lançamentos dos últimos 90 dias. Ex.: ${formatMoney(5000)}.',
            child: GranaInput(controller: _average, hint: 'automático', keyboard: GranaInput.money),
          ),
          gap12,
          GranaButton(label: 'Salvar saldo', fullWidth: true, loading: _busy, onPressed: _save),
        ],
      ),
    );
  }
}

/* ──────────────────────────── Preferências ──────────────────────────── */

class _PreferencesCard extends ConsumerWidget {
  const _PreferencesCard({required this.settings});

  final Settings settings;

  @override
  Widget build(BuildContext context, WidgetRef ref) => GranaCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SectionHeader(title: 'Preferências'),
            const SizedBox(height: 4),
            for (var i = 0; i < _toggles.length; i++)
              ListRow(
                last: i == _toggles.length - 1,
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_toggles[i].$2, style: body(weight: FontWeight.w500)),
                          Text(_toggles[i].$3, style: body(size: 11.5, color: GranaColors.muted)),
                        ],
                      ),
                    ),
                    Switch(
                      value: settings.flag(_toggles[i].$1),
                      activeTrackColor: GranaColors.green,
                      inactiveTrackColor: GranaColors.chipStrong,
                      inactiveThumbColor: Colors.white,
                      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
                      onChanged: (value) async {
                        try {
                          await ref.read(granaApiProvider).updateSettings({_toggles[i].$1: value});
                          ref.invalidate(settingsProvider);
                        } catch (error) {
                          if (context.mounted) showErrorToast(context, error, 'Não deu para salvar.');
                        }
                      },
                    ),
                  ],
                ),
              ),
          ],
        ),
      );
}

/* ─────────────────────────────── Conta ──────────────────────────────── */

class _AccountCard extends ConsumerWidget {
  const _AccountCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).user;
    return GranaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(title: 'Conta'),
          gap8,
          Text(user?.name ?? '', style: body()),
          Text(user?.email ?? '', style: body(size: 11.5, color: GranaColors.muted)),
          if (user?.isAdmin ?? false) ...[
            gap8,
            Text(
              'A administração de usuários continua no site.',
              style: body(size: 11.5, color: GranaColors.muted),
            ),
          ],
          const SizedBox(height: 16),
          GranaButton(
            label: 'Trocar minha senha',
            variant: ButtonVariant.secondary,
            fullWidth: true,
            onPressed: () => context.push('/trocar-senha'),
          ),
          gap8,
          GranaButton(
            label: 'Sair',
            variant: ButtonVariant.ghost,
            fullWidth: true,
            onPressed: () => ref.read(sessionProvider.notifier).logout(),
          ),
        ],
      ),
    );
  }
}
