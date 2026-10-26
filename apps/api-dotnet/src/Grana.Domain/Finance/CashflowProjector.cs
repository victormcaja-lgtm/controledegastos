using Grana.Domain.Common;

namespace Grana.Domain.Finance;

public enum CashflowEventKind
{
    Transaction,
    Income,
    Bill,
    BillOverdue,
    CardInvoice,
    GoalDeposit,
    Simulation,
    DailyAverage,
}

/// <summary>Um movimento num dia: entrada (positivo) ou saída (negativo).</summary>
public sealed record CashflowEvent(CashflowEventKind Kind, string Label, long AmountCents, bool Projected, string? RefId, string? Month);

public sealed record CashflowDay(string Date, long InCents, long OutCents, long BalanceCents, bool Projected, IReadOnlyList<CashflowEvent> Events);

public sealed record CashflowMonth(
    string Month, string Label, long OpeningCents, long InCents, long OutCents, long SavedCents, long ResultCents, long ClosingCents, bool Closed);

public sealed record CashflowLowest(string Date, long BalanceCents);

public sealed record Cashflow(
    bool Configured,
    string Today,
    string? OpeningDate,
    string From,
    string To,
    long TodayBalanceCents,
    long EndOfMonthCents,
    CashflowLowest? Lowest,
    string? FirstNegativeDate,
    long DailyAverageCents,
    IReadOnlyList<OverdueBill> OverdueBills,
    IReadOnlyList<CashflowDay> Days,
    IReadOnlyList<CashflowMonth> Months)
{
    /// <summary>Saldo futuro sem data inicial: <c>configured: false</c>, listas vazias e zeros (RN-140).</summary>
    public static Cashflow NotConfigured(string from, string to, string today) =>
        new(false, today, null, from, to, 0, 0, null, null, 0, [], [], []);
}

public sealed record CashflowTransaction(string Id, string Date, EntryType Type, long AmountCents, string Label);

public sealed record CashflowIncome(string Id, string Name, long AmountCents, int ReceiptDay);

public sealed record CashflowInvoice(string CardId, string CardName, MonthRef Month, string DueDate, long TotalCents);

public sealed record CashflowGoalDeposit(string GoalId, string GoalName, string Date, long AmountCents);

public sealed record CashflowExtraEvent(string Date, string Label, long AmountCents);

/// <summary>Tudo o que a projeção precisa (<c>CashflowInput</c>). As datas são texto <c>AAAA-MM-DD</c>.</summary>
public sealed record CashflowInput(
    string Today,
    string OpeningDate,
    long OpeningBalanceCents,
    IReadOnlyList<CashflowTransaction> Transactions,
    IReadOnlyList<CashflowIncome> Incomes,
    IReadOnlyList<Bill> Bills,
    IReadOnlyList<BillPayment> BillPayments,
    IReadOnlyList<CashflowInvoice> CardInvoices,
    IReadOnlyList<CashflowGoalDeposit> GoalDeposits,
    long DailyAverageCents,
    IReadOnlyList<CashflowExtraEvent>? ExtraEvents = null);

/// <summary>
/// Saldo futuro — <c>projectCashFlow</c>, <c>summarizeMonths</c> e <c>buildVerdict</c>
/// (RN-140–149). Porte fiel, com as datas como TEXTO (<see cref="IsoText"/>): um evento
/// marcado para um <c>today</c> inexistente ("2026-02-31") cai num dia que o laço não visita,
/// exatamente como no Node.
/// </summary>
public static class CashflowProjector
{
    public static Cashflow Project(CashflowInput input, string from, string to)
    {
        ArgumentNullException.ThrowIfNull(input);
        var today = input.Today;
        var opening = input.OpeningDate;
        // Vai até o fim do mês de `to` (e do mês corrente) para o resumo mensal fechar.
        var end = IsoText.Max(IsoText.LastDayOfMonth(to), IsoText.LastDayOfMonth(today), today);
        var openingMonth = IsoText.Month(opening);
        var endMonth = IsoText.Month(end);

        var eventsByDate = new Dictionary<string, List<CashflowEvent>>(StringComparer.Ordinal);
        void Add(string date, CashflowEvent cashflowEvent)
        {
            if (IsoText.Compare(date, opening) < 0 || IsoText.Compare(date, end) > 0) return;
            if (!eventsByDate.TryGetValue(date, out var bucket)) eventsByDate[date] = bucket = [];
            bucket.Add(cashflowEvent);
        }

        bool After(string date) => IsoText.Compare(date, today) > 0;

        foreach (var transaction in input.Transactions)
        {
            Add(transaction.Date, new CashflowEvent(
                CashflowEventKind.Transaction, transaction.Label,
                transaction.Type == EntryType.Income ? transaction.AmountCents : -transaction.AmountCents,
                After(transaction.Date), transaction.Id, null));
        }

        for (var month = openingMonth; month <= endMonth; month = month.AddMonths(1))
        {
            foreach (var income in input.Incomes)
            {
                var date = month.DayOf(income.ReceiptDay).ToIso();
                Add(date, new CashflowEvent(CashflowEventKind.Income, income.Name, income.AmountCents, After(date), income.Id, month.Value));
            }
        }

        var payments = input.BillPayments.ToDictionary(payment => (payment.BillId, payment.Month));
        var overdue = BillsCalendar.FindOverdue(input.Bills, input.BillPayments, IsoDate.Parse(opening), today);
        var overdueKeys = overdue.Select(bill => (bill.BillId, bill.Month)).ToHashSet();

        foreach (var bill in input.Bills)
        {
            foreach (var month in bill.MonthsBetween(openingMonth, endMonth))
            {
                var dueDate = bill.DueDate(month).ToIso();
                // Conta que venceu antes do saldo inicial já está embutida nele.
                if (IsoText.Compare(dueDate, opening) < 0) continue;

                var label = bill.TotalInstallments is null ? bill.Name : $"{bill.Name} {bill.InstallmentNumber(month)}/{bill.TotalInstallments}";
                if (payments.TryGetValue((bill.Id, month), out var payment))
                {
                    if (payment.Status == BillPaymentStatus.Waived) continue;
                    var paidOn = DateOnly.FromDateTime(payment.PaidAt).ToIso();
                    Add(paidOn, new CashflowEvent(CashflowEventKind.Bill, label, -payment.AmountCents, After(paidOn), bill.Id, month.Value));
                }
                else if (overdueKeys.Contains((bill.Id, month)))
                {
                    Add(today, new CashflowEvent(
                        CashflowEventKind.BillOverdue, $"{label} · atrasada desde {IsoText.ShortDate(dueDate)}", -bill.AmountCents, true, bill.Id, month.Value));
                }
                else
                {
                    Add(dueDate, new CashflowEvent(CashflowEventKind.Bill, label, -bill.AmountCents, true, bill.Id, month.Value));
                }
            }
        }

        foreach (var invoice in input.CardInvoices.Where(invoice => invoice.TotalCents != 0))
        {
            // Para a fatura, "prevista" é a partir de hoje, inclusive (RN-143).
            Add(invoice.DueDate, new CashflowEvent(
                CashflowEventKind.CardInvoice, $"Fatura {invoice.CardName}", -invoice.TotalCents,
                IsoText.Compare(invoice.DueDate, today) >= 0, invoice.CardId, invoice.Month.Value));
        }

        foreach (var deposit in input.GoalDeposits)
        {
            Add(deposit.Date, new CashflowEvent(
                CashflowEventKind.GoalDeposit, $"Guardado em {deposit.GoalName}", -deposit.AmountCents, After(deposit.Date), deposit.GoalId, null));
        }

        foreach (var extra in input.ExtraEvents ?? [])
        {
            Add(extra.Date, new CashflowEvent(CashflowEventKind.Simulation, extra.Label, -extra.AmountCents, true, null, null));
        }

        if (input.DailyAverageCents > 0)
        {
            for (var date = IsoText.AddDays(IsoText.Max(today, IsoText.AddDays(opening, -1)), 1); IsoText.Compare(date, end) <= 0; date = IsoText.AddDays(date, 1))
            {
                Add(date, new CashflowEvent(CashflowEventKind.DailyAverage, "Gasto médio do dia", -input.DailyAverageCents, true, null, null));
            }
        }

        /* ── Caminha dia a dia acumulando o saldo ── */
        var allDays = new List<CashflowDay>();
        var balance = input.OpeningBalanceCents;
        var todayBalance = IsoText.Compare(today, opening) < 0 ? input.OpeningBalanceCents : 0;
        for (var date = opening; IsoText.Compare(date, end) <= 0; date = IsoText.AddDays(date, 1))
        {
            IReadOnlyList<CashflowEvent> events = eventsByDate.TryGetValue(date, out var bucket) ? bucket : [];
            long inCents = 0, outCents = 0, realDelta = 0;
            foreach (var cashflowEvent in events)
            {
                if (cashflowEvent.AmountCents >= 0) inCents += cashflowEvent.AmountCents;
                else outCents -= cashflowEvent.AmountCents;
                if (!cashflowEvent.Projected) realDelta += cashflowEvent.AmountCents;
            }

            if (date == today) todayBalance = balance + realDelta;
            balance += inCents - outCents;
            allDays.Add(new CashflowDay(date, inCents, outCents, balance, After(date), events));
        }

        var visible = allDays.Where(day => IsoText.Compare(day.Date, from) >= 0 && IsoText.Compare(day.Date, to) <= 0).ToList();
        var ahead = allDays.Where(day => IsoText.Compare(day.Date, today) >= 0 && IsoText.Compare(day.Date, to) <= 0).ToList();

        CashflowDay? lowest = null;
        foreach (var day in ahead)
        {
            if (lowest is null || day.BalanceCents < lowest.BalanceCents) lowest = day;
        }

        var firstNegative = ahead.FirstOrDefault(day => day.BalanceCents < 0);
        var lastDayOfMonth = IsoText.LastDayOfMonth(today);
        var endOfMonth = allDays.FirstOrDefault(day => day.Date == lastDayOfMonth);

        return new Cashflow(
            true,
            today,
            opening,
            from,
            to,
            todayBalance,
            endOfMonth?.BalanceCents ?? balance,
            lowest is null ? null : new CashflowLowest(lowest.Date, lowest.BalanceCents),
            firstNegative?.Date,
            input.DailyAverageCents,
            overdue,
            visible,
            SummarizeMonths(allDays, input.OpeningBalanceCents, from, to, today));
    }

    /// <summary>
    /// Resultado de cada mês que toca [from, to] (RN-145): depósitos em metas vão para
    /// <c>saved</c>, não para <c>out</c>; <c>closed</c> = mês anterior ao de hoje.
    /// </summary>
    public static IReadOnlyList<CashflowMonth> SummarizeMonths(IReadOnlyList<CashflowDay> days, long openingBalanceCents, string from, string to, string today)
    {
        ArgumentNullException.ThrowIfNull(days);
        ArgumentNullException.ThrowIfNull(from);
        ArgumentNullException.ThrowIfNull(to);
        ArgumentNullException.ThrowIfNull(today);
        var fromMonth = from[..7];
        var toMonth = to[..7];
        var currentMonth = today[..7];

        var order = new List<string>();
        var byMonth = new Dictionary<string, CashflowMonth>(StringComparer.Ordinal);
        var previousBalance = openingBalanceCents;
        foreach (var day in days)
        {
            var month = day.Date[..7];
            if (!byMonth.TryGetValue(month, out var summary))
            {
                order.Add(month);
                summary = new CashflowMonth(month, MonthRef.Parse(month).Label, previousBalance, 0, 0, 0, 0, previousBalance, IsoText.Compare(month, currentMonth) < 0);
            }

            long inCents = summary.InCents, outCents = summary.OutCents, saved = summary.SavedCents;
            foreach (var cashflowEvent in day.Events)
            {
                if (cashflowEvent.Kind == CashflowEventKind.GoalDeposit) saved -= cashflowEvent.AmountCents;
                else if (cashflowEvent.AmountCents >= 0) inCents += cashflowEvent.AmountCents;
                else outCents -= cashflowEvent.AmountCents;
            }

            byMonth[month] = summary with { InCents = inCents, OutCents = outCents, SavedCents = saved, ResultCents = inCents - outCents, ClosingCents = day.BalanceCents };
            previousBalance = day.BalanceCents;
        }

        return [.. order.Where(month => IsoText.Compare(month, fromMonth) >= 0 && IsoText.Compare(month, toMonth) <= 0).Select(month => byMonth[month])];
    }

    /// <summary>"Posso comprar?" em uma frase (RN-147): <c>fits</c> = nenhum dia negativo depois da compra.</summary>
    public static (string Verdict, bool Fits) BuildVerdict(Cashflow before, Cashflow after)
    {
        ArgumentNullException.ThrowIfNull(before);
        ArgumentNullException.ThrowIfNull(after);
        var fits = after.FirstNegativeDate is null;
        var lowestBefore = before.Lowest?.BalanceCents ?? before.TodayBalanceCents;
        if (after.Lowest is not { } lowestAfter) return ("Não há dias à frente no intervalo para comparar.", fits);

        var drop = $"Seu menor saldo vai de {MoneyFormatter.Format(lowestBefore)} para {MoneyFormatter.Format(lowestAfter.BalanceCents)} em {IsoText.ShortDate(lowestAfter.Date)}.";
        if (fits) return ($"{drop} Cabe no seu saldo.", fits);
        return before.FirstNegativeDate is not null
            ? ($"{drop} Seu saldo já fica negativo sem essa compra — ela aumenta o buraco.", fits)
            : ($"{drop} Atenção: com essa compra o saldo fica negativo em {IsoText.ShortDate(after.FirstNegativeDate!)}.", fits);
    }
}
