// Teste de integração contra uma API de verdade (Node local ou homologação).
// Só roda quando GRANA_API_URL está definida:
//
//   GRANA_API_URL=http://localhost:3333 GRANA_ADMIN_EMAIL=admin@grana.app \
//   GRANA_ADMIN_PASSWORD=... flutter test test/live_api_test.dart
//
// Cria um usuário descartável, exercita os fluxos de escrita do app e o apaga
// no final. Os dados do admin são só lidos.
@Tags(['live'])
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:grana_mobile/core/dates.dart';
import 'package:grana_mobile/data/api_client.dart';
import 'package:grana_mobile/data/grana_api.dart';
import 'package:grana_mobile/data/models.dart';
import 'package:grana_mobile/data/token_store.dart';

final _url = Platform.environment['GRANA_API_URL'];
final _adminEmail = Platform.environment['GRANA_ADMIN_EMAIL'] ?? 'admin@grana.app';
final _adminPassword = Platform.environment['GRANA_ADMIN_PASSWORD'] ?? '';

// Os grupos são montados mesmo quando pulados; a URL de reserva nunca é chamada.
GranaApi _newApi() => GranaApi(ApiClient(baseUrl: _url ?? 'http://localhost', tokens: MemoryRefreshTokenStore()));

void main() {
  final skip = _url == null ? 'defina GRANA_API_URL para rodar' : null;
  final today = localTodayISO();
  final month = currentMonthRef();

  group('leitura de todas as telas (dados de demonstração do admin)', skip: skip, () {
    final api = _newApi();

    setUpAll(() => api.login(_adminEmail, _adminPassword));

    test('Início, Diário e Resultado: saldo futuro', () async {
      final home = await api.cashflow(from: addDaysISO(today, -14), to: addDaysISO(today, 60), today: today);
      final result = await api.cashflow(
        from: '${addMonths(month, -5)}-01',
        to: lastDayOfMonthISO('${addMonths(month, 1)}-01'),
        today: today,
      );
      // Sem saldo inicial a API responde `configured: false` e listas vazias
      // (a tela mostra o primeiro acesso); com saldo, há dias e meses.
      expect(home.days.isNotEmpty, home.configured);
      expect(result.months.isNotEmpty, result.configured);
    });

    test('Resumo do mês, Categorias, Lista', () async {
      final summary = await api.dashboard(month);
      final report = await api.categoryReport(month);
      final page = await api.transactions(month: month);
      expect(summary.weeks, hasLength(4));
      expect(report.comparison, isNotEmpty);
      expect(page.summary, contains('lançamento'));
    });

    test('Contas, atrasos, Cartões e faturas', () async {
      final bills = await api.bills(month);
      await api.overdueBills(today);
      final cards = await api.cards(today);
      for (final card in cards) {
        await api.invoice(card.id, card.invoices.firstOrNull?.month);
      }
      expect(bills.calendar, isNotEmpty);
    });

    test('Parcelas, Guardar, Ajustes, categorias e entradas', () async {
      await api.debts();
      await api.goals();
      await api.incomes();
      final settings = await api.settings();
      final categories = await api.categories();
      expect(categories, isNotEmpty);
      expect(settings.roundCents, isA<bool>());
    });
  });

  group('fluxos de escrita com um usuário descartável', skip: skip, () {
    final admin = _newApi();
    final api = _newApi();
    final email = 'app.mobile.${DateTime.now().millisecondsSinceEpoch}@teste.grana.app';
    const password = 'SenhaDoTeste123';
    late String userId;

    setUpAll(() async {
      await admin.login(_adminEmail, _adminPassword);
      final created = await admin.client.post('/api/admin/users', {
        'name': 'Teste do app',
        'email': email,
        'password': password,
        'mustChangePassword': false,
      }) as Json;
      userId = created['id'] as String;
      await api.login(email, password);
    });

    tearDownAll(() async {
      await admin.client.delete('/api/admin/users/$userId');
    });

    test('sessão: o refresh token guardado reabre o app', () async {
      final reopened = GranaApi(ApiClient(baseUrl: api.client.baseUrl, tokens: api.client.tokens));
      final user = await reopened.restore();
      expect(user?.email, email);
      // O refresh rotaciona o token: o app original passa a usar o novo.
      api.client.accessToken = reopened.client.accessToken;
    });

    test('primeiro acesso: saldo inicial liga o saldo futuro', () async {
      final before = await api.cashflow(from: today, to: addDaysISO(today, 30), today: today);
      expect(before.configured, isFalse);
      await api.updateSettings({'openingBalanceCents': 100000, 'openingDate': today});
      final after = await api.cashflow(from: today, to: addDaysISO(today, 30), today: today);
      expect(after.configured, isTrue);
      expect(after.todayBalanceCents, 100000);
    });

    test('lançar gasto pelo teclado tira do saldo de hoje', () async {
      final market = (await api.categories()).firstWhere((c) => c.name == 'Mercado');
      await api.createTransaction(
        type: 'EXPENSE',
        amountCents: 1250,
        categoryId: market.id,
        occurredOn: today,
        note: 'feira',
      );
      final cashflow = await api.cashflow(from: today, to: today, today: today);
      expect(cashflow.todayBalanceCents, 100000 - 1250);
      final page = await api.transactions(month: month);
      expect(page.groups.first.items.first.note, 'feira');
      await api.deleteTransaction(page.groups.first.items.first.id);
    });

    test('conta fixa: cadastrar, pagar, desfazer e excluir', () async {
      final house = (await api.categories()).firstWhere((c) => c.name == 'Casa');
      await api.createBill(name: 'Aluguel', categoryId: house.id, amountCents: 120000, dueDay: 28);
      var bill = (await api.bills(month)).bills.single;
      await api.setBillPayment(bill.id, month: month, paid: true);
      bill = (await api.bills(month)).bills.single;
      expect(bill.paid, isTrue);
      await api.setBillPayment(bill.id, month: month, paid: false);
      expect((await api.bills(month)).bills.single.paid, isFalse);
      await api.deleteBill(bill.id);
      expect((await api.bills(month)).bills, isEmpty);
    });

    test('cartão: compra parcelada vira fatura e o limite usado sobe', () async {
      await api.createCard(name: 'Cartão teste', closingDay: 3, dueDay: 10, limitCents: 500000);
      final card = (await api.cards(today)).single;
      final category = (await api.categories()).firstWhere((c) => c.isExpense);
      await api.createCardPurchase(
        card.id,
        amountCents: 60000,
        installments: 3,
        purchasedOn: today,
        categoryId: category.id,
      );
      final updated = (await api.cards(today)).single;
      expect(updated.usedLimitCents, 60000);
      final invoice = await api.invoice(card.id, updated.invoices.firstWhere((i) => i.totalCents > 0).month);
      expect(invoice.items.single.installments, 3);
      await api.deleteCardPurchase(invoice.items.single.purchaseId);
      await api.deleteCard(card.id);
    });

    test('posso comprar? responde com veredito', () async {
      final result = await api.simulate(
        from: today,
        to: addDaysISO(today, 90),
        today: today,
        amountCents: 500000,
        installments: 1,
        date: today,
        method: 'ACCOUNT',
      );
      expect(result.fits, isFalse);
      expect(result.verdict, contains('Seu menor saldo vai de'));
    });

    test('metas: criar, guardar e excluir', () async {
      await api.createGoal(name: 'Reserva', targetCents: 600000, featured: true);
      final goal = (await api.goals()).single;
      await api.depositToGoal(goal.id, 5000);
      expect((await api.goals()).single.savedCents, 5000);
      await api.deleteGoal(goal.id);
    });

    test('parcelas: cadastrar, pagar uma e mover para Contas', () async {
      await api.createDebt(name: 'Geladeira', installmentCents: 43000, paidInstallments: 2, totalInstallments: 10);
      final debt = (await api.debts()).debts.single;
      await api.setDebtPaidInstallments(debt.id, 3);
      final house = (await api.categories()).firstWhere((c) => c.name == 'Casa');
      await api.convertDebt(debt.id, categoryId: house.id, dueDay: 15);
      expect((await api.debts()).debts, isEmpty);
      final bill = (await api.bills(month)).bills.single;
      expect(bill.totalInstallments, 7);
      await api.deleteBill(bill.id);
    });

    test('ajustes: entrada fixa, categoria nova, arquivar e excluir', () async {
      await api.createIncome(name: 'Salário', amountCents: 420000, receiptDay: 5);
      final income = (await api.incomes()).single;
      await api.deleteIncome(income.id);

      final created = await api.createCategory(name: 'Farmácia', kind: 'EXPENSE');
      await api.archiveCategory(created.id);
      expect((await api.categories()).any((c) => c.id == created.id), isFalse);
      await api.deleteCategory(created.id);

      await api.updateSettings({'roundCents': true});
      expect((await api.settings()).roundCents, isTrue);
    });

    test('erro da API chega com a mensagem em português', () async {
      final system = (await api.categories()).firstWhere((c) => c.isSystem);
      await expectLater(
        api.deleteCategory(system.id),
        throwsA(isA<ApiError>().having((e) => e.message, 'message', contains('Categorias padrão'))),
      );
    });

    test('sair invalida o refresh token', () async {
      await api.logout();
      expect(await api.client.tokens.read(), isNull);
      expect(await api.restore(), isNull);
    });
  });
}
