import 'api_client.dart';
import 'models.dart';

/// Gateway: a ÚNICA camada que conhece as URLs da API — espelho de
/// `apps/web/src/infra/http/grana.gateway.ts`. As telas chamam métodos com
/// nome de intenção e nunca montam caminho nem corpo.
class GranaApi {
  GranaApi(this.client);

  final ApiClient client;

  List<T> _list<T>(Object? raw, T Function(Json) parse) =>
      (raw as List<dynamic>).cast<Json>().map(parse).toList();

  /* ── Sessão ── */

  Future<AuthUser> login(String email, String password) async {
    final data = await client.post('/api/auth/login', {'email': email, 'password': password}) as Json;
    client.accessToken = data['accessToken'] as String;
    return AuthUser.fromJson(data['user'] as Json);
  }

  Future<void> signup({required String name, required String email, required String password}) =>
      client.post('/api/auth/signup', {'name': name, 'email': email, 'password': password});

  /// Reabre a sessão pelo refresh token guardado (app aberto de novo).
  Future<AuthUser?> restore() async {
    if (!await client.refresh()) return null;
    final user = client.lastRefreshPayload?['user'] as Json?;
    return user == null ? null : AuthUser.fromJson(user);
  }

  Future<void> logout() async {
    try {
      await client.post('/api/auth/logout');
    } finally {
      client.accessToken = null;
      await client.tokens.clear();
    }
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
    required String confirmPassword,
  }) =>
      client.post('/api/auth/me/password', {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
        'confirmPassword': confirmPassword,
      });

  /* ── Dashboard ── */

  Future<DashboardSummary> dashboard(String month) async =>
      DashboardSummary.fromJson(await client.get('/api/dashboard', query: {'month': month}) as Json);

  Future<CategoryReport> categoryReport(String month) async =>
      CategoryReport.fromJson(await client.get('/api/reports/categories', query: {'month': month}) as Json);

  /* ── Categorias ── */

  Future<List<Category>> categories() async => _list(await client.get('/api/categories'), Category.fromJson);

  Future<Category> createCategory({required String name, required String kind}) async =>
      Category.fromJson(await client.post('/api/categories', {'name': name, 'kind': kind}) as Json);

  Future<void> archiveCategory(String id) => client.patch('/api/categories/$id', {'archived': true});

  Future<void> deleteCategory(String id) => client.delete('/api/categories/$id');

  /* ── Lançamentos ── */

  Future<TransactionsPage> transactions({required String month, String? categoryId}) async =>
      TransactionsPage.fromJson(await client.get('/api/transactions', query: {
        'month': month,
        'categoryId': categoryId,
        'perPage': 100,
      }) as Json);

  Future<void> createTransaction({
    required String type,
    required int amountCents,
    required String categoryId,
    required String occurredOn,
    String? note,
  }) =>
      client.post('/api/transactions', {
        'type': type,
        'amountCents': amountCents,
        'categoryId': categoryId,
        'occurredOn': occurredOn,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      });

  Future<void> deleteTransaction(String id) => client.delete('/api/transactions/$id');

  /* ── Contas fixas ── */

  Future<BillsOverview> bills(String month) async =>
      BillsOverview.fromJson(await client.get('/api/bills', query: {'month': month}) as Json);

  Future<void> createBill({
    required String name,
    required String categoryId,
    required int amountCents,
    required int dueDay,
    int? totalInstallments,
  }) =>
      client.post('/api/bills', {
        'name': name,
        'categoryId': categoryId,
        'amountCents': amountCents,
        'dueDay': dueDay,
        'totalInstallments': totalInstallments,
      });

  Future<void> deleteBill(String id) => client.delete('/api/bills/$id');

  Future<void> setBillPayment(String id, {required String month, required bool paid, bool? waived, int? amountCents}) =>
      client.put('/api/bills/$id/payment', {
        'month': month,
        'paid': paid,
        'waived': ?waived,
        'amountCents': ?amountCents,
      });

  Future<List<OverdueBill>> overdueBills(String today) async =>
      _list(await client.get('/api/bills/overdue', query: {'today': today}), OverdueBill.fromJson);

  /* ── Saldo futuro ── */

  Future<Cashflow> cashflow({required String from, required String to, required String today}) async =>
      Cashflow.fromJson(await client.get('/api/cashflow', query: {'from': from, 'to': to, 'today': today}) as Json);

  Future<SimulationResult> simulate({
    required String from,
    required String to,
    required String today,
    required int amountCents,
    required int installments,
    required String date,
    required String method,
    String? cardId,
  }) async =>
      SimulationResult.fromJson(await client.post('/api/cashflow/simulate', {
        'from': from,
        'to': to,
        'today': today,
        'amountCents': amountCents,
        'installments': installments,
        'date': date,
        'method': method,
        'cardId': ?cardId,
      }) as Json);

  /* ── Cartões ── */

  Future<List<CreditCard>> cards(String today) async =>
      _list(await client.get('/api/cards', query: {'today': today}), CreditCard.fromJson);

  Future<void> createCard({required String name, required int closingDay, required int dueDay, int? limitCents}) =>
      client.post('/api/cards', {
        'name': name,
        'closingDay': closingDay,
        'dueDay': dueDay,
        'limitCents': limitCents,
      });

  Future<void> deleteCard(String id) => client.delete('/api/cards/$id');

  Future<InvoiceDetail> invoice(String cardId, String? month) async =>
      InvoiceDetail.fromJson(await client.get('/api/cards/$cardId/invoice', query: {'month': month}) as Json);

  Future<void> createCardPurchase(
    String cardId, {
    required int amountCents,
    required int installments,
    required String purchasedOn,
    required String categoryId,
    String? note,
  }) =>
      client.post('/api/cards/$cardId/purchases', {
        'amountCents': amountCents,
        'installments': installments,
        'purchasedOn': purchasedOn,
        'categoryId': categoryId,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      });

  Future<void> deleteCardPurchase(String id) => client.delete('/api/card-purchases/$id');

  /* ── Entradas fixas ── */

  Future<List<Income>> incomes() async => _list(await client.get('/api/incomes'), Income.fromJson);

  Future<void> createIncome({required String name, required int amountCents, required int receiptDay}) =>
      client.post('/api/incomes', {'name': name, 'amountCents': amountCents, 'receiptDay': receiptDay});

  Future<void> deleteIncome(String id) => client.delete('/api/incomes/$id');

  /* ── Dívidas ── */

  Future<DebtOverview> debts() async => DebtOverview.fromJson(await client.get('/api/debts') as Json);

  Future<void> createDebt({
    required String name,
    required int installmentCents,
    required int paidInstallments,
    required int totalInstallments,
  }) =>
      client.post('/api/debts', {
        'name': name,
        'installmentCents': installmentCents,
        'paidInstallments': paidInstallments,
        'totalInstallments': totalInstallments,
      });

  Future<void> setDebtPaidInstallments(String id, int paidInstallments) =>
      client.patch('/api/debts/$id', {'paidInstallments': paidInstallments});

  Future<void> deleteDebt(String id) => client.delete('/api/debts/$id');

  Future<void> convertDebt(String id, {required String categoryId, required int dueDay}) =>
      client.post('/api/debts/$id/convert', {'categoryId': categoryId, 'dueDay': dueDay});

  /* ── Metas ── */

  Future<List<Goal>> goals() async => _list(await client.get('/api/goals'), Goal.fromJson);

  Future<void> createGoal({required String name, required int targetCents, required bool featured}) =>
      client.post('/api/goals', {'name': name, 'targetCents': targetCents, 'savedCents': 0, 'featured': featured});

  Future<void> deleteGoal(String id) => client.delete('/api/goals/$id');

  Future<void> depositToGoal(String id, int amountCents) =>
      client.post('/api/goals/$id/deposits', {'amountCents': amountCents});

  /* ── Ajustes ── */

  Future<Settings> settings() async => Settings.fromJson(await client.get('/api/settings') as Json);

  Future<Settings> updateSettings(Map<String, Object?> data) async =>
      Settings.fromJson(await client.patch('/api/settings', data) as Json);
}
