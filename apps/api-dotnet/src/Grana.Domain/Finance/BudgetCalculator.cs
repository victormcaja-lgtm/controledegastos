using Grana.Domain.Common;

namespace Grana.Domain.Finance;

/// <summary>Entrada de <see cref="BudgetCalculator.Calculate"/> (<c>BudgetInput</c>).</summary>
public sealed record BudgetInput(
    MonthRef Month,
    DateTime TodayUtc,
    long IncomeCents,
    long ExtraIncomeCents,
    IReadOnlyList<(int Day, int AmountCents)> VariableExpenses,
    IReadOnlyList<(int AmountCents, int DueDay, bool Paid)> Bills,
    long AverageVariableCents);

public sealed record BudgetBars(int SpentPercent, int DuePercent, int LeftoverPercent);

public sealed record WeekBar(int Index, string Label, long TotalCents, int HeightPercent, bool Current);

public sealed record BudgetResult(
    MonthRef Month,
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
    BudgetBars Bars,
    IReadOnlyList<WeekBar> Weeks,
    string WeekNote);

/// <summary>
/// O cérebro do resumo do mês — <c>calculateBudget</c> (RN-111, RN-112). Função pura;
/// "hoje" é a data UTC do servidor.
/// </summary>
public static class BudgetCalculator
{
    public static BudgetResult Calculate(BudgetInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var currentMonth = MonthRef.Of(DateOnly.FromDateTime(input.TodayUtc));
        var isCurrentMonth = input.Month == currentMonth;
        var isPast = input.Month < currentMonth;
        var totalDays = input.Month.DaysInMonth;

        var income = input.IncomeCents + input.ExtraIncomeCents;
        var variableSpent = input.VariableExpenses.Sum(item => (long)item.AmountCents);
        var billsTotal = input.Bills.Sum(bill => (long)bill.AmountCents);
        var billsPaid = input.Bills.Where(bill => bill.Paid).Sum(bill => (long)bill.AmountCents);
        var billsDue = billsTotal - billsPaid;

        // Passado e mês atual usam o que aconteceu; meses futuros, a média histórica.
        var projectedVariable = isCurrentMonth || isPast ? variableSpent : input.AverageVariableCents;
        var spent = billsPaid + variableSpent;
        var leftover = income - billsTotal - projectedVariable;

        var currentDay = isCurrentMonth ? input.TodayUtc.Day : totalDays;
        var daysLeft = Math.Max(1, totalDays - currentDay);
        var dailyAllowance = (long)Math.Floor(Math.Max(0, leftover) / (double)daysLeft);
        var denominator = Math.Max(income, 1);

        var weekTotals = new long[4];
        foreach (var (day, amount) in input.VariableExpenses) weekTotals[WeekIndexOfDay(day)] += amount;
        var maxWeek = Math.Max(weekTotals.Max(), 1);
        var currentWeek = WeekIndexOfDay(currentDay);
        var weeks = weekTotals
            .Select((total, index) => new WeekBar(
                index, $"S{index + 1}", total, (int)Math.Max(6, JsMath.Round(total / (double)maxWeek * 100)), isCurrentMonth && index == currentWeek))
            .ToList();

        var thisWeek = weekTotals[currentWeek];
        var previousWeek = currentWeek > 0 ? weekTotals[currentWeek - 1] : 0;
        var weekNote = previousWeek == 0 && thisWeek == 0
            ? "Ainda não há gastos suficientes nesta semana para comparar."
            : thisWeek <= previousWeek
                ? $"Boa — esta semana você gastou {MoneyFormatter.Format(previousWeek - thisWeek)} a menos que a passada."
                : $"Esta semana está {MoneyFormatter.Format(thisWeek - previousWeek)} acima da semana passada.";

        return new BudgetResult(
            input.Month,
            input.Month.Label,
            isCurrentMonth,
            income,
            billsTotal,
            billsPaid,
            billsDue,
            variableSpent,
            spent,
            leftover,
            dailyAllowance,
            daysLeft,
            new BudgetBars(
                JsMath.PercentOf(spent, denominator),
                JsMath.PercentOf(billsDue, denominator),
                JsMath.PercentOf(Math.Max(0, leftover), denominator)),
            weeks,
            weekNote);
    }

    /// <summary>Semana (0..3) de um dia do mês: 1–7, 8–14, 15–21, 22–31 (<c>weekIndexOfDay</c>).</summary>
    public static int WeekIndexOfDay(int day) => Math.Min(3, Math.Max(0, (int)Math.Floor((day - 1) / 7.0)));

    /// <summary>
    /// "vence dia N" fora do mês atual; no mês atual, "venceu há N dia(s)", "vence hoje" ou
    /// "em N dia(s)" pelo <c>dueDay</c> sem limitar ao fim do mês (RN-113).
    /// </summary>
    public static string WhenLabel(int dueDay, bool isCurrentMonth, int currentDay)
    {
        if (!isCurrentMonth) return $"vence dia {dueDay}";
        var distance = dueDay - currentDay;
        var days = Math.Abs(distance);
        return distance < 0
            ? $"venceu há {days} dia{(days == 1 ? string.Empty : "s")}"
            : distance == 0
                ? "vence hoje"
                : $"em {distance} dia{(distance == 1 ? string.Empty : "s")}";
    }
}
