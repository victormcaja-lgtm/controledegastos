import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/queries.dart';
import '../../core/dates.dart';
import '../../core/money.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../widgets.dart';

/// Resumo do mês ("Deve sobrar no fim do mês") — a Home antiga do site, em /mes.
class MonthScreen extends ConsumerStatefulWidget {
  const MonthScreen({super.key});

  @override
  ConsumerState<MonthScreen> createState() => _MonthScreenState();
}

class _MonthScreenState extends ConsumerState<MonthScreen> {
  String _month = currentMonthRef();

  @override
  Widget build(BuildContext context) {
    final summary = ref.watch(dashboardProvider(_month));
    final settings = ref.watch(settingsProvider).value;
    final hideCents = settings?.roundCents ?? false;
    Future<void> reload() => ref.refresh(dashboardProvider(_month).future).then((_) {});

    return Scaffold(
      appBar: AppBar(backgroundColor: GranaColors.cream, title: Text('Resumo do mês', style: display(size: 17))),
      body: PageBody(
        onRefresh: reload,
        children: [
          MonthSwitcher(
            month: _month,
            onChange: (m) => setState(() => _month = m),
            subtitle: summary.value == null ? null : (summary.value!.isCurrentMonth ? 'mês atual' : 'previsão'),
          ),
          AsyncBody<DashboardSummary>(
            value: summary,
            onRetry: reload,
            builder: (data) => _content(data, hideCents, settings?.showDailyAllowance ?? true),
          ),
        ],
      ),
    );
  }

  Widget _content(DashboardSummary data, bool hideCents, bool showDailyAllowance) {
    final negative = data.leftoverCents < 0;
    return Column(
      children: [
        GranaCard(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Deve sobrar no fim do mês', style: body(size: 13, color: GranaColors.muted)),
              const SizedBox(height: 6),
              FittedBox(
                fit: BoxFit.scaleDown,
                child: MoneyText(
                  data.leftoverCents,
                  hideCents: hideCents,
                  style: display(size: 44, weight: FontWeight.w700, letterSpacing: -1.5, height: 1.05),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                negative
                    ? 'Atenção: as contas passam o que entra.'
                    : data.isCurrentMonth
                        ? 'Depois de pagar tudo que já está previsto.'
                        : 'Previsão com as fixas + sua média de gastos.',
                style: body(size: 13, color: negative ? GranaColors.clay : GranaColors.green),
              ),
              const SizedBox(height: 18),
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: Container(
                  height: 10,
                  color: GranaColors.lineSoft,
                  child: Row(
                    children: [
                      // Barra composta: já gastei / a pagar / sobra (cada trecho na sua proporção).
                      for (final (percent, color) in [
                        (data.spentPercent, GranaColors.ink),
                        (data.duePercent, GranaColors.stone),
                        (data.leftoverPercent, GranaColors.mint),
                      ])
                        if (percent > 0)
                          Expanded(flex: percent, child: Container(color: color, margin: const EdgeInsets.only(right: 2))),
                      if (_rest(data) > 0) Expanded(flex: _rest(data), child: const SizedBox()),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 14,
                runSpacing: 6,
                children: [
                  _legend(GranaColors.ink, 'Já gastei ', data.spentCents, hideCents),
                  _legend(GranaColors.stone, 'A pagar ', data.billsDueCents, hideCents),
                ],
              ),
            ],
          ),
        ),
        gap14,
        Row(
          children: [
            StatCard(label: 'Entrou', cents: data.incomeCents, hideCents: hideCents),
            const SizedBox(width: 12),
            showDailyAllowance
                ? StatCard(label: 'Pode gastar por dia', cents: data.dailyAllowanceCents, hideCents: hideCents)
                : const StatCard(label: 'Pode gastar por dia', cents: 0, muted: true),
          ],
        ),
        gap14,
        GranaCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionHeader(title: 'Suas semanas', aside: Text('gasto por semana')),
              _WeeklyChart(weeks: data.weeks),
              const SizedBox(height: 14),
              Text(data.weekNote, style: body(size: 12.5, color: GranaColors.soft, height: 1.45)),
            ],
          ),
        ),
        gap14,
        GranaCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SectionHeader(
                title: 'Vence em breve',
                aside: LinkText('ver tudo', size: 12, onTap: () => context.go('/contas')),
              ),
              if (data.upcomingBills.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text('Nenhuma conta em aberto neste mês. 🎉', style: body(size: 13, color: GranaColors.muted)),
                )
              else
                for (var i = 0; i < data.upcomingBills.length; i++)
                  ListRow(
                    last: i == data.upcomingBills.length - 1,
                    child: Row(
                      children: [
                        DateBadge(
                          day: data.upcomingBills[i].dueDay.toString().padLeft(2, '0'),
                          month: data.upcomingBills[i].dueDate.substring(5, 7),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(data.upcomingBills[i].name, style: body(weight: FontWeight.w500)),
                              Text(data.upcomingBills[i].whenLabel, style: body(size: 11.5, color: GranaColors.muted)),
                            ],
                          ),
                        ),
                        MoneyText(data.upcomingBills[i].amountCents, hideCents: hideCents, style: display()),
                      ],
                    ),
                  ),
            ],
          ),
        ),
      ],
    );
  }

  int _rest(DashboardSummary data) =>
      math.max(0, 100 - data.spentPercent - data.duePercent - data.leftoverPercent);

  Widget _legend(Color color, String label, int cents, bool hideCents) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
          const SizedBox(width: 6),
          Text('$label${formatMoney(cents, hideCents: hideCents)}', style: body(size: 12, color: GranaColors.soft)),
        ],
      );
}

class _WeeklyChart extends StatelessWidget {
  const _WeeklyChart({required this.weeks});

  final List<WeekBar> weeks;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 16),
        child: SizedBox(
          height: 116,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (final week in weeks)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 5),
                    child: Semantics(
                      label: 'Semana ${week.index + 1}: ${formatMoney(week.totalCents)}',
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          Text(week.label, style: display(size: 11, weight: FontWeight.w400, color: GranaColors.soft)),
                          const SizedBox(height: 6),
                          Container(
                            height: math.max(6, week.heightPercent / 100 * 62),
                            decoration: BoxDecoration(
                              color: week.current ? GranaColors.ink : GranaColors.pebble,
                              borderRadius: BorderRadius.circular(8),
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            week.totalCents > 0 ? 'R\$ ${formatCompact(week.totalCents)}' : '—',
                            style: body(size: 11, color: GranaColors.muted),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      );
}
