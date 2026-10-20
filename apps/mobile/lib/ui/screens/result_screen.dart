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
import '../widgets.dart';

const _monthsBack = 5;

/// Resultado de cada mês: entrou, saiu, guardou e o lucro ou prejuízo. O saldo
/// final de um mês é o inicial do seguinte.
class ResultScreen extends ConsumerWidget {
  const ResultScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = currentMonthRef();
    final range = (
      from: '${addMonths(current, -_monthsBack)}-01',
      to: lastDayOfMonthISO('${addMonths(current, 1)}-01'),
    );
    final cashflow = ref.watch(cashflowProvider(range));
    final hideCents = watchHideCents(ref);
    Future<void> reload() => ref.refresh(cashflowProvider(range).future).then((_) {});

    return PageBody(
      onRefresh: reload,
      children: [
        const MoreTabs(current: '/resultado'),
        AsyncBody<Cashflow>(
          value: cashflow,
          onRetry: reload,
          builder: (data) {
            if (!data.configured) {
              return const EmptyState(
                title: 'Informe seu saldo primeiro',
                description: 'Na tela inicial, diga quanto você tem hoje na conta para ver o resultado dos meses.',
              );
            }
            if (data.months.isEmpty) return const EmptyState(title: 'Ainda não há meses para mostrar');
            return Column(
              children: [
                for (final month in data.months.reversed)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: _MonthCard(month: month, current: current, hideCents: hideCents),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _MonthCard extends StatefulWidget {
  const _MonthCard({required this.month, required this.current, required this.hideCents});

  final CashflowMonth month;
  final String current;
  final bool hideCents;

  @override
  State<_MonthCard> createState() => _MonthCardState();
}

class _MonthCardState extends State<_MonthCard> {
  bool _saveOpen = false;

  @override
  Widget build(BuildContext context) {
    final month = widget.month;
    final hideCents = widget.hideCents;
    final status = month.closed ? 'fechado' : (month.month == widget.current ? 'em andamento' : 'previsto');
    final positive = month.resultCents >= 0;
    final leftover = math.max(0, month.resultCents - month.savedCents);
    final canSave = month.month.compareTo(widget.current) <= 0 && leftover > 0;

    Widget line(String label, int cents, {bool signed = false, Color color = GranaColors.ink, bool strong = false}) =>
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: body(size: 13, color: strong ? GranaColors.ink : GranaColors.muted, weight: strong ? FontWeight.w500 : FontWeight.w400),
                ),
              ),
              MoneyText(
                cents,
                hideCents: hideCents,
                signed: signed,
                style: strong ? display(size: 14, color: color) : body(size: 13, color: color),
              ),
            ],
          ),
        );

    return GranaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(month.label, style: display())),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: month.closed ? GranaColors.lineSoft : GranaColors.mint.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(status, style: body(size: 11, color: month.closed ? GranaColors.soft : GranaColors.green)),
              ),
            ],
          ),
          const SizedBox(height: 4),
          line('Começou com', month.openingCents),
          line('Entrou', month.inCents, signed: true, color: GranaColors.green),
          line('Saiu', -month.outCents),
          if (month.savedCents > 0) line('Guardado em metas', -month.savedCents),
          const Padding(padding: EdgeInsets.only(top: 8), child: Divider(height: 1, color: GranaColors.lineSoft)),
          line(
            positive ? 'Sobrou no mês' : 'Faltou no mês',
            month.resultCents,
            signed: true,
            strong: true,
            color: positive ? GranaColors.green : GranaColors.clay,
          ),
          line('Saldo no fim', month.closingCents),
          if (canSave) ...[
            const SizedBox(height: 10),
            LinkText(
              _saveOpen ? 'fechar' : 'guardar a sobra (${formatMoney(leftover, hideCents: hideCents)})',
              onTap: () => setState(() => _saveOpen = !_saveOpen),
            ),
            if (_saveOpen) _SaveLeftover(suggested: leftover, onDone: () => setState(() => _saveOpen = false)),
          ],
        ],
      ),
    );
  }
}

/// Manda parte da sobra para uma meta — o valor sai do saldo e entra no guardado.
class _SaveLeftover extends ConsumerStatefulWidget {
  const _SaveLeftover({required this.suggested, required this.onDone});

  final int suggested;
  final VoidCallback onDone;

  @override
  ConsumerState<_SaveLeftover> createState() => _SaveLeftoverState();
}

class _SaveLeftoverState extends ConsumerState<_SaveLeftover> {
  late final _value = TextEditingController(text: centsToInput(widget.suggested));
  String? _goalId;
  bool _busy = false;

  @override
  void dispose() {
    _value.dispose();
    super.dispose();
  }

  Future<void> _save(String? goalId) async {
    final cents = parseBRLToCents(_value.text);
    if (cents == null || cents <= 0 || goalId == null) {
      showToast(context, 'Escolha a meta e o valor.', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).depositToGoal(goalId, cents);
      if (!mounted) return;
      showToast(context, '${formatMoney(cents)} guardados');
      ref.invalidateMoney();
      widget.onDone();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para guardar.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final goals = ref.watch(goalsProvider).value;
    if (goals != null && goals.isEmpty) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text('Crie uma meta em ', style: body(size: 13, color: GranaColors.soft)),
            LinkText('Guardar', onTap: () => context.go('/guardar')),
            Text(' para mandar a sobra para lá.', style: body(size: 13, color: GranaColors.soft)),
          ],
        ),
      );
    }
    final selected = _goalId ?? goals?.firstOrNull?.id;

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        children: [
          GranaSelect<String>(
            value: selected,
            items: [for (final goal in goals ?? const <Goal>[]) (goal.id, goal.name)],
            onChanged: (id) => setState(() => _goalId = id),
          ),
          gap8,
          Row(
            children: [
              Expanded(child: GranaInput(controller: _value, keyboard: GranaInput.money)),
              const SizedBox(width: 8),
              GranaButton(label: 'Guardar', loading: _busy, onPressed: () => _save(selected)),
            ],
          ),
        ],
      ),
    );
  }
}
