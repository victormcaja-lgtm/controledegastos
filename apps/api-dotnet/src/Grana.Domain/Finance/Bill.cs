using Grana.Domain.Common;

namespace Grana.Domain.Finance;

/// <summary>
/// Conta fixa — modelo recorrente, pago por COMPETÊNCIA (RN-090–101). A baixa de um mês
/// fica em <see cref="BillPayment"/>; "aluguel de setembro pago" não diz nada sobre outubro.
/// </summary>
public sealed class Bill
{
    public const string ExpenseCategoryMessage = "Contas fixas precisam de uma categoria de despesa.";

    private Bill(string id, string userId, CategoryRef category, string name, int amountCents, int dueDay, bool active, MonthRef startMonth, int? totalInstallments)
    {
        Id = id;
        UserId = userId;
        Category = category;
        Name = name;
        AmountCents = amountCents;
        DueDay = dueDay;
        Active = active;
        StartMonth = startMonth;
        TotalInstallments = totalInstallments;
    }

    public string Id { get; }

    public string UserId { get; }

    public CategoryRef Category { get; private set; }

    public string Name { get; private set; }

    public int AmountCents { get; private set; }

    /// <summary>1–31; em meses mais curtos, vence no último dia.</summary>
    public int DueDay { get; private set; }

    public bool Active { get; private set; }

    /// <summary>Competência a partir da qual a conta vigora; não muda depois de criada (RN-091).</summary>
    public MonthRef StartMonth { get; }

    /// <summary><c>null</c> = recorrente sem fim; senão, quantas parcelas.</summary>
    public int? TotalInstallments { get; private set; }

    public static Bill Restore(
        string id, string userId, CategoryRef category, string name, int amountCents, int dueDay, bool active, MonthRef startMonth, int? totalInstallments) =>
        new(id, userId, category, name, amountCents, dueDay, active, startMonth, totalInstallments);

    /// <summary>
    /// Nova conta, vigente a partir da competência atual em UTC (RN-090). Categoria de
    /// despesa; arquivada é aceita.
    /// </summary>
    public static Bill Create(
        string id, string userId, Category category, string name, int amountCents, int dueDay, int? totalInstallments, MonthRef currentMonth)
    {
        EnsureExpense(category);
        return new(id, userId, CategoryRef.Of(category), name, amountCents, dueDay, active: true, currentMonth, totalInstallments);
    }

    /// <summary>A dívida vira conta com prazo: começa no mês atual, com as parcelas que faltam (RN-108).</summary>
    public static Bill FromDebt(string id, Debt debt, Category category, int dueDay, MonthRef currentMonth)
    {
        ArgumentNullException.ThrowIfNull(debt);
        var installments = debt.InstallmentsToConvert();
        EnsureExpense(category);
        return new(id, debt.UserId, CategoryRef.Of(category), debt.Name, debt.InstallmentCents, dueDay, active: true, currentMonth, installments);
    }

    /// <summary>Edição (RN-091): mesma regra de categoria da criação.</summary>
    public void ChangeCategory(Category category)
    {
        EnsureExpense(category);
        Category = CategoryRef.Of(category);
    }

    public void Update(Patch<string> name, Patch<int> amountCents, Patch<int> dueDay, Patch<bool> active, Patch<int?> totalInstallments)
    {
        Name = name.Or(Name);
        AmountCents = amountCents.Or(AmountCents);
        DueDay = dueDay.Or(DueDay);
        Active = active.Or(Active);
        TotalInstallments = totalInstallments.Or(TotalInstallments);
    }

    /// <summary>Número da parcela na competência (<c>billInstallmentNumber</c>); <c>null</c> sem prazo. ⚠️ Pode ser ≤ 0 antes do início (RN-097).</summary>
    public int? InstallmentNumber(MonthRef month) =>
        TotalInstallments is null ? null : StartMonth.MonthsUntil(month) + 1;

    /// <summary>Encerrada quando a parcela da competência passa do total (RN-093).</summary>
    public bool IsFinishedIn(MonthRef month) => InstallmentNumber(month) is { } number && number > TotalInstallments;

    /// <summary>Dia de vencimento na competência, limitado ao fim do mês (<c>isoDateFromMonthDay</c>).</summary>
    public DateOnly DueDate(MonthRef month) => month.DayOf(DueDay);

    /// <summary>
    /// Competências em que a conta vigora, de <c>max(startMonth, from)</c> até <paramref name="to"/>
    /// e dentro do prazo (<c>billMonths</c> do saldo futuro — que, ao contrário da visão do
    /// mês, respeita o início).
    /// </summary>
    public IEnumerable<MonthRef> MonthsBetween(MonthRef from, MonthRef to)
    {
        for (var month = StartMonth > from ? StartMonth : from; month <= to; month = month.AddMonths(1))
        {
            if (IsFinishedIn(month)) yield break;
            yield return month;
        }
    }

    private static void EnsureExpense(Category category)
    {
        ArgumentNullException.ThrowIfNull(category);
        if (category.Kind != CategoryKind.Expense) throw new BusinessRuleError(ExpenseCategoryMessage);
    }
}

public enum BillPaymentStatus
{
    Paid = 0,

    /// <summary>"Não vou pagar": tira a competência da projeção sem mexer no saldo.</summary>
    Waived = 1,
}

/// <summary>Baixa de uma competência (única por conta e mês).</summary>
public sealed record BillPayment(string BillId, MonthRef Month, BillPaymentStatus Status, int AmountCents, DateTime PaidAt);

/// <summary>Conta vencida e sem baixa (RN-101).</summary>
public sealed record OverdueBill(
    string BillId, string Name, MonthRef Month, DateOnly DueDate, int AmountCents, int DaysLate, int? InstallmentNumber, int? TotalInstallments);

/// <summary>Uma célula do calendário do mês: <c>Day</c> nulo nas células antes do dia 1.</summary>
public sealed record BillsCalendarDay(int? Day, bool IsToday, bool HasBill, bool AllPaid);

/// <summary>Calendário e atrasadas — <c>buildCalendar</c> e <c>findOverdueBills</c>.</summary>
public static class BillsCalendar
{
    /// <summary>
    /// Células vazias até o dia da semana do dia 1 (domingo = 0) e uma por dia. Marca as
    /// contas ATIVAS pelo <c>dueDay</c> exato — ⚠️ a do dia 31 some em meses curtos (RN-100).
    /// </summary>
    public static IReadOnlyList<BillsCalendarDay> Build(
        MonthRef month, IReadOnlyList<(Bill Bill, BillPayment? Payment)> activeBills, DateOnly todayUtc)
    {
        ArgumentNullException.ThrowIfNull(activeBills);
        var isCurrentMonth = MonthRef.Of(todayUtc) == month;
        var cells = new List<BillsCalendarDay>();
        cells.AddRange(Enumerable.Repeat(new BillsCalendarDay(null, false, false, false), (int)month.Start.DayOfWeek));
        for (var day = 1; day <= month.DaysInMonth; day++)
        {
            var dayBills = activeBills.Where(entry => entry.Bill.DueDay == day).ToList();
            cells.Add(new BillsCalendarDay(
                day,
                isCurrentMonth && todayUtc.Day == day,
                dayBills.Count > 0,
                dayBills.Count > 0 && dayBills.All(entry => entry.Payment is not null)));
        }

        return cells;
    }

    /// <summary>
    /// Vencidas (antes de hoje, a partir do saldo inicial) sem baixa nem dispensa, das
    /// contas ATIVAS; as mais antigas primeiro, empates na ordem das contas (RN-101).
    /// </summary>
    /// <param name="today">
    /// <c>AAAA-MM-DD</c> como chegou. O Node o compara como TEXTO e tira o mês do texto; só os
    /// dias de atraso usam a data rolada pelo <c>Date</c> (com "2026-02-31": mês 02, atraso até 03/03).
    /// </param>
    public static IReadOnlyList<OverdueBill> FindOverdue(
        IReadOnlyList<Bill> activeBills, IReadOnlyList<BillPayment> payments, DateOnly openingDate, string today)
    {
        ArgumentNullException.ThrowIfNull(activeBills);
        ArgumentNullException.ThrowIfNull(payments);
        ArgumentNullException.ThrowIfNull(today);
        var settled = payments.Select(payment => (payment.BillId, payment.Month)).ToHashSet();
        var openingMonth = MonthRef.Of(openingDate);
        var currentMonth = MonthRef.Parse(today[..7]);
        var todayRolled = JsDate.ParseIsoDate(today) ?? throw new ArgumentException($"Data inválida: \"{today}\".", nameof(today));
        var overdue = new List<OverdueBill>();
        foreach (var bill in activeBills)
        {
            foreach (var month in bill.MonthsBetween(openingMonth, currentMonth))
            {
                var due = bill.DueDate(month);
                if (due < openingDate || string.CompareOrdinal(due.ToIso(), today) >= 0 || settled.Contains((bill.Id, month))) continue;
                overdue.Add(new OverdueBill(
                    bill.Id, bill.Name, month, due, bill.AmountCents, todayRolled.DayNumber - due.DayNumber, bill.InstallmentNumber(month), bill.TotalInstallments));
            }
        }

        // OrderBy é estável, como o sort do JavaScript.
        return [.. overdue.OrderBy(entry => entry.DueDate)];
    }
}
