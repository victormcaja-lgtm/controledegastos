using Grana.Application.Common;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Finance;

public sealed record BudgetBarsDto(int SpentPercent, int DuePercent, int LeftoverPercent);

public sealed record WeekBarDto(int Index, string Label, long TotalCents, int HeightPercent, bool Current);

public sealed record UpcomingBillDto(string Id, string Name, int AmountCents, int DueDay, DateOnly DueDate, string WhenLabel);

/// <summary>O <c>calculateBudget</c> espalhado e as próximas contas, na ordem de campos do Node.</summary>
public sealed record DashboardSummaryDto(
    string Month,
    string MonthLabel,
    bool IsCurrentMonth,
    long IncomeCents,
    long BillsTotalCents,
    long BillsPaidCents,
    long BillsDueCents,
    long VariableSpentCents,
    long SpentCents,
    long LeftoverCents,
    long DailyAllowanceCents,
    int DaysLeft,
    BudgetBarsDto Bars,
    IReadOnlyList<WeekBarDto> Weeks,
    string WeekNote,
    IReadOnlyList<UpcomingBillDto> UpcomingBills);

public sealed record CategoryReportItemDto(string CategoryId, string Name, string Color, long TotalCents, int Percent, int RelativeWidth);

public sealed record CategoryReportDto(string Month, string MonthLabel, long TotalCents, IReadOnlyList<CategoryReportItemDto> Items, string Comparison);

/// <summary>Resumo do mês e relatório por categoria — <c>dashboard.usecases.ts</c> (RN-110–117).</summary>
public sealed class DashboardUseCases(
    ITransactionRepository transactions, IBillRepository bills, IIncomeRepository incomes, ICardRepository cards, IClock clock)
{
    /// <summary>
    /// Entradas ativas + entradas avulsas do mês; despesas do mês; contas ativas, em vigor e
    /// não dispensadas (RN-110). ⚠️ Sem compras no cartão (RN-114).
    /// </summary>
    public async Task<DashboardSummaryDto> SummaryAsync(Actor actor, MonthRef? requested, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var now = clock.UtcNow;
        var month = requested ?? MonthRef.Of(DateOnly.FromDateTime(now));
        var monthTransactions = await transactions.ListForMonthAsync(actor.UserId, month, cancellationToken).ConfigureAwait(false);
        var activeBills = await bills.ListActiveAsync(actor.UserId, cancellationToken).ConfigureAwait(false);
        var payments = await bills.PaymentsForMonthAsync(actor.UserId, month, cancellationToken).ConfigureAwait(false);
        var activeIncomes = await incomes.ListActiveAsync(actor.UserId, cancellationToken).ConfigureAwait(false);
        var average = await transactions.AverageMonthlyExpenseAsync(actor.UserId, 3, now, cancellationToken).ConfigureAwait(false);

        var waived = payments.Where(p => p.Status == BillPaymentStatus.Waived).Select(p => p.BillId).ToHashSet(StringComparer.Ordinal);
        var paid = payments.Where(p => p.Status == BillPaymentStatus.Paid).Select(p => p.BillId).ToHashSet(StringComparer.Ordinal);
        var inEffect = activeBills.Where(bill => !bill.IsFinishedIn(month) && !waived.Contains(bill.Id)).ToList();

        var budget = BudgetCalculator.Calculate(new BudgetInput(
            month,
            now,
            activeIncomes.Sum(income => (long)income.AmountCents),
            monthTransactions.Where(t => t.Type == EntryType.Income).Sum(t => (long)t.AmountCents),
            [.. monthTransactions.Where(t => t.Type == EntryType.Expense).Select(t => (t.OccurredOn.Day, t.AmountCents))],
            [.. inEffect.Select(bill => (bill.AmountCents, bill.DueDay, paid.Contains(bill.Id)))],
            average));

        var currentDay = budget.IsCurrentMonth ? now.Day : 1;
        var upcoming = inEffect.Where(bill => !paid.Contains(bill.Id)).OrderBy(bill => bill.DueDay).Take(3)
            .Select(bill => new UpcomingBillDto(
                bill.Id, bill.Name, bill.AmountCents, bill.DueDay, bill.DueDate(month), BudgetCalculator.WhenLabel(bill.DueDay, budget.IsCurrentMonth, currentDay)));

        return new DashboardSummaryDto(
            budget.Month.Value, budget.MonthLabel, budget.IsCurrentMonth, budget.IncomeCents, budget.BillsTotalCents, budget.BillsPaidCents,
            budget.BillsDueCents, budget.VariableSpentCents, budget.SpentCents, budget.LeftoverCents, budget.DailyAllowanceCents, budget.DaysLeft,
            new BudgetBarsDto(budget.Bars.SpentPercent, budget.Bars.DuePercent, budget.Bars.LeftoverPercent),
            [.. budget.Weeks.Select(week => new WeekBarDto(week.Index, week.Label, week.TotalCents, week.HeightPercent, week.Current))],
            budget.WeekNote,
            [.. upcoming]);
    }

    /// <summary>Relatório por categoria da competência (padrão: a atual em UTC) — RN-115–117.</summary>
    public async Task<CategoryReportDto> CategoryReportAsync(Actor actor, MonthRef? requested, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var month = requested ?? MonthRef.Of(DateOnly.FromDateTime(clock.UtcNow));
        var monthTransactions = await transactions.ListForMonthAsync(actor.UserId, month, cancellationToken).ConfigureAwait(false);
        var activeBills = await bills.ListActiveAsync(actor.UserId, cancellationToken).ConfigureAwait(false);
        var previous = await transactions.ListForMonthAsync(actor.UserId, CategoryReportBuilder.PreviousMonth(month), cancellationToken).ConfigureAwait(false);
        var userCards = await cards.ListAsync(actor.UserId, cancellationToken).ConfigureAwait(false);
        var purchases = await cards.ListPurchasesAsync(actor.UserId, null, cancellationToken).ConfigureAwait(false);

        var report = CategoryReportBuilder.Build(
            month, monthTransactions, previous, [.. activeBills.Where(bill => !bill.IsFinishedIn(month))], userCards, purchases);
        return new CategoryReportDto(
            report.Month.Value, report.MonthLabel, report.TotalCents,
            [.. report.Items.Select(item => new CategoryReportItemDto(item.CategoryId, item.Name, item.Color, item.TotalCents, item.Percent, item.RelativeWidth))],
            report.Comparison);
    }
}
