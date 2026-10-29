using Grana.Application.Common;
using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Tests.Finance;

/// <summary>cashflow.usecases.ts — carregador, GET /cashflow e "Posso comprar?" (RN-140–147).</summary>
public class CashflowUseCasesTests
{
    private static readonly DateTime Now = new(2026, 10, 15, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Actor Ana = new("u1", "ana@grana.app", "USER");

    private static readonly Category Market = Category.CreateSystem("mercado", "u1", "Mercado", "verde", CategoryKind.Expense);

    private readonly InMemoryTransactions _transactions = new();
    private readonly InMemoryBills _bills = new();
    private readonly InMemoryIncomes _incomes = new();
    private readonly InMemoryCards _cards = new();
    private readonly InMemoryGoals _goals = new();
    private readonly InMemorySettings _settings = new();
    private readonly CashflowUseCases _useCases;

    public CashflowUseCasesTests() =>
        _useCases = new CashflowUseCases(_transactions, _bills, _incomes, _cards, _goals, _settings, new FixedClock(Now));

    private void Configure(string openingDate, long balance = 100_000, int? dailyBudget = null)
    {
        var settings = UserSettings.Defaults("u1");
        settings.Apply(new SettingsPatch
        {
            OpeningDate = Patch.Set<string?>(openingDate),
            OpeningBalanceCents = Patch.Set((int)balance),
            DailyBudgetCents = Patch.Set(dailyBudget),
        }, Now);
        _settings.Rows["u1"] = settings;
    }

    [Fact]
    public async Task Sem_saldo_inicial_devolve_nao_configurado_e_simulacao_recusa()
    {
        var empty = await _useCases.GetAsync(Ana, "2026-10-01", "2026-10-31", null, CancellationToken.None);
        Assert.Equal((false, "2026-10-15", (string?)null, 0), (empty.Configured, empty.Today, empty.OpeningDate, empty.Days.Count));

        var error = await Assert.ThrowsAsync<BusinessRuleError>(() =>
            _useCases.SimulateAsync(Ana, new SimulatePurchaseCommand("2026-10-01", "2026-10-31", null, 100, 1, "2026-10-15", false, null), CancellationToken.None));
        Assert.Equal("Informe seu saldo atual na tela inicial antes de simular.", error.Message);
    }

    [Fact]
    public async Task Carrega_os_seis_agregados_e_projeta()
    {
        Configure("2026-10-01");
        _transactions.Items.Add(Transaction.Create("t1", "u1", Market, EntryType.Expense, 20_000, new DateOnly(2026, 10, 3), null, Now));
        _transactions.Items.Add(Transaction.Create("t2", "u1", Market, EntryType.Expense, 1_000, new DateOnly(2026, 10, 4), "", Now));
        _transactions.Items.Add(Transaction.Create("t3", "u1", Market, EntryType.Expense, 9_999, new DateOnly(2028, 1, 1), null, Now));
        _incomes.Items.Add(Income.Create("i1", "u1", "Salário", 300_000, 5));
        _bills.Items.Add(Bill.Restore("b1", "u1", new CategoryRef("casa", "Casa", "x", CategoryKind.Expense), "Aluguel", 150_000, 10, true, MonthRef.Parse("2026-01"), null));
        var card = Card.Create("c1", "u1", "Visa", 3, 10, null);
        await _cards.AddAsync(card, Now, CancellationToken.None);
        await _cards.AddPurchaseAsync(CardPurchase.Create("p1", card, Market, 30_000, 1, new DateOnly(2026, 10, 5), null, Now), CancellationToken.None);
        await _goals.AddAsync(Goal.Create("g1", "u1", "Viagem", 100_000, 0, false), Now, CancellationToken.None);
        await _goals.AddDepositAsync("u1", "g1", "d1", 2_500, new DateTime(2026, 10, 6, 23, 59, 0, DateTimeKind.Utc), CancellationToken.None);
        _transactions.DailyAverage = 500;

        var result = await _useCases.GetAsync(Ana, "2026-10-01", "2026-11-30", null, CancellationToken.None);

        Assert.True(result.Configured);
        Assert.Equal(new DateOnly(2026, 10, 15), _transactions.DailyAverageBefore);
        var events = result.Days.SelectMany(d => d.Events).ToList();
        Assert.Contains(events, e => e is { Kind: "TRANSACTION", Label: "Mercado", AmountCents: -20_000 });
        Assert.Contains(events, e => e is { Kind: "TRANSACTION", Label: "", AmountCents: -1_000 });
        Assert.DoesNotContain(events, e => e.RefId == "t3");
        Assert.Contains(events, e => e is { Kind: "CARD_INVOICE", Label: "Fatura Visa", AmountCents: -30_000, Month: "2026-11" });
        Assert.Contains(events, e => e is { Kind: "GOAL_DEPOSIT", Label: "Guardado em Viagem", AmountCents: -2_500 });
        Assert.Contains(events, e => e is { Kind: "BILL_OVERDUE", Label: "Aluguel · atrasada desde 10/10" });
        Assert.Contains(events, e => e is { Kind: "DAILY_AVERAGE", AmountCents: -500 });
        Assert.Equal("Aluguel", result.OverdueBills.Single().Name);
        Assert.Equal(["2026-10", "2026-11"], result.Months.Select(m => m.Month));

        Configure("2026-10-01", dailyBudget: 4_321);
        Assert.Equal(4_321L, (await _useCases.GetAsync(Ana, "2026-10-01", "2026-10-31", "2026-10-20", CancellationToken.None)).DailyAverageCents);
        await Assert.ThrowsAsync<InvalidOperationException>(() => _useCases.GetAsync(Ana, "9998-11-01", "9998-11-30", "9998-11-01", CancellationToken.None));
    }

    [Fact]
    public async Task Simula_no_debito_e_no_cartao()
    {
        Configure("2026-10-01", balance: 20_000);
        var card = Card.Create("c1", "u1", "Visa", 3, 10, null);
        await _cards.AddAsync(card, Now, CancellationToken.None);

        var account = await _useCases.SimulateAsync(Ana, new SimulatePurchaseCommand("2026-10-15", "2027-01-31", null, 9_000_000_001, 3, "2026-10-31", false, null), CancellationToken.None);
        var simulated = account.After.Days.SelectMany(d => d.Events).Where(e => e.Kind == "SIMULATION").ToList();
        Assert.Equal(
            [("2026-10-31", "Compra simulada 1/3", -3_000_000_001L), ("2026-11-30", "Compra simulada 2/3", -3_000_000_000L), ("2026-12-31", "Compra simulada 3/3", -3_000_000_000L)],
            account.After.Days.Where(d => d.Events.Any(e => e.Kind == "SIMULATION")).Select(d => (d.Date, d.Events.Single(e => e.Kind == "SIMULATION").Label, d.Events.Single(e => e.Kind == "SIMULATION").AmountCents)));
        Assert.Equal(3, simulated.Count);
        Assert.False(account.Fits);
        Assert.Contains("fica negativo em 31/10", account.Verdict, StringComparison.Ordinal);

        var single = await _useCases.SimulateAsync(Ana, new SimulatePurchaseCommand("2026-10-15", "2026-12-31", null, 100, 1, "2026-10-20", false, null), CancellationToken.None);
        Assert.Equal("Compra simulada", single.After.Days.SelectMany(d => d.Events).Single(e => e.Kind == "SIMULATION").Label);
        Assert.True(single.Fits);

        var onCard = await _useCases.SimulateAsync(Ana, new SimulatePurchaseCommand("2026-10-15", "2027-01-31", null, 3_000, 2, "2026-10-20", true, "c1"), CancellationToken.None);
        Assert.Equal(
            ["Compra simulada · Visa 1/2 (fatura 10/11)", "Compra simulada · Visa 2/2 (fatura 10/12)"],
            onCard.After.Days.SelectMany(d => d.Events).Where(e => e.Kind == "SIMULATION").Select(e => e.Label));
        var oneOnCard = await _useCases.SimulateAsync(Ana, new SimulatePurchaseCommand("2026-10-01", "2027-01-31", "2026-10-15", 3_000, 1, "2026-10-02", true, "c1"), CancellationToken.None);
        Assert.Equal("Compra simulada · Visa (fatura 10/10)", oneOnCard.After.Days.SelectMany(d => d.Events).Single(e => e.Kind == "SIMULATION").Label);

        await Assert.ThrowsAsync<NotFoundError>(() =>
            _useCases.SimulateAsync(Ana, new SimulatePurchaseCommand("2026-10-15", "2026-12-31", null, 1, 1, "2026-10-20", true, "nada"), CancellationToken.None));
    }
}
