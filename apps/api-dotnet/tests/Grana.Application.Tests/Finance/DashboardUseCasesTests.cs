using Grana.Application.Common;
using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Tests.Finance;

/// <summary>dashboard.usecases.ts — RN-110–117.</summary>
public class DashboardUseCasesTests
{
    private static readonly DateTime Now = new(2026, 10, 15, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Actor Ana = new("u1", "ana@grana.app", "USER");
    private static readonly MonthRef October = MonthRef.Parse("2026-10");

    private readonly InMemoryTransactions _transactions = new();
    private readonly InMemoryBills _bills = new();
    private readonly InMemoryIncomes _incomes = new();
    private readonly InMemoryCards _cards = new();
    private readonly DashboardUseCases _useCases;

    private static readonly Category Market = Category.CreateSystem("mercado", "u1", "Mercado", "verde", CategoryKind.Expense);
    private static readonly Category House = Category.CreateSystem("casa", "u1", "Casa", "azul", CategoryKind.Expense);
    private static readonly Category Salary = Category.CreateSystem("salario", "u1", "Salário", "ouro", CategoryKind.Income);

    public DashboardUseCasesTests()
    {
        _useCases = new DashboardUseCases(_transactions, _bills, _incomes, _cards, new FixedClock(Now));
        _incomes.Items.Add(Income.Create("i1", "u1", "Salário", 500_000, 5));
        var inactive = Income.Create("i2", "u1", "Bico", 9_000, 20);
        inactive.Update(default, default, default, Patch.Set(false));
        _incomes.Items.Add(inactive);

        _transactions.Items.Add(Transaction.Create("t1", "u1", Market, EntryType.Expense, 20_000, new DateOnly(2026, 10, 3), null, Now));
        _transactions.Items.Add(Transaction.Create("t2", "u1", Salary, EntryType.Income, 15_000, new DateOnly(2026, 10, 10), null, Now));
        _transactions.Items.Add(Transaction.Create("t3", "u1", Market, EntryType.Expense, 30_000, new DateOnly(2026, 9, 3), null, Now));

        foreach (var (id, amount, day, total) in new[] { ("aluguel", 150_000, 5, (int?)null), ("luz", 10_000, 20, null), ("agua", 7_000, 15, null), ("tv", 9_900, 31, 1), ("gym", 8_000, 28, null) })
        {
            _bills.Items.Add(Bill.Restore(id, "u1", CategoryRef.Of(House), id, amount, day, true, MonthRef.Parse("2026-09"), total));
        }

        _bills.Payments.Add(("u1", new BillPayment("aluguel", October, BillPaymentStatus.Paid, 150_500, Now)));
        _bills.Payments.Add(("u1", new BillPayment("gym", October, BillPaymentStatus.Waived, 8_000, Now)));
    }

    [Fact]
    public async Task Resumo_do_mes_atual_com_dispensada_fora_e_encerrada_fora()
    {
        var summary = await _useCases.SummaryAsync(Ana, null, CancellationToken.None);
        Assert.Equal(("2026-10", "Outubro 2026", true), (summary.Month, summary.MonthLabel, summary.IsCurrentMonth));
        Assert.Equal((515_000L, 167_000L, 150_000L, 17_000L, 20_000L, 170_000L), (summary.IncomeCents, summary.BillsTotalCents, summary.BillsPaidCents, summary.BillsDueCents, summary.VariableSpentCents, summary.SpentCents));
        Assert.Equal((515_000L - 167_000 - 20_000, 16), (summary.LeftoverCents, summary.DaysLeft));
        Assert.Equal(
            [("agua", "vence hoje", "2026-10-15"), ("luz", "em 5 dias", "2026-10-20")],
            summary.UpcomingBills.Select(b => (b.Id, b.WhenLabel, b.DueDate.ToIso())));
    }

    [Fact]
    public async Task Resumo_de_mes_futuro_usa_a_media_e_rotulo_de_dia()
    {
        _transactions.Average = 40_000;
        var summary = await _useCases.SummaryAsync(Ana, MonthRef.Parse("2026-11"), CancellationToken.None);
        Assert.False(summary.IsCurrentMonth);
        Assert.Equal(500_000L - (150_000 + 10_000 + 7_000 + 8_000) - 40_000, summary.LeftoverCents);
        Assert.Equal(["vence dia 5", "vence dia 15", "vence dia 20"], summary.UpcomingBills.Select(b => b.WhenLabel));
    }

    [Fact]
    public async Task Relatorio_com_contas_dispensadas_e_comparacao()
    {
        var report = await _useCases.CategoryReportAsync(Ana, null, CancellationToken.None);
        Assert.Equal(("2026-10", 20_000L + 150_000 + 10_000 + 7_000 + 8_000), (report.Month, report.TotalCents));
        Assert.Equal(["casa", "mercado"], report.Items.Select(i => i.CategoryId));
        Assert.Equal("Você economizou R$ 100,00 em mercado em relação ao mês passado.", report.Comparison);

        await Assert.ThrowsAsync<InvalidOperationException>(() => _useCases.CategoryReportAsync(Ana, MonthRef.Parse("1000-01"), CancellationToken.None));
    }
}
