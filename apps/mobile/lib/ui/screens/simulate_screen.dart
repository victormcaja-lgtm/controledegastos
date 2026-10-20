import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/queries.dart';
import '../../application/session.dart';
import '../../core/dates.dart';
import '../../core/money.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../balance_chart.dart';
import '../widgets.dart';

/// "Posso comprar?": mostra o impacto de uma compra no saldo ANTES de ela
/// acontecer — o menor saldo pela frente, com e sem a compra.
class SimulateScreen extends ConsumerStatefulWidget {
  const SimulateScreen({super.key});

  @override
  ConsumerState<SimulateScreen> createState() => _SimulateScreenState();
}

class _SimulateScreenState extends ConsumerState<SimulateScreen> {
  final _value = TextEditingController();
  final _note = TextEditingController();
  int _installments = 1;
  String _method = 'ACCOUNT';
  String? _cardId;
  late String _date = localTodayISO();
  String? _categoryId;
  SimulationResult? _result;
  bool _simulating = false;
  bool _registering = false;

  @override
  void dispose() {
    _value.dispose();
    _note.dispose();
    super.dispose();
  }

  void _changed(VoidCallback update) => setState(() {
        update();
        _result = null;
      });

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.parse(_date),
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: DateTime(2100),
    );
    if (picked != null) _changed(() => _date = localTodayISO(picked));
  }

  Future<void> _run() async {
    final today = localTodayISO();
    final amount = parseBRLToCents(_value.text);
    if (amount == null || amount <= 0) {
      showToast(context, 'Digite o valor da compra.', error: true);
      return;
    }
    if (_method == 'CARD' && _cardId == null) {
      showToast(context, 'Escolha o cartão.', error: true);
      return;
    }
    // Parcelado vai longe: mostra pelo menos até a última parcela (limite da API: 400 dias).
    final horizon = math.min(395, math.max(90, _installments * 31 + 40));
    setState(() => _simulating = true);
    try {
      final result = await ref.read(granaApiProvider).simulate(
            from: today,
            to: addDaysISO(today, horizon),
            today: today,
            amountCents: amount,
            installments: _installments,
            date: _date,
            method: _method,
            cardId: _method == 'CARD' ? _cardId : null,
          );
      if (mounted) setState(() => _result = result);
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para simular.');
    } finally {
      if (mounted) setState(() => _simulating = false);
    }
  }

  Future<void> _confirm(String? categoryId) async {
    final amount = parseBRLToCents(_value.text);
    if (amount == null || categoryId == null) return;
    final api = ref.read(granaApiProvider);
    setState(() => _registering = true);
    try {
      if (_method == 'CARD' && _cardId != null) {
        await api.createCardPurchase(
          _cardId!,
          amountCents: amount,
          installments: _installments,
          purchasedOn: _date,
          categoryId: categoryId,
          note: _note.text,
        );
      } else {
        await api.createTransaction(
          type: 'EXPENSE',
          amountCents: amount,
          categoryId: categoryId,
          occurredOn: _date,
          note: _note.text,
        );
      }
      if (!mounted) return;
      showToast(context, 'Compra de ${formatMoney(amount)} registrada');
      ref.invalidateMoney();
      context.go('/');
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para registrar.');
    } finally {
      if (mounted) setState(() => _registering = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final today = localTodayISO();
    final hideCents = watchHideCents(ref);
    final activeCards = (ref.watch(cardsProvider).value ?? const <CreditCard>[]).where((c) => c.active).toList();
    final categories = (ref.watch(categoriesProvider).value ?? const <Category>[])
        .where((c) => c.isExpense && !c.archived)
        .toList();
    final selectedCategory = _categoryId ?? categories.firstOrNull?.id;
    final result = _result;
    final canConfirm = _method == 'CARD' || _installments == 1;

    return PageBody(
      children: [
        const PageTitle('Posso comprar?'),
        Transform.translate(
          offset: const Offset(0, -10),
          child: Text(
            'Veja como a compra mexe no seu saldo antes de passar o cartão.',
            style: body(size: 13, color: GranaColors.soft),
          ),
        ),
        GranaCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: LabeledField(
                      label: 'Valor (R\$)',
                      child: GranaInput(
                        controller: _value,
                        hint: '1.200,00',
                        keyboard: GranaInput.money,
                        onChanged: (_) => _changed(() {}),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  _Stepper(
                    value: _installments,
                    onChanged: (value) => _changed(() => _installments = value),
                  ),
                ],
              ),
              gap12,
              Text('Pagar com', style: body(size: 13, weight: FontWeight.w500, color: GranaColors.soft)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  GranaChip(
                    label: 'Conta / Pix',
                    selected: _method == 'ACCOUNT',
                    onTap: () => _changed(() => _method = 'ACCOUNT'),
                  ),
                  for (final card in activeCards)
                    GranaChip(
                      label: card.name,
                      selected: _method == 'CARD' && _cardId == card.id,
                      onTap: () => _changed(() {
                        _method = 'CARD';
                        _cardId = card.id;
                      }),
                    ),
                  GranaChip(label: '+ cartão', dashed: true, onTap: () => context.go('/cartoes')),
                ],
              ),
              gap12,
              LabeledField(
                label: 'Quando',
                child: GranaButton(
                  label: dayLabel(_date, today) == 'Hoje' ? 'Hoje (${fullDate(_date)})' : fullDate(_date),
                  variant: ButtonVariant.secondary,
                  fullWidth: true,
                  onPressed: _pickDate,
                ),
              ),
              gap12,
              GranaButton(label: 'Simular', fullWidth: true, loading: _simulating, onPressed: _run),
            ],
          ),
        ),
        if (result != null) ...[
          gap14,
          GranaCard(
            borderColor: result.fits ? GranaColors.green.withValues(alpha: 0.4) : GranaColors.clay.withValues(alpha: 0.5),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  result.fits ? 'Cabe no seu saldo' : 'Vai apertar',
                  style: display(size: 17, color: result.fits ? GranaColors.green : GranaColors.clay),
                ),
                const SizedBox(height: 6),
                Text(result.verdict, style: body(size: 13, color: GranaColors.soft, height: 1.45)),
                BalanceChart(
                  days: [for (final d in result.before.days) (date: d.date, balanceCents: d.balanceCents)],
                  compare: [for (final d in result.after.days) (date: d.date, balanceCents: d.balanceCents)],
                  today: today,
                  highlight: result.after.lowest,
                ),
                gap8,
                Row(
                  children: [
                    _legend(GranaColors.green, 'sem a compra'),
                    const SizedBox(width: 16),
                    _legend(GranaColors.clay, 'com a compra'),
                  ],
                ),
              ],
            ),
          ),
          gap14,
          Row(
            children: [
              StatCard(
                label: 'Menor saldo hoje',
                cents: result.before.lowest?.balanceCents ?? result.before.todayBalanceCents,
                hideCents: hideCents,
              ),
              const SizedBox(width: 12),
              StatCard(
                label: result.after.lowest != null
                    ? 'Com a compra (${shortDate(result.after.lowest!.date)})'
                    : 'Com a compra',
                cents: result.after.lowest?.balanceCents ?? result.after.todayBalanceCents,
                hideCents: hideCents,
              ),
            ],
          ),
          gap14,
          GranaCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeader(title: 'Vai comprar?'),
                gap12,
                if (canConfirm) ...[
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final category in categories)
                        GranaChip(
                          label: category.name,
                          dotColor: category.color,
                          selected: category.id == selectedCategory,
                          onTap: () => setState(() => _categoryId = category.id),
                        ),
                    ],
                  ),
                  gap12,
                  GranaInput(controller: _note, hint: 'O que é? (opcional)', maxLength: 140),
                  gap12,
                  GranaButton(
                    label: 'Registrar compra',
                    fullWidth: true,
                    loading: _registering,
                    onPressed: () => _confirm(selectedCategory),
                  ),
                ] else
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text('Parcelado no boleto ou carnê? Cadastre em ', style: body(size: 13, color: GranaColors.soft)),
                      LinkText('Contas', onTap: () => context.go('/contas')),
                      Text(' como conta fixa com $_installments parcelas.', style: body(size: 13, color: GranaColors.soft)),
                    ],
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _legend(Color color, String label) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 16, height: 2, color: color),
          const SizedBox(width: 6),
          Text(label, style: body(size: 11.5, color: GranaColors.muted)),
        ],
      );
}

class _Stepper extends StatelessWidget {
  const _Stepper({required this.value, required this.onChanged});

  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Parcelas', style: body(size: 13, weight: FontWeight.w500, color: GranaColors.soft)),
          const SizedBox(height: 6),
          Container(
            height: 46,
            decoration: BoxDecoration(
              color: GranaColors.card,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: GranaColors.line),
            ),
            child: Row(
              children: [
                IconButton(
                  tooltip: 'Menos parcelas',
                  visualDensity: VisualDensity.compact,
                  onPressed: value > 1 ? () => onChanged(value - 1) : null,
                  icon: const Icon(Icons.remove, size: 18),
                ),
                SizedBox(width: 30, child: Text('${value}x', textAlign: TextAlign.center, style: display(size: 14))),
                IconButton(
                  tooltip: 'Mais parcelas',
                  visualDensity: VisualDensity.compact,
                  onPressed: value < 48 ? () => onChanged(value + 1) : null,
                  icon: const Icon(Icons.add, size: 18),
                ),
              ],
            ),
          ),
        ],
      );
}
