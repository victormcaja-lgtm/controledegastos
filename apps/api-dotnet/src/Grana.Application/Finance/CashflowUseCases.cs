using Grana.Application.Common;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Finance;

public sealed record CashflowEventDto(string Kind, string Label, long AmountCents, bool Projected, string? RefId, string? Month);

public sealed record CashflowDayDto(string Date, long InCents, long OutCents, long BalanceCents, bool Projected, IReadOnlyList<CashflowEventDto> Events);

public sealed record CashflowMonthDto(
    string Month, string Label, long OpeningCents, long InCents, long OutCents, long SavedCents, long ResultCents, long ClosingCents, bool Closed);

public sealed record CashflowLowestDto(string Date, long BalanceCents);

/// <summary>Na ordem de campos do <c>Cashflow</c> do Node.</summary>
public sealed record CashflowDto(
    bool Configured,
    string Today,
    string? OpeningDate,
    string From,
    string To,
    long TodayBalanceCents,
    long EndOfMonthCents,
    CashflowLowestDto? Lowest,
    string? FirstNegativeDate,
    long DailyAverageCents,
    IReadOnlyList<OverdueBillDto> OverdueBills,
    IReadOnlyList<CashflowDayDto> Days,
    IReadOnlyList<CashflowMonthDto> Months)
{
    public static CashflowDto Of(Cashflow cashflow)
    {
        ArgumentNullException.ThrowIfNull(cashflow);
        return new(
            cashflow.Configured, cashflow.Today, cashflow.OpeningDate, cashflow.From, cashflow.To, cashflow.TodayBalanceCents, cashflow.EndOfMonthCents,
            cashflow.Lowest is { } lowest ? new CashflowLowestDto(lowest.Date, lowest.BalanceCents) : null,
            cashflow.FirstNegativeDate,
            cashflow.DailyAverageCents,
            [.. cashflow.OverdueBills.Select(bill => new OverdueBillDto(
                bill.BillId, bill.Name, bill.Month.Value, bill.DueDate, bill.AmountCents, bill.DaysLate, bill.InstallmentNumber, bill.TotalInstallments))],
            [.. cashflow.Days.Select(day => new CashflowDayDto(
                day.Date, day.InCents, day.OutCents, day.BalanceCents, day.Projected,
                [.. day.Events.Select(e => new CashflowEventDto(KindName(e.Kind), e.Label, e.AmountCents, e.Projected, e.RefId, e.Month))]))],
            [.. cashflow.Months.Select(month => new CashflowMonthDto(
                month.Month, month.Label, month.OpeningCents, month.InCents, month.OutCents, month.SavedCents, month.ResultCents, month.ClosingCents, month.Closed))]);
    }

    private static string KindName(CashflowEventKind kind) => kind switch
    {
        CashflowEventKind.Transaction => "TRANSACTION",
        CashflowEventKind.Income => "INCOME",
        CashflowEventKind.Bill => "BILL",
        CashflowEventKind.BillOverdue => "BILL_OVERDUE",
        CashflowEventKind.CardInvoice => "CARD_INVOICE",
        CashflowEventKind.GoalDeposit => "GOAL_DEPOSIT",
        CashflowEventKind.Simulation => "SIMULATION",
        _ => "DAILY_AVERAGE",
    };
}

public sealed record SimulationDto(CashflowDto Before, CashflowDto After, string Verdict, bool Fits);

/// <summary>Corpo de <c>POST /api/cashflow/simulate</c>; as datas vêm como texto.</summary>
public sealed record SimulatePurchaseCommand(
    string From, string To, string? Today, long AmountCents, int Installments, string Date, bool OnCard, string? CardId);

/// <summary>
/// Saldo futuro e "Posso comprar?" — <c>cashflow.usecases.ts</c> (RN-140–147). O carregador
/// junta seis agregados no formato da projeção; a regra fica em <see cref="CashflowProjector"/>.
/// </summary>
public sealed class CashflowUseCases(
    ITransactionRepository transactions,
    IBillRepository bills,
    IIncomeRepository incomes,
    ICardRepository cards,
    IGoalRepository goals,
    IUserSettingsRepository settings,
    IClock clock)
{
    private string ServerToday => DateOnly.FromDateTime(clock.UtcNow).ToIso();

    public async Task<CashflowDto> GetAsync(Actor actor, string from, string to, string? requestedToday, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var today = requestedToday ?? ServerToday;
        var loaded = await LoadAsync(actor.UserId, today, cancellationToken).ConfigureAwait(false);
        return CashflowDto.Of(loaded is null ? Cashflow.NotConfigured(from, to, today) : CashflowProjector.Project(loaded.Value.Input, from, to));
    }

    /// <summary>Projeta sem e com a compra (nada é gravado) e responde em uma frase (RN-146, RN-147).</summary>
    public async Task<SimulationDto> SimulateAsync(Actor actor, SimulatePurchaseCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var today = command.Today ?? ServerToday;
        var loaded = await LoadAsync(actor.UserId, today, cancellationToken).ConfigureAwait(false)
            ?? throw new BusinessRuleError("Informe seu saldo atual na tela inicial antes de simular.");

        List<CashflowExtraEvent> extra;
        if (command.OnCard)
        {
            var card = loaded.Cards.FirstOrDefault(item => item.Id == command.CardId) ?? throw new NotFoundError("Cartão");
            extra = [.. CardInvoiceCalculator.InstallmentsOf(card, "simulacao", command.AmountCents, command.Installments, command.Date)
                .Select(installment => new CashflowExtraEvent(
                    installment.DueDate.ToIso(),
                    $"Compra simulada · {card.Name}{(installment.Installments > 1 ? $" {installment.Number}/{installment.Installments}" : string.Empty)} (fatura {IsoText.ShortDate(installment.DueDate.ToIso())})",
                    installment.AmountCents))];
        }
        else
        {
            var startMonth = IsoText.Month(command.Date);
            var day = int.Parse(command.Date[8..10], System.Globalization.CultureInfo.InvariantCulture);
            extra = [.. CardInvoiceCalculator.SplitInstallments(command.AmountCents, command.Installments)
                .Select((amount, index) => new CashflowExtraEvent(
                    startMonth.AddMonths(index).DayOf(day).ToIso(),
                    command.Installments > 1 ? $"Compra simulada {index + 1}/{command.Installments}" : "Compra simulada",
                    amount))];
        }

        var before = CashflowProjector.Project(loaded.Input, command.From, command.To);
        var after = CashflowProjector.Project(loaded.Input with { ExtraEvents = extra }, command.From, command.To);
        var (verdict, fits) = CashflowProjector.BuildVerdict(before, after);
        return new SimulationDto(CashflowDto.Of(before), CashflowDto.Of(after), verdict, fits);
    }

    /// <summary>
    /// <c>CashflowInputLoader.load</c> (RN-141). <c>null</c> = saldo futuro não configurado.
    /// Lançamentos até o dia 1 de (mês de hoje + 14) — perto do ano 9999 essa data não existe e
    /// o Node quebra (500); aqui também.
    /// </summary>
    private async Task<(CashflowInput Input, IReadOnlyList<Card> Cards)?> LoadAsync(string userId, string today, CancellationToken cancellationToken)
    {
        var found = await settings.FindAsync(userId, cancellationToken).ConfigureAwait(false);
        if (found?.OpeningDate is not { } openingDate) return null;

        var untilMonth = IsoText.Month(today).AddMonths(14);
        if (untilMonth.Year > 9999) throw new InvalidOperationException("Data limite do saldo futuro fora do alcance do Date do JavaScript.");
        var before = JsDate.ParseIsoDate(today) ?? throw new ArgumentException($"Data inválida: \"{today}\".", nameof(today));

        var monthTransactions = await transactions.ListBetweenAsync(userId, openingDate, untilMonth.Start, cancellationToken).ConfigureAwait(false);
        var activeBills = await bills.ListActiveAsync(userId, cancellationToken).ConfigureAwait(false);
        var payments = await bills.PaymentsSinceAsync(userId, MonthRef.Of(openingDate), cancellationToken).ConfigureAwait(false);
        var activeIncomes = await incomes.ListActiveAsync(userId, cancellationToken).ConfigureAwait(false);
        var userCards = await cards.ListAsync(userId, cancellationToken).ConfigureAwait(false);
        var purchases = await cards.ListPurchasesAsync(userId, null, cancellationToken).ConfigureAwait(false);
        var deposits = await goals.DepositsSinceAsync(userId, openingDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc), cancellationToken).ConfigureAwait(false);
        var average = found.DailyBudgetCents is { } budget
            ? budget
            : await transactions.AverageDailyExpenseAsync(userId, before, 90, cancellationToken).ConfigureAwait(false);

        var input = new CashflowInput(
            today,
            openingDate.ToIso(),
            found.OpeningBalanceCents,
            [.. monthTransactions.Select(t => new CashflowTransaction(t.Id, t.OccurredOn.ToIso(), t.Type, t.AmountCents, t.Note ?? t.Category.Name))],
            [.. activeIncomes.Select(income => new CashflowIncome(income.Id, income.Name, income.AmountCents, income.ReceiptDay))],
            activeBills,
            payments,
            [.. userCards.SelectMany(card => CardInvoiceCalculator.BuildInvoices(card, [.. purchases.Where(p => p.CardId == card.Id)], today)
                .Select(invoice => new CashflowInvoice(card.Id, card.Name, invoice.Month, invoice.DueDate.ToIso(), invoice.TotalCents)))],
            [.. deposits.Select(deposit => new CashflowGoalDeposit(deposit.GoalId, deposit.GoalName, DateOnly.FromDateTime(deposit.CreatedAt).ToIso(), deposit.AmountCents))],
            average);
        return (input, userCards);
    }
}
