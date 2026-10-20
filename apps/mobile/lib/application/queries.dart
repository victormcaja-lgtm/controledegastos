import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/dates.dart';
import '../data/models.dart';
import 'session.dart';

/// Estado de servidor: cada provider é uma consulta à API, com cache.
/// Depois de qualquer escrita, `invalidateMoney` recarrega o que depende de
/// dinheiro — o mesmo papel do `invalidateMoney` do TanStack Query no site.

final settingsProvider = FutureProvider<Settings>((ref) => ref.watch(granaApiProvider).settings());

final categoriesProvider = FutureProvider<List<Category>>((ref) => ref.watch(granaApiProvider).categories());

typedef DateRange = ({String from, String to});

/// Saldo dia a dia entre `from` e `to`, com o "hoje" do aparelho.
final cashflowProvider = FutureProvider.family<Cashflow, DateRange>(
  (ref, range) => ref.watch(granaApiProvider).cashflow(from: range.from, to: range.to, today: localTodayISO()),
);

final dashboardProvider = FutureProvider.family<DashboardSummary, String>(
  (ref, month) => ref.watch(granaApiProvider).dashboard(month),
);

final categoryReportProvider = FutureProvider.family<CategoryReport, String>(
  (ref, month) => ref.watch(granaApiProvider).categoryReport(month),
);

typedef TransactionsQuery = ({String month, String? categoryId});

final transactionsProvider = FutureProvider.family<TransactionsPage, TransactionsQuery>(
  (ref, query) => ref.watch(granaApiProvider).transactions(month: query.month, categoryId: query.categoryId),
);

final billsProvider = FutureProvider.family<BillsOverview, String>(
  (ref, month) => ref.watch(granaApiProvider).bills(month),
);

final overdueBillsProvider = FutureProvider<List<OverdueBill>>(
  (ref) => ref.watch(granaApiProvider).overdueBills(localTodayISO()),
);

final cardsProvider = FutureProvider<List<CreditCard>>((ref) => ref.watch(granaApiProvider).cards(localTodayISO()));

typedef InvoiceQuery = ({String cardId, String? month});

final invoiceProvider = FutureProvider.family<InvoiceDetail, InvoiceQuery>(
  (ref, query) => ref.watch(granaApiProvider).invoice(query.cardId, query.month),
);

final incomesProvider = FutureProvider<List<Income>>((ref) => ref.watch(granaApiProvider).incomes());

final debtsProvider = FutureProvider<DebtOverview>((ref) => ref.watch(granaApiProvider).debts());

final goalsProvider = FutureProvider<List<Goal>>((ref) => ref.watch(granaApiProvider).goals());

extension InvalidateMoney on WidgetRef {
  /// Tudo que muda quando um valor entra, sai ou muda de lugar.
  void invalidateMoney() {
    invalidate(cashflowProvider);
    invalidate(dashboardProvider);
    invalidate(categoryReportProvider);
    invalidate(transactionsProvider);
    invalidate(billsProvider);
    invalidate(invoiceProvider);
    invalidate(overdueBillsProvider);
    invalidate(cardsProvider);
    invalidate(debtsProvider);
    invalidate(goalsProvider);
    invalidate(incomesProvider);
  }
}
