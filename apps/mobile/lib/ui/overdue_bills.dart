import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../application/queries.dart';
import '../application/session.dart';
import '../core/dates.dart';
import '../core/money.dart';
import '../core/theme.dart';
import '../data/models.dart';
import 'widgets.dart';

/// Contas vencidas e não pagas. Elas ACUMULAM: continuam aqui (e puxando o
/// saldo para baixo) até receber baixa ou um "não vou pagar".
class OverdueBillsCard extends StatelessWidget {
  const OverdueBillsCard({super.key, required this.bills, required this.hideCents, required this.description});

  final List<OverdueBill> bills;
  final bool hideCents;
  final String description;

  @override
  Widget build(BuildContext context) {
    final total = bills.fold<int>(0, (sum, bill) => sum + bill.amountCents);
    return GranaCard(
      borderColor: GranaColors.clay.withValues(alpha: 0.4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(
            title: 'Em atraso',
            aside: Text(formatMoney(total, hideCents: hideCents), style: body(size: 12, color: GranaColors.clay)),
          ),
          const SizedBox(height: 4),
          Text(description, style: body(size: 12.5, color: GranaColors.soft, height: 1.45)),
          for (var i = 0; i < bills.length; i++)
            _OverdueRow(bill: bills[i], hideCents: hideCents, last: i == bills.length - 1),
        ],
      ),
    );
  }
}

class _OverdueRow extends ConsumerStatefulWidget {
  const _OverdueRow({required this.bill, required this.hideCents, required this.last});

  final OverdueBill bill;
  final bool hideCents;
  final bool last;

  @override
  ConsumerState<_OverdueRow> createState() => _OverdueRowState();
}

class _OverdueRowState extends ConsumerState<_OverdueRow> {
  final _custom = TextEditingController();
  bool _customOpen = false;
  bool _busy = false;

  @override
  void dispose() {
    _custom.dispose();
    super.dispose();
  }

  Future<void> _settle({int? amountCents, bool waived = false}) async {
    final bill = widget.bill;
    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).setBillPayment(
            bill.billId,
            month: bill.month,
            paid: !waived,
            waived: waived ? true : null,
            amountCents: amountCents,
          );
      if (!mounted) return;
      showToast(context, waived ? '${bill.name} dispensada' : '${bill.name} de ${monthNameShort(bill.month)} paga');
      ref.invalidateMoney();
    } catch (error) {
      if (mounted) showErrorToast(context, error, waived ? 'Não deu para salvar.' : 'Não deu para dar baixa.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _waive() async {
    final confirmed = await confirmDialog(
      context,
      title: 'Não vai pagar ${widget.bill.name}?',
      description:
          'A conta deste mês sai do atraso e da previsão sem mexer no seu saldo. Use para conta negociada ou cancelada.',
      confirmLabel: 'Não vou pagar',
    );
    if (confirmed) await _settle(waived: true);
  }

  @override
  Widget build(BuildContext context) {
    final bill = widget.bill;
    return ListRow(
      last: widget.last,
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              DateBadge(day: bill.dueDate.substring(8, 10), month: monthNameShort(bill.month), alert: true),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text.rich(
                      TextSpan(children: [
                        TextSpan(text: bill.name, style: body(weight: FontWeight.w500)),
                        if (bill.totalInstallments != null)
                          TextSpan(
                            text: ' · ${bill.installmentNumber}/${bill.totalInstallments}',
                            style: body(size: 11, color: GranaColors.faint),
                          ),
                      ]),
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      'venceu ${shortDate(bill.dueDate)} · ${bill.daysLate} dia${bill.daysLate == 1 ? '' : 's'} de atraso',
                      style: body(size: 11.5, color: GranaColors.clay),
                    ),
                  ],
                ),
              ),
              MoneyText(bill.amountCents, hideCents: widget.hideCents, style: display()),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              GranaButton(
                label: 'Paguei ${formatMoney(bill.amountCents, hideCents: widget.hideCents)}',
                size: ButtonSize.sm,
                loading: _busy,
                onPressed: () => _settle(),
              ),
              GranaButton(
                label: 'Outro valor',
                size: ButtonSize.sm,
                variant: ButtonVariant.secondary,
                onPressed: () => setState(() => _customOpen = !_customOpen),
              ),
              GranaButton(
                label: 'Não vou pagar',
                size: ButtonSize.sm,
                variant: ButtonVariant.ghost,
                onPressed: _waive,
              ),
            ],
          ),
          if (_customOpen) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: GranaInput(
                    controller: _custom,
                    hint: 'Valor com juros (R\$)',
                    keyboard: GranaInput.money,
                  ),
                ),
                const SizedBox(width: 8),
                GranaButton(
                  label: 'Salvar',
                  loading: _busy,
                  onPressed: () {
                    final cents = parseBRLToCents(_custom.text);
                    if (cents == null || cents <= 0) {
                      showToast(context, 'Informe o valor pago.', error: true);
                      return;
                    }
                    _settle(amountCents: cents);
                  },
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
