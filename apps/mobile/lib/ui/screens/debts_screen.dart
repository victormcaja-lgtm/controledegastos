import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/queries.dart';
import '../../application/session.dart';
import '../../core/money.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../widgets.dart';

/// Dívidas parceladas e a projeção dos próximos 6 meses.
class DebtsScreen extends ConsumerStatefulWidget {
  const DebtsScreen({super.key});

  @override
  ConsumerState<DebtsScreen> createState() => _DebtsScreenState();
}

class _DebtsScreenState extends ConsumerState<DebtsScreen> {
  bool _formOpen = false;
  String? _converting;

  Future<void> _setPaid(Debt debt, int paid, {String? toast}) async {
    try {
      await ref.read(granaApiProvider).setDebtPaidInstallments(debt.id, paid);
      if (!mounted) return;
      if (toast != null) showToast(context, toast);
      ref.invalidate(debtsProvider);
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para salvar.');
    }
  }

  Future<void> _delete(Debt debt) async {
    final confirmed = await confirmDialog(context, title: 'Excluir esta dívida?', confirmLabel: 'Excluir', destructive: true);
    if (!confirmed) return;
    try {
      await ref.read(granaApiProvider).deleteDebt(debt.id);
      if (!mounted) return;
      showToast(context, 'Dívida removida');
      ref.invalidate(debtsProvider);
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para excluir.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final debts = ref.watch(debtsProvider);
    Future<void> reload() => ref.refresh(debtsProvider.future).then((_) {});

    return PageBody(
      onRefresh: reload,
      children: [
        const MoreTabs(current: '/parcelas'),
        AsyncBody<DebtOverview>(value: debts, onRetry: reload, builder: _content),
      ],
    );
  }

  Widget _content(DebtOverview data) {
    final maxProjection = math.max(data.projection.fold<int>(1, (m, e) => math.max(m, e.totalCents)), 1);

    return Column(
      children: [
        if (data.debts.any((debt) => !debt.settled)) ...[
          GranaCard(
            borderColor: GranaColors.green.withValues(alpha: 0.4),
            child: Text.rich(
              TextSpan(
                style: body(size: 13, color: GranaColors.soft, height: 1.45),
                children: [
                  TextSpan(text: 'Novidade: ', style: body(size: 13, weight: FontWeight.w600)),
                  const TextSpan(
                    text: 'parcelas agora podem virar contas fixas com prazo. Assim elas entram no seu saldo futuro, '
                        'com aviso de atraso. Use ',
                  ),
                  const TextSpan(text: 'mover para Contas', style: TextStyle(fontStyle: FontStyle.italic)),
                  const TextSpan(text: ' em cada uma. Compras parceladas no cartão ficam em '),
                  const TextSpan(text: 'Cartões', style: TextStyle(fontStyle: FontStyle.italic)),
                  const TextSpan(text: '.'),
                ],
              ),
            ),
          ),
          gap14,
        ],
        GranaCard(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Por mês em parcelas', style: body(size: 13, color: GranaColors.muted)),
              const SizedBox(height: 4),
              MoneyText(data.monthlyTotalCents, style: display(size: 32, weight: FontWeight.w700, letterSpacing: -1)),
              const SizedBox(height: 20),
              SizedBox(
                height: 116,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    for (var i = 0; i < data.projection.length; i++)
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 5),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              Text(
                                data.projection[i].totalCents > 0 ? formatCompact(data.projection[i].totalCents) : '—',
                                style: body(size: 11, color: GranaColors.muted),
                              ),
                              const SizedBox(height: 6),
                              Container(
                                height: math.max(6, data.projection[i].totalCents / maxProjection * 62),
                                decoration: BoxDecoration(
                                  color: i == 0 ? GranaColors.ink : GranaColors.pebble,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(data.projection[i].label, style: display(size: 11, weight: FontWeight.w400, color: GranaColors.soft)),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Text(data.note, style: body(size: 12.5, color: GranaColors.soft, height: 1.45)),
            ],
          ),
        ),
        gap14,
        GranaCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SectionHeader(
                title: 'Suas parcelas',
                aside: LinkText(_formOpen ? 'fechar' : '+ nova', size: 12, onTap: () => setState(() => _formOpen = !_formOpen)),
              ),
              if (_formOpen) _NewDebtForm(onDone: () => setState(() => _formOpen = false)),
              if (data.debts.isEmpty)
                const EmptyState(title: 'Nenhuma parcela cadastrada', description: 'Ótimo sinal. 👏')
              else
                for (final debt in data.debts) _debtItem(debt),
            ],
          ),
        ),
      ],
    );
  }

  Widget _debtItem(Debt debt) => Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(debt.name, style: body(weight: FontWeight.w500))),
                MoneyText(debt.installmentCents, style: display()),
                DeleteIconButton(tooltip: 'Excluir ${debt.name}', onPressed: () => _delete(debt)),
              ],
            ),
            const SizedBox(height: 4),
            ProgressLine(percent: debt.progressPercent, height: 6, color: GranaColors.green),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'parcela ${debt.paidInstallments} de ${debt.totalInstallments}',
                    style: body(size: 11.5, color: GranaColors.muted),
                  ),
                ),
                Text('faltam ${formatMoney(debt.remainingCents)}', style: body(size: 11.5, color: GranaColors.muted)),
              ],
            ),
            gap8,
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                GranaButton(
                  label: '+ paguei uma',
                  size: ButtonSize.sm,
                  variant: ButtonVariant.secondary,
                  onPressed: debt.paidInstallments >= debt.totalInstallments
                      ? null
                      : () => _setPaid(debt, debt.paidInstallments + 1, toast: 'Parcela marcada como paga'),
                ),
                if (!debt.settled)
                  GranaButton(
                    label: 'mover para Contas',
                    size: ButtonSize.sm,
                    variant: ButtonVariant.ghost,
                    onPressed: () => setState(() => _converting = _converting == debt.id ? null : debt.id),
                  ),
                if (debt.paidInstallments > 0)
                  GranaButton(
                    label: 'desfazer',
                    size: ButtonSize.sm,
                    variant: ButtonVariant.ghost,
                    onPressed: () => _setPaid(debt, debt.paidInstallments - 1),
                  ),
              ],
            ),
            if (_converting == debt.id) _ConvertDebtForm(debt: debt, onDone: () => setState(() => _converting = null)),
          ],
        ),
      );
}

class _NewDebtForm extends ConsumerStatefulWidget {
  const _NewDebtForm({required this.onDone});

  final VoidCallback onDone;

  @override
  ConsumerState<_NewDebtForm> createState() => _NewDebtFormState();
}

class _NewDebtFormState extends ConsumerState<_NewDebtForm> {
  final _name = TextEditingController();
  final _value = TextEditingController();
  final _paid = TextEditingController(text: '0');
  final _total = TextEditingController(text: '12');
  bool _busy = false;

  @override
  void dispose() {
    for (final controller in [_name, _value, _paid, _total]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final cents = parseBRLToCents(_value.text);
    final paid = int.tryParse(_paid.text.trim());
    final total = int.tryParse(_total.text.trim());
    String? problem;
    if (name.length < 2) problem = 'Informe o nome.';
    if (cents == null || cents <= 0) problem ??= 'O valor precisa ser maior que zero.';
    if (total == null || total < 1 || total > 600 || paid == null || paid < 0) problem ??= 'Confira as parcelas.';
    if (problem == null && paid! > total!) problem = 'Parcelas pagas não podem passar do total.';
    if (problem != null) {
      showToast(context, problem, error: true);
      return;
    }

    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).createDebt(
            name: name,
            installmentCents: cents!,
            paidInstallments: paid!,
            totalInstallments: total!,
          );
      if (!mounted) return;
      showToast(context, 'Dívida cadastrada');
      ref.invalidate(debtsProvider);
      widget.onDone();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para cadastrar.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Column(
          children: [
            LabeledField(label: 'Nome', child: GranaInput(controller: _name, hint: 'Cartão parcelado')),
            gap12,
            Row(
              children: [
                Expanded(
                  child: LabeledField(
                    label: 'Parcela (R\$)',
                    child: GranaInput(controller: _value, hint: '430,00', keyboard: GranaInput.money),
                  ),
                ),
                const SizedBox(width: 12),
                SizedBox(width: 80, child: LabeledField(label: 'Pagas', child: GranaInput(controller: _paid, keyboard: GranaInput.number))),
                const SizedBox(width: 12),
                SizedBox(width: 80, child: LabeledField(label: 'Total', child: GranaInput(controller: _total, keyboard: GranaInput.number))),
              ],
            ),
            gap12,
            GranaButton(label: 'Cadastrar', fullWidth: true, loading: _busy, onPressed: _submit),
          ],
        ),
      );
}

/// Leva as parcelas que faltam para uma conta fixa com prazo.
class _ConvertDebtForm extends ConsumerStatefulWidget {
  const _ConvertDebtForm({required this.debt, required this.onDone});

  final Debt debt;
  final VoidCallback onDone;

  @override
  ConsumerState<_ConvertDebtForm> createState() => _ConvertDebtFormState();
}

class _ConvertDebtFormState extends ConsumerState<_ConvertDebtForm> {
  final _dueDay = TextEditingController(text: '10');
  String? _categoryId;
  bool _busy = false;

  @override
  void dispose() {
    _dueDay.dispose();
    super.dispose();
  }

  Future<void> _submit(String? categoryId) async {
    final debt = widget.debt;
    if (categoryId == null) {
      showToast(context, 'Crie uma categoria de despesa primeiro.', error: true);
      return;
    }
    final dueDay = (int.tryParse(_dueDay.text.trim()) ?? 1).clamp(1, 31);
    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).convertDebt(debt.id, categoryId: categoryId, dueDay: dueDay);
      if (!mounted) return;
      showToast(context, '${debt.name} agora está em Contas, com ${debt.remainingInstallments} parcelas');
      ref.invalidateMoney();
      widget.onDone();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para mover.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final debt = widget.debt;
    final categories = (ref.watch(categoriesProvider).value ?? const <Category>[])
        .where((c) => c.isExpense && !c.archived)
        .toList();
    final selected = _categoryId ?? categories.firstOrNull?.id;

    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: GranaColors.lineSoft, borderRadius: BorderRadius.circular(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Vira uma conta fixa de ${formatMoney(debt.installmentCents)} com ${debt.remainingInstallments} parcelas, '
            'começando neste mês.',
            style: body(size: 12.5, color: GranaColors.soft),
          ),
          gap12,
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: LabeledField(
                  label: 'Categoria',
                  child: GranaSelect<String>(
                    value: selected,
                    items: [for (final c in categories) (c.id, c.name)],
                    onChanged: (id) => setState(() => _categoryId = id),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 90,
                child: LabeledField(label: 'Vence dia', child: GranaInput(controller: _dueDay, keyboard: GranaInput.number)),
              ),
            ],
          ),
          gap12,
          GranaButton(label: 'Mover para Contas', size: ButtonSize.sm, loading: _busy, onPressed: () => _submit(selected)),
        ],
      ),
    );
  }
}
