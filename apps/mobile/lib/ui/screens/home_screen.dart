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
import '../overdue_bills.dart';
import '../widgets.dart';

const _pastDays = 14;
const _aheadDays = 60;

/// Tela inicial do saldo futuro: quanto tenho HOJE, quanto vou ter no fim do
/// mês e qual o dia mais apertado pela frente.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final today = localTodayISO();
    final range = (from: addDaysISO(today, -_pastDays), to: addDaysISO(today, _aheadDays));
    final cashflow = ref.watch(cashflowProvider(range));
    final hideCents = watchHideCents(ref);

    Future<void> reload() async {
      ref.invalidate(settingsProvider);
      return ref.refresh(cashflowProvider(range).future).then((_) {});
    }

    return PageBody(
      onRefresh: reload,
      children: [
        AsyncBody<Cashflow>(
          value: cashflow,
          onRetry: reload,
          builder: (data) => data.configured
              ? _CashflowView(data: data, today: today, hideCents: hideCents)
              : _OpeningBalanceForm(today: today),
        ),
      ],
    );
  }
}

class _CashflowView extends StatelessWidget {
  const _CashflowView({required this.data, required this.today, required this.hideCents});

  final Cashflow data;
  final String today;
  final bool hideCents;

  @override
  Widget build(BuildContext context) {
    final weekEnd = addDaysISO(today, 7);
    final upcoming = [
      for (final day in data.days)
        if (day.date.compareTo(today) > 0 && day.date.compareTo(weekEnd) <= 0)
          for (final event in day.events)
            if (event.kind != 'DAILY_AVERAGE') (date: day.date, event: event),
    ];
    final negativeToday = data.todayBalanceCents < 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PageTitle('Seu saldo', trailing: LinkText('ver diário', onTap: () => context.go('/diario'))),
        GranaCard(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Tenho hoje', style: body(size: 13, color: GranaColors.muted)),
              const SizedBox(height: 6),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: MoneyText(
                  data.todayBalanceCents,
                  hideCents: hideCents,
                  style: display(
                    size: 44,
                    weight: FontWeight.w700,
                    letterSpacing: -1.5,
                    height: 1.05,
                    color: negativeToday ? GranaColors.clay : GranaColors.ink,
                  ),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                data.firstNegativeDate != null
                    ? 'Atenção: pelo previsto, o saldo fica negativo em ${shortDate(data.firstNegativeDate!)}.'
                    : 'Pelo previsto, seu saldo não fica negativo nos próximos 60 dias.',
                style: body(size: 13, color: data.firstNegativeDate != null ? GranaColors.clay : GranaColors.green),
              ),
              BalanceChart(
                days: [for (final day in data.days) (date: day.date, balanceCents: day.balanceCents)],
                today: today,
                highlight: data.lowest,
              ),
            ],
          ),
        ),
        gap14,
        Row(
          children: [
            StatCard(label: 'No fim do mês', cents: data.endOfMonthCents, hideCents: hideCents),
            const SizedBox(width: 12),
            StatCard(
              label: data.lowest != null ? 'Menor saldo (${shortDate(data.lowest!.date)})' : 'Menor saldo',
              cents: data.lowest?.balanceCents ?? data.todayBalanceCents,
              hideCents: hideCents,
            ),
          ],
        ),
        if (data.overdueBills.isNotEmpty) ...[
          gap14,
          OverdueBillsCard(
            bills: data.overdueBills,
            hideCents: hideCents,
            description: 'Conta não paga não some: ela acumula e já está descontada da sua previsão.',
          ),
        ],
        gap14,
        GranaCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SectionHeader(
                title: 'Próximos 7 dias',
                aside: LinkText('posso comprar?', size: 12, onTap: () => context.go('/posso-comprar')),
              ),
              if (upcoming.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text('Nada previsto para esta semana.', style: body(size: 13, color: GranaColors.muted)),
                )
              else
                for (var i = 0; i < upcoming.length; i++)
                  _UpcomingRow(
                    date: upcoming[i].date,
                    event: upcoming[i].event,
                    today: today,
                    hideCents: hideCents,
                    last: i == upcoming.length - 1,
                  ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                'A previsão considera entradas fixas, contas, faturas'
                '${data.dailyAverageCents > 0 ? ' e um gasto médio de ${formatMoney(data.dailyAverageCents, hideCents: hideCents)} por dia' : ''}. ',
                style: body(size: 12, color: GranaColors.muted, height: 1.45),
              ),
              LinkText('Ajustar', size: 12, onTap: () => context.go('/ajustes')),
            ],
          ),
        ),
        const SizedBox(height: 4),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: LinkText('ver o resumo do mês', size: 12, onTap: () => context.push('/mes')),
        ),
      ],
    );
  }
}

class _UpcomingRow extends StatelessWidget {
  const _UpcomingRow({
    required this.date,
    required this.event,
    required this.today,
    required this.hideCents,
    required this.last,
  });

  final String date;
  final CashflowEvent event;
  final String today;
  final bool hideCents;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final income = event.amountCents > 0;
    return ListRow(
      last: last,
      child: Row(
        children: [
          DateBadge(day: date.substring(8, 10), month: date.substring(5, 7)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(event.label, overflow: TextOverflow.ellipsis, style: body(weight: FontWeight.w500)),
                Text(dayLabel(date, today), style: body(size: 11.5, color: GranaColors.muted)),
              ],
            ),
          ),
          MoneyText(
            event.amountCents,
            hideCents: hideCents,
            signed: income,
            style: display(color: income ? GranaColors.green : GranaColors.ink),
          ),
        ],
      ),
    );
  }
}

/// Primeiro acesso: sem saldo inicial não existe saldo futuro.
class _OpeningBalanceForm extends ConsumerStatefulWidget {
  const _OpeningBalanceForm({required this.today});

  final String today;

  @override
  ConsumerState<_OpeningBalanceForm> createState() => _OpeningBalanceFormState();
}

class _OpeningBalanceFormState extends ConsumerState<_OpeningBalanceForm> {
  final _value = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _value.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final cents = parseBRLToCents(_value.text);
    if (cents == null) {
      showToast(context, 'Digite quanto você tem na conta, por exemplo 1.250,00.', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).updateSettings({'openingBalanceCents': cents, 'openingDate': widget.today});
      if (!mounted) return;
      showToast(context, 'Pronto! Seu saldo futuro está ligado.');
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
  Widget build(BuildContext context) => GranaCard(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Quanto você tem hoje na conta?', style: display(size: 22, weight: FontWeight.w700, letterSpacing: -0.4)),
            gap8,
            Text(
              'A partir desse número o Grana mostra seu saldo dia a dia: o que já aconteceu e o que vem por aí '
              '(salário, contas, faturas). O que sobrar num mês passa para o seguinte, e conta não paga fica '
              'acumulando até você pagar.',
              style: body(size: 13, color: GranaColors.soft, height: 1.5),
            ),
            const SizedBox(height: 20),
            LabeledField(
              label: 'Saldo atual (R\$)',
              hint: 'Some suas contas correntes. Se estiver no cheque especial, use o sinal de menos.',
              child: GranaInput(
                controller: _value,
                hint: '1.250,00',
                keyboard: GranaInput.money,
                autofocus: true,
                onSubmitted: (_) => _save(),
              ),
            ),
            gap12,
            GranaButton(label: 'Começar', size: ButtonSize.lg, fullWidth: true, loading: _busy, onPressed: _save),
            gap12,
            Text(
              'Lançamentos e contas de hoje em diante entram na conta. O que venceu antes de hoje já está dentro desse saldo.',
              style: body(size: 11.5, color: GranaColors.muted, height: 1.45),
            ),
          ],
        ),
      );
}
