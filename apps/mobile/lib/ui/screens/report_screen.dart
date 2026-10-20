import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/queries.dart';
import '../../core/css_color.dart';
import '../../core/dates.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../widgets.dart';

/// Relatório por categoria (aba "Categorias" do Mais).
class ReportScreen extends ConsumerStatefulWidget {
  const ReportScreen({super.key});

  @override
  ConsumerState<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends ConsumerState<ReportScreen> {
  String _month = currentMonthRef();

  @override
  Widget build(BuildContext context) {
    final report = ref.watch(categoryReportProvider(_month));
    final hideCents = watchHideCents(ref);
    Future<void> reload() => ref.refresh(categoryReportProvider(_month).future).then((_) {});

    return PageBody(
      onRefresh: reload,
      children: [
        const MoreTabs(current: '/mais'),
        MonthSwitcher(month: _month, onChange: (m) => setState(() => _month = m)),
        AsyncBody<CategoryReport>(
          value: report,
          onRetry: reload,
          builder: (data) => data.items.isEmpty
              ? const EmptyState(
                  title: 'Sem gastos neste mês',
                  description: 'Assim que houver lançamentos ou contas fixas, o relatório aparece aqui.',
                )
              : Column(
                  children: [
                    GranaCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Comprometido em ${data.monthLabel.toLowerCase()}',
                            style: body(size: 13, color: GranaColors.muted),
                          ),
                          const SizedBox(height: 4),
                          MoneyText(
                            data.totalCents,
                            hideCents: hideCents,
                            style: display(size: 32, weight: FontWeight.w700, letterSpacing: -1),
                          ),
                          const SizedBox(height: 20),
                          for (final item in data.items) _ReportRow(item: item, hideCents: hideCents),
                        ],
                      ),
                    ),
                    gap14,
                    GranaCard(
                      child: Text(data.comparison, style: body(size: 12.5, color: GranaColors.soft, height: 1.45)),
                    ),
                  ],
                ),
        ),
      ],
    );
  }
}

class _ReportRow extends StatelessWidget {
  const _ReportRow({required this.item, required this.hideCents});

  final CategoryReportItem item;
  final bool hideCents;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(
          children: [
            Row(
              children: [
                ColorDot(item.color),
                const SizedBox(width: 8),
                Expanded(child: Text(item.name, style: body())),
                MoneyText(item.totalCents, hideCents: hideCents, style: display(size: 14)),
                SizedBox(
                  width: 40,
                  child: Text('${item.percent}%', textAlign: TextAlign.right, style: body(size: 11.5, color: GranaColors.muted)),
                ),
              ],
            ),
            const SizedBox(height: 6),
            ProgressLine(percent: item.relativeWidth, height: 6, color: parseCssColor(item.color)),
          ],
        ),
      );
}
