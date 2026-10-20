/// DTOs da API — espelham `packages/shared/src/contracts/*.contract.ts`.
/// Só leitura de JSON; os corpos de requisição são montados em `GranaApi`.
library;

typedef Json = Map<String, dynamic>;

List<T> _list<T>(Object? raw, T Function(Json) parse) =>
    (raw as List<dynamic>? ?? const []).cast<Json>().map(parse).toList();

/* ─────────────────────────────── Sessão ─────────────────────────────── */

class AuthUser {
  AuthUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    required this.status,
    required this.mustChangePassword,
  });

  factory AuthUser.fromJson(Json json) => AuthUser(
        id: json['id'] as String,
        name: json['name'] as String,
        email: json['email'] as String,
        role: json['role'] as String,
        status: json['status'] as String,
        mustChangePassword: json['mustChangePassword'] as bool,
      );

  final String id;
  final String name;
  final String email;
  final String role;
  final String status;
  final bool mustChangePassword;

  bool get isAdmin => role == 'ADMIN';

  AuthUser copyWith({String? name}) => AuthUser(
        id: id,
        name: name ?? this.name,
        email: email,
        role: role,
        status: status,
        mustChangePassword: mustChangePassword,
      );
}

/* ───────────────────────────── Categorias ───────────────────────────── */

class CategoryRef {
  CategoryRef({required this.id, required this.name, required this.color, required this.kind});

  factory CategoryRef.fromJson(Json json) => CategoryRef(
        id: json['id'] as String,
        name: json['name'] as String,
        color: json['color'] as String,
        kind: json['kind'] as String,
      );

  final String id;
  final String name;
  final String color;
  final String kind;
}

class Category extends CategoryRef {
  Category({
    required super.id,
    required super.name,
    required super.color,
    required super.kind,
    required this.isSystem,
    required this.archivedAt,
  });

  factory Category.fromJson(Json json) => Category(
        id: json['id'] as String,
        name: json['name'] as String,
        color: json['color'] as String,
        kind: json['kind'] as String,
        isSystem: json['isSystem'] as bool,
        archivedAt: json['archivedAt'] as String?,
      );

  final bool isSystem;
  final String? archivedAt;

  bool get isExpense => kind == 'EXPENSE';
  bool get archived => archivedAt != null;
}

/* ──────────────────────────── Lançamentos ───────────────────────────── */

class Transaction {
  Transaction({
    required this.id,
    required this.type,
    required this.amountCents,
    required this.occurredOn,
    required this.note,
    required this.category,
  });

  factory Transaction.fromJson(Json json) => Transaction(
        id: json['id'] as String,
        type: json['type'] as String,
        amountCents: json['amountCents'] as int,
        occurredOn: json['occurredOn'] as String,
        note: json['note'] as String?,
        category: CategoryRef.fromJson(json['category'] as Json),
      );

  final String id;
  final String type;
  final int amountCents;
  final String occurredOn;
  final String? note;
  final CategoryRef category;

  bool get isIncome => type == 'INCOME';
}

class TransactionGroup {
  TransactionGroup({required this.date, required this.label, required this.totalCents, required this.items});

  factory TransactionGroup.fromJson(Json json) => TransactionGroup(
        date: json['date'] as String,
        label: json['label'] as String,
        totalCents: json['totalCents'] as int,
        items: _list(json['items'], Transaction.fromJson),
      );

  final String date;
  final String label;
  final int totalCents;
  final List<Transaction> items;
}

class TransactionsPage {
  TransactionsPage({required this.groups, required this.summary, required this.total});

  factory TransactionsPage.fromJson(Json json) => TransactionsPage(
        groups: _list(json['groups'], TransactionGroup.fromJson),
        summary: json['summary'] as String,
        total: json['total'] as int,
      );

  final List<TransactionGroup> groups;
  final String summary;
  final int total;
}

/* ─────────────────────────── Contas fixas ───────────────────────────── */

class Bill {
  Bill({
    required this.id,
    required this.name,
    required this.amountCents,
    required this.dueDay,
    required this.active,
    required this.category,
    required this.paid,
    required this.waived,
    required this.dueDate,
    required this.totalInstallments,
    required this.installmentNumber,
  });

  factory Bill.fromJson(Json json) => Bill(
        id: json['id'] as String,
        name: json['name'] as String,
        amountCents: json['amountCents'] as int,
        dueDay: json['dueDay'] as int,
        active: json['active'] as bool,
        category: CategoryRef.fromJson(json['category'] as Json),
        paid: json['paid'] as bool,
        waived: json['waived'] as bool,
        dueDate: json['dueDate'] as String,
        totalInstallments: json['totalInstallments'] as int?,
        installmentNumber: json['installmentNumber'] as int?,
      );

  final String id;
  final String name;
  final int amountCents;
  final int dueDay;
  final bool active;
  final CategoryRef category;
  final bool paid;
  final bool waived;
  final String dueDate;
  final int? totalInstallments;
  final int? installmentNumber;
}

class CalendarDay {
  CalendarDay({required this.day, required this.isToday, required this.hasBill, required this.allPaid});

  factory CalendarDay.fromJson(Json json) => CalendarDay(
        day: json['day'] as int?,
        isToday: json['isToday'] as bool,
        hasBill: json['hasBill'] as bool,
        allPaid: json['allPaid'] as bool,
      );

  final int? day;
  final bool isToday;
  final bool hasBill;
  final bool allPaid;
}

class BillsOverview {
  BillsOverview({required this.bills, required this.paidCents, required this.dueCents, required this.calendar});

  factory BillsOverview.fromJson(Json json) => BillsOverview(
        bills: _list(json['bills'], Bill.fromJson),
        paidCents: json['paidCents'] as int,
        dueCents: json['dueCents'] as int,
        calendar: _list(json['calendar'], CalendarDay.fromJson),
      );

  final List<Bill> bills;
  final int paidCents;
  final int dueCents;
  final List<CalendarDay> calendar;
}

class OverdueBill {
  OverdueBill({
    required this.billId,
    required this.name,
    required this.month,
    required this.dueDate,
    required this.amountCents,
    required this.daysLate,
    required this.installmentNumber,
    required this.totalInstallments,
  });

  factory OverdueBill.fromJson(Json json) => OverdueBill(
        billId: json['billId'] as String,
        name: json['name'] as String,
        month: json['month'] as String,
        dueDate: json['dueDate'] as String,
        amountCents: json['amountCents'] as int,
        daysLate: json['daysLate'] as int,
        installmentNumber: json['installmentNumber'] as int?,
        totalInstallments: json['totalInstallments'] as int?,
      );

  final String billId;
  final String name;
  final String month;
  final String dueDate;
  final int amountCents;
  final int daysLate;
  final int? installmentNumber;
  final int? totalInstallments;
}

/* ──────────────────────── Entradas, dívidas, metas ──────────────────── */

class Income {
  Income({required this.id, required this.name, required this.amountCents, required this.receiptDay, required this.active});

  factory Income.fromJson(Json json) => Income(
        id: json['id'] as String,
        name: json['name'] as String,
        amountCents: json['amountCents'] as int,
        receiptDay: json['receiptDay'] as int,
        active: json['active'] as bool,
      );

  final String id;
  final String name;
  final int amountCents;
  final int receiptDay;
  final bool active;
}

class Debt {
  Debt({
    required this.id,
    required this.name,
    required this.installmentCents,
    required this.paidInstallments,
    required this.totalInstallments,
    required this.remainingInstallments,
    required this.remainingCents,
    required this.progressPercent,
    required this.settled,
  });

  factory Debt.fromJson(Json json) => Debt(
        id: json['id'] as String,
        name: json['name'] as String,
        installmentCents: json['installmentCents'] as int,
        paidInstallments: json['paidInstallments'] as int,
        totalInstallments: json['totalInstallments'] as int,
        remainingInstallments: json['remainingInstallments'] as int,
        remainingCents: json['remainingCents'] as int,
        progressPercent: json['progressPercent'] as int,
        settled: json['settled'] as bool,
      );

  final String id;
  final String name;
  final int installmentCents;
  final int paidInstallments;
  final int totalInstallments;
  final int remainingInstallments;
  final int remainingCents;
  final int progressPercent;
  final bool settled;
}

class DebtOverview {
  DebtOverview({required this.debts, required this.monthlyTotalCents, required this.projection, required this.note});

  factory DebtOverview.fromJson(Json json) => DebtOverview(
        debts: _list(json['debts'], Debt.fromJson),
        monthlyTotalCents: json['monthlyTotalCents'] as int,
        projection: _list(
          json['projection'],
          (p) => (month: p['month'] as String, label: p['label'] as String, totalCents: p['totalCents'] as int),
        ),
        note: json['note'] as String,
      );

  final List<Debt> debts;
  final int monthlyTotalCents;
  final List<({String month, String label, int totalCents})> projection;
  final String note;
}

class Goal {
  Goal({
    required this.id,
    required this.name,
    required this.targetCents,
    required this.savedCents,
    required this.remainingCents,
    required this.progressPercent,
    required this.achieved,
    required this.featured,
  });

  factory Goal.fromJson(Json json) => Goal(
        id: json['id'] as String,
        name: json['name'] as String,
        targetCents: json['targetCents'] as int,
        savedCents: json['savedCents'] as int,
        remainingCents: json['remainingCents'] as int,
        progressPercent: json['progressPercent'] as int,
        achieved: json['achieved'] as bool,
        featured: json['featured'] as bool,
      );

  final String id;
  final String name;
  final int targetCents;
  final int savedCents;
  final int remainingCents;
  final int progressPercent;
  final bool achieved;
  final bool featured;
}

/* ───────────────────────────── Ajustes ──────────────────────────────── */

class Settings {
  Settings({
    required this.overspendAlerts,
    required this.weeklySummary,
    required this.roundCents,
    required this.autoDarkMode,
    required this.showDailyAllowance,
    required this.openingBalanceCents,
    required this.openingDate,
    required this.dailyBudgetCents,
  });

  factory Settings.fromJson(Json json) => Settings(
        overspendAlerts: json['overspendAlerts'] as bool,
        weeklySummary: json['weeklySummary'] as bool,
        roundCents: json['roundCents'] as bool,
        autoDarkMode: json['autoDarkMode'] as bool,
        showDailyAllowance: json['showDailyAllowance'] as bool,
        openingBalanceCents: json['openingBalanceCents'] as int,
        openingDate: json['openingDate'] as String?,
        dailyBudgetCents: json['dailyBudgetCents'] as int?,
      );

  final bool overspendAlerts;
  final bool weeklySummary;
  final bool roundCents;
  final bool autoDarkMode;
  final bool showDailyAllowance;
  final int openingBalanceCents;
  final String? openingDate;
  final int? dailyBudgetCents;

  bool flag(String key) => switch (key) {
        'overspendAlerts' => overspendAlerts,
        'weeklySummary' => weeklySummary,
        'roundCents' => roundCents,
        'autoDarkMode' => autoDarkMode,
        'showDailyAllowance' => showDailyAllowance,
        _ => false,
      };
}

/* ─────────────────────── Dashboard e relatório ──────────────────────── */

class WeekBar {
  WeekBar({required this.index, required this.label, required this.totalCents, required this.heightPercent, required this.current});

  factory WeekBar.fromJson(Json json) => WeekBar(
        index: json['index'] as int,
        label: json['label'] as String,
        totalCents: json['totalCents'] as int,
        heightPercent: json['heightPercent'] as int,
        current: json['current'] as bool,
      );

  final int index;
  final String label;
  final int totalCents;
  final int heightPercent;
  final bool current;
}

class UpcomingBill {
  UpcomingBill({required this.id, required this.name, required this.amountCents, required this.dueDay, required this.dueDate, required this.whenLabel});

  factory UpcomingBill.fromJson(Json json) => UpcomingBill(
        id: json['id'] as String,
        name: json['name'] as String,
        amountCents: json['amountCents'] as int,
        dueDay: json['dueDay'] as int,
        dueDate: json['dueDate'] as String,
        whenLabel: json['whenLabel'] as String,
      );

  final String id;
  final String name;
  final int amountCents;
  final int dueDay;
  final String dueDate;
  final String whenLabel;
}

class DashboardSummary {
  DashboardSummary({
    required this.isCurrentMonth,
    required this.incomeCents,
    required this.billsDueCents,
    required this.spentCents,
    required this.leftoverCents,
    required this.dailyAllowanceCents,
    required this.spentPercent,
    required this.duePercent,
    required this.leftoverPercent,
    required this.weeks,
    required this.weekNote,
    required this.upcomingBills,
  });

  factory DashboardSummary.fromJson(Json json) {
    final bars = json['bars'] as Json;
    return DashboardSummary(
      isCurrentMonth: json['isCurrentMonth'] as bool,
      incomeCents: json['incomeCents'] as int,
      billsDueCents: json['billsDueCents'] as int,
      spentCents: json['spentCents'] as int,
      leftoverCents: json['leftoverCents'] as int,
      dailyAllowanceCents: json['dailyAllowanceCents'] as int,
      spentPercent: bars['spentPercent'] as int,
      duePercent: bars['duePercent'] as int,
      leftoverPercent: bars['leftoverPercent'] as int,
      weeks: _list(json['weeks'], WeekBar.fromJson),
      weekNote: json['weekNote'] as String,
      upcomingBills: _list(json['upcomingBills'], UpcomingBill.fromJson),
    );
  }

  final bool isCurrentMonth;
  final int incomeCents;
  final int billsDueCents;
  final int spentCents;
  final int leftoverCents;
  final int dailyAllowanceCents;
  final int spentPercent;
  final int duePercent;
  final int leftoverPercent;
  final List<WeekBar> weeks;
  final String weekNote;
  final List<UpcomingBill> upcomingBills;
}

class CategoryReportItem {
  CategoryReportItem({required this.name, required this.color, required this.totalCents, required this.percent, required this.relativeWidth});

  factory CategoryReportItem.fromJson(Json json) => CategoryReportItem(
        name: json['name'] as String,
        color: json['color'] as String,
        totalCents: json['totalCents'] as int,
        percent: json['percent'] as int,
        relativeWidth: json['relativeWidth'] as int,
      );

  final String name;
  final String color;
  final int totalCents;
  final int percent;
  final int relativeWidth;
}

class CategoryReport {
  CategoryReport({required this.monthLabel, required this.totalCents, required this.items, required this.comparison});

  factory CategoryReport.fromJson(Json json) => CategoryReport(
        monthLabel: json['monthLabel'] as String,
        totalCents: json['totalCents'] as int,
        items: _list(json['items'], CategoryReportItem.fromJson),
        comparison: json['comparison'] as String,
      );

  final String monthLabel;
  final int totalCents;
  final List<CategoryReportItem> items;
  final String comparison;
}

/* ──────────────────────────── Saldo futuro ──────────────────────────── */

class CashflowEvent {
  CashflowEvent({required this.kind, required this.label, required this.amountCents, required this.projected, required this.refId});

  factory CashflowEvent.fromJson(Json json) => CashflowEvent(
        kind: json['kind'] as String,
        label: json['label'] as String,
        amountCents: json['amountCents'] as int,
        projected: json['projected'] as bool,
        refId: json['refId'] as String?,
      );

  final String kind;
  final String label;
  final int amountCents;
  final bool projected;
  final String? refId;
}

class CashflowDay {
  CashflowDay({required this.date, required this.balanceCents, required this.projected, required this.events});

  factory CashflowDay.fromJson(Json json) => CashflowDay(
        date: json['date'] as String,
        balanceCents: json['balanceCents'] as int,
        projected: json['projected'] as bool,
        events: _list(json['events'], CashflowEvent.fromJson),
      );

  final String date;
  final int balanceCents;
  final bool projected;
  final List<CashflowEvent> events;
}

class CashflowMonth {
  CashflowMonth({
    required this.month,
    required this.label,
    required this.openingCents,
    required this.inCents,
    required this.outCents,
    required this.savedCents,
    required this.resultCents,
    required this.closingCents,
    required this.closed,
  });

  factory CashflowMonth.fromJson(Json json) => CashflowMonth(
        month: json['month'] as String,
        label: json['label'] as String,
        openingCents: json['openingCents'] as int,
        inCents: json['inCents'] as int,
        outCents: json['outCents'] as int,
        savedCents: json['savedCents'] as int,
        resultCents: json['resultCents'] as int,
        closingCents: json['closingCents'] as int,
        closed: json['closed'] as bool,
      );

  final String month;
  final String label;
  final int openingCents;
  final int inCents;
  final int outCents;
  final int savedCents;
  final int resultCents;
  final int closingCents;
  final bool closed;
}

typedef BalancePoint = ({String date, int balanceCents});

class Cashflow {
  Cashflow({
    required this.configured,
    required this.openingDate,
    required this.todayBalanceCents,
    required this.endOfMonthCents,
    required this.lowest,
    required this.firstNegativeDate,
    required this.dailyAverageCents,
    required this.overdueBills,
    required this.days,
    required this.months,
  });

  factory Cashflow.fromJson(Json json) {
    final lowest = json['lowest'] as Json?;
    return Cashflow(
      configured: json['configured'] as bool,
      openingDate: json['openingDate'] as String?,
      todayBalanceCents: json['todayBalanceCents'] as int,
      endOfMonthCents: json['endOfMonthCents'] as int,
      lowest: lowest == null
          ? null
          : (date: lowest['date'] as String, balanceCents: lowest['balanceCents'] as int),
      firstNegativeDate: json['firstNegativeDate'] as String?,
      dailyAverageCents: json['dailyAverageCents'] as int,
      overdueBills: _list(json['overdueBills'], OverdueBill.fromJson),
      days: _list(json['days'], CashflowDay.fromJson),
      months: _list(json['months'], CashflowMonth.fromJson),
    );
  }

  final bool configured;
  final String? openingDate;
  final int todayBalanceCents;
  final int endOfMonthCents;
  final BalancePoint? lowest;
  final String? firstNegativeDate;
  final int dailyAverageCents;
  final List<OverdueBill> overdueBills;
  final List<CashflowDay> days;
  final List<CashflowMonth> months;
}

class SimulationResult {
  SimulationResult({required this.before, required this.after, required this.verdict, required this.fits});

  factory SimulationResult.fromJson(Json json) => SimulationResult(
        before: Cashflow.fromJson(json['before'] as Json),
        after: Cashflow.fromJson(json['after'] as Json),
        verdict: json['verdict'] as String,
        fits: json['fits'] as bool,
      );

  final Cashflow before;
  final Cashflow after;
  final String verdict;
  final bool fits;
}

/* ───────────────────────────── Cartões ──────────────────────────────── */

class InvoiceSummary {
  InvoiceSummary({required this.month, required this.dueDate, required this.totalCents, required this.status});

  factory InvoiceSummary.fromJson(Json json) => InvoiceSummary(
        month: json['month'] as String,
        dueDate: json['dueDate'] as String,
        totalCents: json['totalCents'] as int,
        status: json['status'] as String,
      );

  final String month;
  final String dueDate;
  final int totalCents;
  final String status;
}

class CreditCard {
  CreditCard({
    required this.id,
    required this.name,
    required this.closingDay,
    required this.dueDay,
    required this.limitCents,
    required this.active,
    required this.usedLimitCents,
    required this.invoices,
  });

  factory CreditCard.fromJson(Json json) => CreditCard(
        id: json['id'] as String,
        name: json['name'] as String,
        closingDay: json['closingDay'] as int,
        dueDay: json['dueDay'] as int,
        limitCents: json['limitCents'] as int?,
        active: json['active'] as bool,
        usedLimitCents: json['usedLimitCents'] as int,
        invoices: _list(json['invoices'], InvoiceSummary.fromJson),
      );

  final String id;
  final String name;
  final int closingDay;
  final int dueDay;
  final int? limitCents;
  final bool active;
  final int usedLimitCents;
  final List<InvoiceSummary> invoices;
}

class InvoiceItem {
  InvoiceItem({
    required this.purchaseId,
    required this.label,
    required this.category,
    required this.purchasedOn,
    required this.installmentNumber,
    required this.installments,
    required this.amountCents,
  });

  factory InvoiceItem.fromJson(Json json) => InvoiceItem(
        purchaseId: json['purchaseId'] as String,
        label: json['label'] as String,
        category: CategoryRef.fromJson(json['category'] as Json),
        purchasedOn: json['purchasedOn'] as String,
        installmentNumber: json['installmentNumber'] as int,
        installments: json['installments'] as int,
        amountCents: json['amountCents'] as int,
      );

  final String purchaseId;
  final String label;
  final CategoryRef category;
  final String purchasedOn;
  final int installmentNumber;
  final int installments;
  final int amountCents;
}

class InvoiceDetail {
  InvoiceDetail({required this.month, required this.items});

  factory InvoiceDetail.fromJson(Json json) =>
      InvoiceDetail(month: json['month'] as String, items: _list(json['items'], InvoiceItem.fromJson));

  final String month;
  final List<InvoiceItem> items;
}
