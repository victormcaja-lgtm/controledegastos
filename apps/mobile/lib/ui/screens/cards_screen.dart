import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/queries.dart';
import '../../application/session.dart';
import '../../core/dates.dart';
import '../../core/money.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../widgets.dart';

const _statusLabel = {'OPEN': 'aberta', 'FUTURE': 'próxima', 'CLOSED': 'fechada', 'PAST': 'paga'};

/// Cartões de crédito: a compra não sai do saldo no dia — sai na fatura, no
/// vencimento. Parcelada, uma parcela por fatura.
class CardsScreen extends ConsumerStatefulWidget {
  const CardsScreen({super.key});

  @override
  ConsumerState<CardsScreen> createState() => _CardsScreenState();
}

class _CardsScreenState extends ConsumerState<CardsScreen> {
  bool _formOpen = false;

  @override
  Widget build(BuildContext context) {
    final cards = ref.watch(cardsProvider);
    final hideCents = watchHideCents(ref);
    Future<void> reload() {
      ref.invalidate(invoiceProvider);
      return ref.refresh(cardsProvider.future).then((_) {});
    }

    return PageBody(
      onRefresh: reload,
      children: [
        const MoreTabs(current: '/cartoes'),
        SectionHeader(
          title: 'Cartões',
          aside: LinkText(
            _formOpen ? 'fechar' : '+ novo cartão',
            size: 12,
            onTap: () => setState(() => _formOpen = !_formOpen),
          ),
        ),
        gap14,
        if (_formOpen) ...[
          GranaCard(child: _NewCardForm(onDone: () => setState(() => _formOpen = false))),
          gap14,
        ],
        AsyncBody<List<CreditCard>>(
          value: cards,
          onRetry: reload,
          builder: (list) => list.isEmpty
              ? const EmptyState(
                  title: 'Nenhum cartão cadastrado',
                  description: 'Cadastre seu cartão para a fatura entrar no saldo futuro no dia do vencimento.',
                )
              : Column(
                  children: [
                    for (final card in list)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 14),
                        child: _CardItem(key: ValueKey(card.id), card: card, hideCents: hideCents),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

class _CardItem extends ConsumerStatefulWidget {
  const _CardItem({super.key, required this.card, required this.hideCents});

  final CreditCard card;
  final bool hideCents;

  @override
  ConsumerState<_CardItem> createState() => _CardItemState();
}

class _CardItemState extends ConsumerState<_CardItem> {
  late String? _month = widget.card.invoices.firstOrNull?.month;
  bool _purchaseOpen = false;

  Future<void> _deleteCard() async {
    final card = widget.card;
    final confirmed = await confirmDialog(
      context,
      title: 'Excluir ${card.name}?',
      description: 'Todas as compras e faturas deste cartão também são removidas.',
      confirmLabel: 'Excluir',
      destructive: true,
    );
    if (!confirmed) return;
    try {
      await ref.read(granaApiProvider).deleteCard(card.id);
      if (!mounted) return;
      showToast(context, 'Cartão excluído');
      ref.invalidateMoney();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para excluir.');
    }
  }

  Future<void> _deletePurchase(String purchaseId) async {
    final confirmed = await confirmDialog(
      context,
      title: 'Apagar esta compra?',
      description: 'Todas as parcelas dela saem das faturas.',
      confirmLabel: 'Apagar',
      destructive: true,
    );
    if (!confirmed) return;
    try {
      await ref.read(granaApiProvider).deleteCardPurchase(purchaseId);
      if (!mounted) return;
      showToast(context, 'Compra apagada');
      ref.invalidateMoney();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para apagar.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final card = widget.card;
    final hideCents = widget.hideCents;
    final invoice = ref.watch(invoiceProvider((cardId: card.id, month: _month)));
    final limit = card.limitCents;
    final limitPercent = limit != null && limit > 0 ? jsRound(card.usedLimitCents / limit * 100) : null;

    return GranaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(card.name, style: display()),
                    Text(
                      'fecha dia ${card.closingDay} · vence dia ${card.dueDay}',
                      style: body(size: 11.5, color: GranaColors.muted),
                    ),
                  ],
                ),
              ),
              DeleteIconButton(tooltip: 'Excluir ${card.name}', onPressed: _deleteCard),
            ],
          ),
          if (limitPercent != null) ...[
            gap12,
            ProgressLine(
              percent: limitPercent,
              height: 6,
              color: limitPercent > 90 ? GranaColors.clay : GranaColors.green,
            ),
            const SizedBox(height: 6),
            Text(
              '${formatMoney(card.usedLimitCents, hideCents: hideCents)} usados de ${formatMoney(limit!, hideCents: hideCents)}',
              style: body(size: 11.5, color: GranaColors.muted),
            ),
          ],
          gap14,
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final item in card.invoices)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: _InvoiceTab(
                      invoice: item,
                      selected: item.month == _month,
                      hideCents: hideCents,
                      onTap: () => setState(() => _month = item.month),
                    ),
                  ),
              ],
            ),
          ),
          gap12,
          AsyncBody<InvoiceDetail>(
            value: invoice,
            onRetry: () => ref.invalidate(invoiceProvider((cardId: card.id, month: _month))),
            builder: (detail) => detail.items.isEmpty
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Text('Nenhuma compra nesta fatura.', style: body(size: 13, color: GranaColors.muted)),
                  )
                : Column(
                    children: [
                      for (var i = 0; i < detail.items.length; i++)
                        _InvoiceRow(
                          item: detail.items[i],
                          hideCents: hideCents,
                          last: i == detail.items.length - 1,
                          onDelete: () => _deletePurchase(detail.items[i].purchaseId),
                        ),
                    ],
                  ),
          ),
          gap12,
          LinkText(
            _purchaseOpen ? 'fechar' : '+ compra no cartão',
            onTap: () => setState(() => _purchaseOpen = !_purchaseOpen),
          ),
          if (_purchaseOpen) _PurchaseForm(cardId: card.id, onDone: () => setState(() => _purchaseOpen = false)),
        ],
      ),
    );
  }
}

class _InvoiceTab extends StatelessWidget {
  const _InvoiceTab({required this.invoice, required this.selected, required this.hideCents, required this.onTap});

  final InvoiceSummary invoice;
  final bool selected;
  final bool hideCents;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final foreground = selected ? GranaColors.surface : GranaColors.ink;
    final faded = foreground.withValues(alpha: 0.75);
    return Material(
      color: selected ? GranaColors.ink : GranaColors.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(GranaRadius.chip),
        side: BorderSide(color: selected ? GranaColors.ink : GranaColors.line),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(GranaRadius.chip),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minWidth: 100),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${monthNameShort(invoice.month)} · ${_statusLabel[invoice.status] ?? invoice.status}',
                style: body(size: 11, color: faded),
              ),
              MoneyText(invoice.totalCents, hideCents: hideCents, style: display(size: 14, color: foreground)),
              Text('vence ${shortDate(invoice.dueDate)}', style: body(size: 10.5, color: faded)),
            ],
          ),
        ),
      ),
    );
  }
}

class _InvoiceRow extends StatelessWidget {
  const _InvoiceRow({required this.item, required this.hideCents, required this.last, required this.onDelete});

  final InvoiceItem item;
  final bool hideCents;
  final bool last;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) => ListRow(
        last: last,
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            ColorDot(item.category.color),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.label, overflow: TextOverflow.ellipsis, style: body(weight: FontWeight.w500)),
                  Text(
                    '${shortDate(item.purchasedOn)}'
                    '${item.installments > 1 ? ' · parcela ${item.installmentNumber}/${item.installments}' : ''}',
                    style: body(size: 11, color: GranaColors.muted),
                  ),
                ],
              ),
            ),
            MoneyText(item.amountCents, hideCents: hideCents, style: display(size: 14)),
            DeleteIconButton(tooltip: 'Apagar compra ${item.label}', onPressed: onDelete),
          ],
        ),
      );
}

class _NewCardForm extends ConsumerStatefulWidget {
  const _NewCardForm({required this.onDone});

  final VoidCallback onDone;

  @override
  ConsumerState<_NewCardForm> createState() => _NewCardFormState();
}

class _NewCardFormState extends ConsumerState<_NewCardForm> {
  final _name = TextEditingController();
  final _closing = TextEditingController(text: '3');
  final _due = TextEditingController(text: '10');
  final _limit = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    for (final controller in [_name, _closing, _due, _limit]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final closing = int.tryParse(_closing.text.trim());
    final due = int.tryParse(_due.text.trim());
    final limit = _limit.text.trim().isEmpty ? null : parseBRLToCents(_limit.text);

    String? problem;
    if (name.length < 2) problem = 'Informe pelo menos 2 caracteres.';
    if (closing == null || closing < 1 || closing > 31 || due == null || due < 1 || due > 31) {
      problem ??= 'O dia precisa estar entre 1 e 31.';
    }
    if (_limit.text.trim().isNotEmpty && (limit == null || limit <= 0)) {
      problem ??= 'O valor precisa ser maior que zero.';
    }
    if (problem != null) {
      showToast(context, problem, error: true);
      return;
    }

    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).createCard(name: name, closingDay: closing!, dueDay: due!, limitCents: limit);
      if (!mounted) return;
      showToast(context, 'Cartão cadastrado');
      ref.invalidateMoney();
      widget.onDone();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para cadastrar.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
        children: [
          LabeledField(label: 'Nome', child: GranaInput(controller: _name, hint: 'Nubank')),
          gap12,
          Row(
            children: [
              Expanded(
                child: LabeledField(label: 'Fecha dia', child: GranaInput(controller: _closing, keyboard: GranaInput.number)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: LabeledField(label: 'Vence dia', child: GranaInput(controller: _due, keyboard: GranaInput.number)),
              ),
            ],
          ),
          gap12,
          LabeledField(
            label: 'Limite (opcional)',
            child: GranaInput(controller: _limit, hint: '5.000,00', keyboard: GranaInput.money),
          ),
          gap12,
          GranaButton(label: 'Cadastrar cartão', fullWidth: true, loading: _busy, onPressed: _submit),
        ],
      );
}

class _PurchaseForm extends ConsumerStatefulWidget {
  const _PurchaseForm({required this.cardId, required this.onDone});

  final String cardId;
  final VoidCallback onDone;

  @override
  ConsumerState<_PurchaseForm> createState() => _PurchaseFormState();
}

class _PurchaseFormState extends ConsumerState<_PurchaseForm> {
  final _value = TextEditingController();
  final _installments = TextEditingController(text: '1');
  final _note = TextEditingController();
  String _date = localTodayISO();
  String? _categoryId;
  bool _busy = false;

  @override
  void dispose() {
    for (final controller in [_value, _installments, _note]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDate() async {
    final current = DateTime.parse(_date);
    final picked = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => _date = localTodayISO(picked));
  }

  Future<void> _submit(String? categoryId) async {
    final cents = parseBRLToCents(_value.text) ?? 0;
    final installments = int.tryParse(_installments.text.trim()) ?? 0;
    String? problem;
    if (cents <= 0) problem = 'O valor precisa ser maior que zero.';
    if (installments < 1 || installments > 48) problem ??= 'Use de 1 a 48 parcelas.';
    if (categoryId == null) problem ??= 'Escolha uma categoria.';
    if (problem != null) {
      showToast(context, problem, error: true);
      return;
    }

    setState(() => _busy = true);
    try {
      await ref.read(granaApiProvider).createCardPurchase(
            widget.cardId,
            amountCents: cents,
            installments: installments,
            purchasedOn: _date,
            categoryId: categoryId!,
            note: _note.text,
          );
      if (!mounted) return;
      showToast(context, 'Compra registrada');
      ref.invalidateMoney();
      widget.onDone();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para registrar.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final categories = (ref.watch(categoriesProvider).value ?? const <Category>[])
        .where((c) => c.isExpense && !c.archived)
        .toList();
    final selected = _categoryId ?? categories.firstOrNull?.id;

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: LabeledField(
                  label: 'Valor total (R\$)',
                  child: GranaInput(controller: _value, hint: '600,00', keyboard: GranaInput.money),
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 96,
                child: LabeledField(
                  label: 'Parcelas',
                  child: GranaInput(controller: _installments, keyboard: GranaInput.number),
                ),
              ),
            ],
          ),
          gap12,
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: LabeledField(
                  label: 'Data',
                  child: GranaButton(
                    label: fullDate(_date),
                    variant: ButtonVariant.secondary,
                    fullWidth: true,
                    onPressed: _pickDate,
                  ),
                ),
              ),
              const SizedBox(width: 12),
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
            ],
          ),
          gap12,
          LabeledField(
            label: 'Descrição (opcional)',
            child: GranaInput(controller: _note, hint: 'Geladeira', maxLength: 140),
          ),
          gap12,
          GranaButton(label: 'Registrar compra', fullWidth: true, loading: _busy, onPressed: () => _submit(selected)),
        ],
      ),
    );
  }
}
