import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/queries.dart';
import '../../application/session.dart';
import '../../core/dates.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../widgets.dart';

/// Lançamentos do mês, agrupados por dia, com filtro por categoria.
class ListScreen extends ConsumerStatefulWidget {
  const ListScreen({super.key});

  @override
  ConsumerState<ListScreen> createState() => _ListScreenState();
}

class _ListScreenState extends ConsumerState<ListScreen> {
  String _month = currentMonthRef();
  String? _categoryId;

  Future<void> _delete(String id) async {
    final confirmed = await confirmDialog(
      context,
      title: 'Apagar este lançamento?',
      description: 'Ele sai do mês e dos relatórios. Não dá para desfazer.',
      confirmLabel: 'Apagar',
      destructive: true,
    );
    if (!confirmed) return;
    try {
      await ref.read(granaApiProvider).deleteTransaction(id);
      if (!mounted) return;
      showToast(context, 'Lançamento apagado');
      ref.invalidateMoney();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para apagar.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final query = (month: _month, categoryId: _categoryId);
    final page = ref.watch(transactionsProvider(query));
    final categories = ref.watch(categoriesProvider).value ?? const <Category>[];
    final hideCents = watchHideCents(ref);
    Future<void> reload() => ref.refresh(transactionsProvider(query).future).then((_) {});

    return Scaffold(
      appBar: AppBar(backgroundColor: GranaColors.cream, title: Text('Lançamentos', style: display(size: 17))),
      body: PageBody(
        onRefresh: reload,
        children: [
          MonthSwitcher(month: _month, onChange: (m) => setState(() => _month = m), subtitle: page.value?.summary),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                GranaChip(label: 'Todos', selected: _categoryId == null, onTap: () => setState(() => _categoryId = null)),
                for (final category in categories.where((c) => !c.archived))
                  Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: GranaChip(
                      label: category.name,
                      dotColor: category.color,
                      selected: _categoryId == category.id,
                      onTap: () => setState(() => _categoryId = category.id),
                    ),
                  ),
              ],
            ),
          ),
          gap14,
          AsyncBody<TransactionsPage>(
            value: page,
            onRetry: reload,
            builder: (data) => data.groups.isEmpty
                ? const EmptyState(
                    title: 'Nada lançado por aqui',
                    description: 'Quando você registrar um gasto ou uma entrada, ele aparece nesta lista.',
                  )
                : Column(
                    children: [
                      for (final group in data.groups)
                        GranaCard(
                          margin: const EdgeInsets.only(bottom: 14),
                          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                          child: Column(
                            children: [
                              Row(
                                children: [
                                  Expanded(child: Text(group.label, style: display(size: 14))),
                                  MoneyText(group.totalCents, hideCents: hideCents, style: body(size: 12, color: GranaColors.muted)),
                                ],
                              ),
                              for (var i = 0; i < group.items.length; i++)
                                _TransactionRow(
                                  item: group.items[i],
                                  hideCents: hideCents,
                                  last: i == group.items.length - 1,
                                  onDelete: () => _delete(group.items[i].id),
                                ),
                            ],
                          ),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _TransactionRow extends StatelessWidget {
  const _TransactionRow({required this.item, required this.hideCents, required this.last, required this.onDelete});

  final Transaction item;
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
                  Text(item.category.name, overflow: TextOverflow.ellipsis, style: body(weight: FontWeight.w500)),
                  if (item.note != null && item.note!.isNotEmpty)
                    Text(item.note!, overflow: TextOverflow.ellipsis, style: body(size: 11.5, color: GranaColors.muted)),
                ],
              ),
            ),
            // Igual ao site: entrada aparece com sinal (o site passa o valor negado).
            MoneyText(
              item.isIncome ? -item.amountCents : item.amountCents,
              hideCents: hideCents,
              signed: item.isIncome,
              style: display(color: item.isIncome ? GranaColors.green : GranaColors.ink),
            ),
            DeleteIconButton(tooltip: 'Apagar lançamento de ${item.category.name}', onPressed: onDelete),
          ],
        ),
      );
}
