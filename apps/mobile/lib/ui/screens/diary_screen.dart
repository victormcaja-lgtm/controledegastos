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

const _step = 30;
// A API aceita até 400 dias por consulta: 300 para trás + 90 para frente.
const _maxPast = 300;
const _maxAhead = 90;

const _kindLabel = {
  'INCOME': 'entrada fixa',
  'BILL': 'conta fixa',
  'BILL_OVERDUE': 'em atraso',
  'CARD_INVOICE': 'fatura',
  'GOAL_DEPOSIT': 'meta',
};

/// Diário: o dinheiro dia a dia, com o saldo ao fim de cada dia. O que vem
/// por aí em cima, hoje no meio, o que já aconteceu embaixo.
class DiaryScreen extends ConsumerStatefulWidget {
  const DiaryScreen({super.key});

  @override
  ConsumerState<DiaryScreen> createState() => _DiaryScreenState();
}

class _DiaryScreenState extends ConsumerState<DiaryScreen> {
  int _pastDays = _step;
  int _aheadDays = _step;
  Cashflow? _lastData;

  Future<void> _delete(String transactionId) async {
    final confirmed = await confirmDialog(
      context,
      title: 'Apagar este lançamento?',
      description: 'Ele sai do saldo e dos relatórios. Não dá para desfazer.',
      confirmLabel: 'Apagar',
      destructive: true,
    );
    if (!confirmed) return;
    try {
      await ref.read(granaApiProvider).deleteTransaction(transactionId);
      if (!mounted) return;
      showToast(context, 'Lançamento apagado');
      ref.invalidateMoney();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para apagar.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final today = localTodayISO();
    final range = (from: addDaysISO(today, -_pastDays), to: addDaysISO(today, _aheadDays));
    final value = ref.watch(cashflowProvider(range));
    final hideCents = watchHideCents(ref);
    // Ao pedir mais dias, mantém a tela anterior enquanto carrega.
    final data = value.value ?? _lastData;
    if (value.value != null) _lastData = value.value;
    final loadingMore = value.isLoading && _lastData != null;

    Future<void> reload() => ref.refresh(cashflowProvider(range).future).then((_) {});

    return PageBody(
      onRefresh: reload,
      children: [
        PageTitle(
          'Diário',
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              LinkText('lista do mês', onTap: () => context.push('/lista')),
              const SizedBox(width: 12),
              LinkText('+ lançar', onTap: () => context.push('/lancar')),
            ],
          ),
        ),
        if (data == null)
          AsyncBody<Cashflow>(value: value, onRetry: reload, builder: (_) => const SizedBox.shrink())
        else if (!data.configured)
          const EmptyState(
            title: 'Informe seu saldo primeiro',
            description: 'Na tela inicial, diga quanto você tem hoje na conta para o diário começar.',
          )
        else
          ..._content(data, today, hideCents, loadingMore),
      ],
    );
  }

  List<Widget> _content(Cashflow data, String today, bool hideCents, bool loadingMore) {
    final todayDay = data.days.where((day) => day.date == today).firstOrNull;
    final ahead = data.days
        .where((day) => day.date.compareTo(today) > 0 && day.events.any((e) => e.kind != 'DAILY_AVERAGE'))
        .toList();
    final past = data.days.where((day) => day.date.compareTo(today) < 0 && day.events.isNotEmpty).toList()
      ..sort((a, b) => b.date.compareTo(a.date));
    final reachedOpening = data.openingDate != null && data.days.firstOrNull?.date == data.openingDate;

    return [
      if (data.dailyAverageCents > 0)
        Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: Text(
            'Os dias à frente já descontam o gasto médio de ${formatMoney(data.dailyAverageCents, hideCents: hideCents)} por dia.',
            style: body(size: 12, color: GranaColors.muted),
          ),
        ),
      _Section(
        title: 'Vem por aí',
        children: [
          if (ahead.isEmpty) _muted('Nada previsto no período.'),
          for (final day in ahead) _DayCard(day: day, today: today, hideCents: hideCents),
          if (_aheadDays < _maxAhead)
            GranaButton(
              label: 'ver mais à frente',
              variant: ButtonVariant.ghost,
              size: ButtonSize.sm,
              loading: loadingMore,
              onPressed: () => setState(() => _aheadDays = math.min(_aheadDays + _step, _maxAhead)),
            ),
        ],
      ),
      if (todayDay != null)
        _DayCard(day: todayDay, today: today, hideCents: hideCents, highlight: true, onDelete: _delete),
      _Section(
        title: 'Já aconteceu',
        children: [
          if (past.isEmpty) _muted('Nenhum lançamento no período.'),
          for (final day in past) _DayCard(day: day, today: today, hideCents: hideCents, onDelete: _delete),
          if (!reachedOpening && _pastDays < _maxPast)
            GranaButton(
              label: 'carregar dias anteriores',
              variant: ButtonVariant.ghost,
              size: ButtonSize.sm,
              loading: loadingMore,
              onPressed: () => setState(() => _pastDays = math.min(_pastDays + _step, _maxPast)),
            ),
        ],
      ),
    ];
  }

  Widget _muted(String text) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Text(text, style: body(size: 13, color: GranaColors.muted)),
      );
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text(
                title.toUpperCase(),
                style: body(size: 12, weight: FontWeight.w600, color: GranaColors.muted).copyWith(letterSpacing: 0.6),
              ),
            ),
            for (final child in children) Padding(padding: const EdgeInsets.only(top: 12), child: child),
          ],
        ),
      );
}

class _DayCard extends StatelessWidget {
  const _DayCard({required this.day, required this.today, required this.hideCents, this.highlight = false, this.onDelete});

  final CashflowDay day;
  final String today;
  final bool hideCents;
  final bool highlight;
  final void Function(String transactionId)? onDelete;

  @override
  Widget build(BuildContext context) {
    final events = day.events.where((event) => event.kind != 'DAILY_AVERAGE').toList();
    final negative = day.balanceCents < 0;

    return Opacity(
      opacity: day.projected ? 0.8 : 1,
      child: GranaCard(
        borderColor: highlight ? GranaColors.ink : null,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Expanded(child: Text(dayLabel(day.date, today), style: display(size: 14))),
                Text('saldo ', style: body(size: 11.5, color: GranaColors.muted)),
                MoneyText(
                  day.balanceCents,
                  hideCents: hideCents,
                  style: body(size: 11.5, weight: FontWeight.w600, color: negative ? GranaColors.clay : GranaColors.ink),
                ),
              ],
            ),
            if (events.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('Nada lançado hoje ainda.', style: body(size: 12.5, color: GranaColors.muted)),
              )
            else
              for (var i = 0; i < events.length; i++) _eventRow(events[i], i == events.length - 1),
          ],
        ),
      ),
    );
  }

  Widget _eventRow(CashflowEvent event, bool last) {
    final income = event.amountCents > 0;
    final kind = _kindLabel[event.kind];
    final canDelete = onDelete != null && event.kind == 'TRANSACTION' && event.refId != null;
    return ListRow(
      last: last,
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  event.label,
                  overflow: TextOverflow.ellipsis,
                  style: body(
                    weight: FontWeight.w500,
                    color: event.kind == 'BILL_OVERDUE' ? GranaColors.clay : GranaColors.ink,
                  ),
                ),
                Text(
                  '${event.projected ? 'previsto' : 'realizado'}${kind == null ? '' : ' · $kind'}',
                  style: body(size: 11, color: GranaColors.muted),
                ),
              ],
            ),
          ),
          MoneyText(
            event.amountCents,
            hideCents: hideCents,
            signed: income,
            style: display(color: income ? GranaColors.green : GranaColors.ink),
          ),
          if (canDelete) DeleteIconButton(tooltip: 'Apagar ${event.label}', onPressed: () => onDelete!(event.refId!)),
        ],
      ),
    );
  }
}
