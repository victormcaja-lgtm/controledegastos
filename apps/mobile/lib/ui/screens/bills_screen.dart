import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/queries.dart';
import '../../application/session.dart';
import '../../core/dates.dart';
import '../../core/money.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../overdue_bills.dart';
import '../widgets.dart';

/// Contas fixas da competência: calendário, baixa por mês e cadastro.
class BillsScreen extends ConsumerStatefulWidget {
  const BillsScreen({super.key});

  @override
  ConsumerState<BillsScreen> createState() => _BillsScreenState();
}

class _BillsScreenState extends ConsumerState<BillsScreen> {
  String _month = currentMonthRef();
  bool _formOpen = false;

  Future<void> _togglePaid(Bill bill) async {
    try {
      await ref.read(granaApiProvider).setBillPayment(bill.id, month: _month, paid: !bill.paid);
      if (!mounted) return;
      showToast(context, bill.paid ? '${bill.name} voltou para a pagar' : '${bill.name} paga');
      ref.invalidateMoney();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para salvar.');
    }
  }

  Future<void> _delete(Bill bill) async {
    final confirmed = await confirmDialog(
      context,
      title: 'Excluir esta conta fixa?',
      description: 'O histórico de pagamentos dela também é removido.',
      confirmLabel: 'Excluir',
      destructive: true,
    );
    if (!confirmed) return;
    try {
      await ref.read(granaApiProvider).deleteBill(bill.id);
      if (!mounted) return;
      showToast(context, 'Conta excluída');
      ref.invalidateMoney();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para excluir.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final overview = ref.watch(billsProvider(_month));
    final overdue = ref.watch(overdueBillsProvider).value ?? const <OverdueBill>[];
    final hideCents = watchHideCents(ref);
    Future<void> reload() {
      ref.invalidate(overdueBillsProvider);
      return ref.refresh(billsProvider(_month).future).then((_) {});
    }

    return PageBody(
      onRefresh: reload,
      children: [
        MonthSwitcher(
          month: _month,
          onChange: (m) => setState(() => _month = m),
          subtitle: overview.value == null
              ? null
              : '${formatMoney(overview.value!.paidCents)} pagas · ${formatMoney(overview.value!.dueCents)} a pagar',
        ),
        if (overdue.isNotEmpty) ...[
          OverdueBillsCard(
            bills: overdue,
            hideCents: hideCents,
            description:
                'Contas de meses anteriores (ou deste) que venceram sem baixa. Elas acumulam até você pagar.',
          ),
          gap14,
        ],
        AsyncBody<BillsOverview>(
          value: overview,
          onRetry: reload,
          builder: (data) => Column(
            children: [
              GranaCard(child: _Calendar(days: data.calendar)),
              gap14,
              GranaCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SectionHeader(
                      title: 'Contas do mês',
                      aside: LinkText(
                        _formOpen ? 'fechar' : '+ nova',
                        size: 12,
                        onTap: () => setState(() => _formOpen = !_formOpen),
                      ),
                    ),
                    if (_formOpen) _NewBillForm(onDone: () => setState(() => _formOpen = false)),
                    const SizedBox(height: 8),
                    for (var i = 0; i < data.bills.length; i++)
                      _BillRow(
                        bill: data.bills[i],
                        hideCents: hideCents,
                        last: i == data.bills.length - 1,
                        onToggle: () => _togglePaid(data.bills[i]),
                        onDelete: () => _delete(data.bills[i]),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Calendar extends StatelessWidget {
  const _Calendar({required this.days});

  final List<CalendarDay> days;

  @override
  Widget build(BuildContext context) => Column(
        children: [
          Row(
            children: [
              for (final initial in weekdayInitials)
                Expanded(
                  child: Text(initial, textAlign: TextAlign.center, style: body(size: 10, color: GranaColors.muted)),
                ),
            ],
          ),
          const SizedBox(height: 6),
          GridView.count(
            crossAxisCount: 7,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 4,
            crossAxisSpacing: 4,
            childAspectRatio: 1.1,
            children: [
              for (final cell in days)
                Container(
                  decoration: BoxDecoration(
                    color: cell.isToday
                        ? GranaColors.ink
                        : cell.hasBill
                            ? GranaColors.lineSoft
                            : Colors.transparent,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      Text(
                        cell.day?.toString() ?? '',
                        style: body(
                          size: 12.5,
                          weight: cell.isToday ? FontWeight.w600 : FontWeight.w400,
                          color: cell.isToday ? GranaColors.surface : GranaColors.soft,
                        ),
                      ),
                      if (cell.hasBill)
                        Positioned(
                          bottom: 4,
                          child: Container(
                            width: 6,
                            height: 6,
                            decoration: BoxDecoration(
                              color: cell.allPaid ? GranaColors.mint : GranaColors.clay,
                              shape: BoxShape.circle,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      );
}

class _BillRow extends StatelessWidget {
  const _BillRow({
    required this.bill,
    required this.hideCents,
    required this.last,
    required this.onToggle,
    required this.onDelete,
  });

  final Bill bill;
  final bool hideCents;
  final bool last;
  final VoidCallback onToggle;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final settled = bill.paid || bill.waived;
    return ListRow(
      last: last,
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Semantics(
            checked: bill.paid,
            label: 'Marcar ${bill.name} como ${bill.paid ? 'não paga' : 'paga'}',
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onToggle,
              child: Container(
                width: 26,
                height: 26,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: bill.paid ? GranaColors.green : Colors.transparent,
                  border: Border.all(color: bill.paid ? GranaColors.green : GranaColors.pebble),
                ),
                child: bill.paid ? const Icon(Icons.check_rounded, size: 16, color: Colors.white) : null,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(children: [
                    TextSpan(
                      text: bill.name,
                      style: body(
                        weight: FontWeight.w500,
                        color: settled ? GranaColors.muted : GranaColors.ink,
                      ).copyWith(decoration: bill.waived ? TextDecoration.lineThrough : null),
                    ),
                    if (bill.totalInstallments != null)
                      TextSpan(
                        text: ' · ${bill.installmentNumber}/${bill.totalInstallments}',
                        style: body(size: 11, color: GranaColors.faint),
                      ),
                  ]),
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  '${bill.paid ? 'pago' : bill.waived ? 'não vou pagar' : 'vence dia ${bill.dueDay}'} · ${bill.category.name}',
                  overflow: TextOverflow.ellipsis,
                  style: body(size: 11.5, color: GranaColors.muted),
                ),
              ],
            ),
          ),
          MoneyText(
            bill.amountCents,
            hideCents: hideCents,
            style: display(color: settled ? GranaColors.muted : GranaColors.ink),
          ),
          DeleteIconButton(tooltip: 'Excluir ${bill.name}', onPressed: onDelete),
        ],
      ),
    );
  }
}

class _NewBillForm extends ConsumerStatefulWidget {
  const _NewBillForm({required this.onDone});

  final VoidCallback onDone;

  @override
  ConsumerState<_NewBillForm> createState() => _NewBillFormState();
}

class _NewBillFormState extends ConsumerState<_NewBillForm> {
  final _name = TextEditingController();
  final _value = TextEditingController();
  final _dueDay = TextEditingController(text: '5');
  final _installments = TextEditingController();
  String? _categoryId;
  Map<String, String> _errors = {};
  bool _busy = false;

  @override
  void dispose() {
    for (final controller in [_name, _value, _dueDay, _installments]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final amountCents = parseBRLToCents(_value.text);
    final dueDay = int.tryParse(_dueDay.text.trim());
    final installmentsText = _installments.text.trim();
    final installments = installmentsText.isEmpty ? null : int.tryParse(installmentsText);

    final errors = <String, String>{
      if (name.isEmpty) 'name': 'Informe o nome.',
      if (name.isNotEmpty && name.length < 2) 'name': 'Informe pelo menos 2 caracteres.',
      if (_categoryId == null) 'categoryId': 'Escolha uma categoria.',
      if (_value.text.trim().isEmpty) 'valor': 'Informe o valor.',
      if (_value.text.trim().isNotEmpty && (amountCents == null || amountCents <= 0))
        'valor': 'O valor precisa ser maior que zero.',
      if (dueDay == null || dueDay < 1 || dueDay > 31) 'dueDay': 'O dia precisa estar entre 1 e 31.',
      if (installmentsText.isNotEmpty && (installments == null || installments < 1 || installments > 600))
        'totalInstallments': 'Use de 1 a 600 parcelas.',
    };
    setState(() => _errors = errors);
    if (errors.isNotEmpty) return;

    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).createBill(
            name: name,
            categoryId: _categoryId!,
            amountCents: amountCents!,
            dueDay: dueDay!,
            totalInstallments: installments,
          );
      if (!mounted) return;
      showToast(context, 'Conta cadastrada');
      ref.invalidateMoney();
      widget.onDone();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para cadastrar.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final categories = (ref.watch(categoriesProvider).value ?? const <Category>[])
        .where((c) => c.isExpense && !c.archived)
        .toList();

    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        children: [
          LabeledField(
            label: 'Nome',
            error: _errors['name'],
            child: GranaInput(controller: _name, hint: 'Aluguel'),
          ),
          gap12,
          LabeledField(
            label: 'Categoria',
            error: _errors['categoryId'],
            child: GranaSelect<String>(
              value: _categoryId,
              hint: 'Selecione…',
              items: [for (final c in categories) (c.id, c.name)],
              onChanged: (id) => setState(() => _categoryId = id),
            ),
          ),
          gap12,
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: LabeledField(
                  label: 'Valor (R\$)',
                  error: _errors['valor'],
                  child: GranaInput(controller: _value, hint: '1200,00', keyboard: GranaInput.money),
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 96,
                child: LabeledField(
                  label: 'Dia',
                  error: _errors['dueDay'],
                  child: GranaInput(controller: _dueDay, keyboard: GranaInput.number),
                ),
              ),
            ],
          ),
          gap12,
          LabeledField(
            label: 'Parcelas (opcional)',
            error: _errors['totalInstallments'],
            hint: 'Quantas vezes ela se repete a partir de agora. Deixe em branco para uma conta recorrente '
                'sem fim, como aluguel ou assinatura.',
            child: GranaInput(controller: _installments, hint: 'Ex.: 24', keyboard: GranaInput.number),
          ),
          gap12,
          GranaButton(label: 'Cadastrar conta', fullWidth: true, loading: _busy, onPressed: _submit),
        ],
      ),
    );
  }
}
