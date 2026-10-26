using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Domain.Tests.Finance;

/// <summary>Resumo do mês (RN-111–113) e relatório por categoria (RN-115–117).</summary>
public class BudgetAndReportTests
{
    private static readonly DateTime Today = new(2026, 9, 15, 12, 0, 0, DateTimeKind.Utc);

    private static BudgetInput Base(
        string month = "2026-09",
        long income = 480_000,
        long extra = 0,
        (int Day, int AmountCents)[]? variable = null,
        (int AmountCents, int DueDay, bool Paid)[]? bills = null,
        DateTime? today = null) =>
        new(MonthRef.Parse(month), today ?? Today, income, extra, variable ?? [], bills ?? [], 118_000);

    /* Casos portados de apps/api/src/modules/finance/domain/budget.calculator.test.ts (calculateBudget). */

    [Fact]
    public void Portado_sobra_e_entradas_menos_contas_menos_variaveis()
    {
        var result = BudgetCalculator.Calculate(Base(variable: [(3, 20_000)], bills: [(120_000, 10, true), (80_000, 20, false)]));
        Assert.Equal((200_000L, 120_000L, 80_000L, 480_000L - 200_000 - 20_000), (result.BillsTotalCents, result.BillsPaidCents, result.BillsDueCents, result.LeftoverCents));
    }

    [Fact]
    public void Portado_considera_entradas_avulsas_do_mes() =>
        Assert.Equal(495_000L, BudgetCalculator.Calculate(Base(extra: 15_000)).IncomeCents);

    [Fact]
    public void Portado_projeta_meses_futuros_com_a_media()
    {
        var future = BudgetCalculator.Calculate(Base("2026-12", variable: [(1, 999_999)], bills: [(100_000, 5, false)]));
        Assert.False(future.IsCurrentMonth);
        Assert.Equal(480_000L - 100_000 - 118_000, future.LeftoverCents);
    }

    [Fact]
    public void Portado_sobra_negativa_com_barra_zerada()
    {
        var result = BudgetCalculator.Calculate(Base(bills: [(600_000, 10, false)]));
        Assert.True(result.LeftoverCents < 0);
        Assert.Equal((0, 0L), (result.Bars.LeftoverPercent, result.DailyAllowanceCents));
    }

    [Fact]
    public void Portado_nunca_divide_por_zero_sem_renda() =>
        Assert.Equal(0, BudgetCalculator.Calculate(Base(income: 0)).Bars.SpentPercent);

    [Fact]
    public void Portado_distribui_os_gastos_nas_quatro_semanas()
    {
        var result = BudgetCalculator.Calculate(Base(variable: [(2, 10_000), (9, 30_000), (16, 5_000), (30, 1_000)]));
        Assert.Equal([10_000L, 30_000, 5_000, 1_000], result.Weeks.Select(w => w.TotalCents));
        Assert.Equal(100, result.Weeks[1].HeightPercent);
    }

    [Fact]
    public void Portado_valor_diario_respeita_os_dias_restantes()
    {
        var result = BudgetCalculator.Calculate(Base(today: new DateTime(2026, 9, 20, 12, 0, 0, DateTimeKind.Utc)));
        Assert.Equal((10, result.LeftoverCents / 10), (result.DaysLeft, result.DailyAllowanceCents));
    }

    /* Casos do .NET. */

    [Fact]
    public void Semanas_altura_minima_atual_e_frases()
    {
        var result = BudgetCalculator.Calculate(Base(variable: [(9, 30_000), (15, 10_000), (16, 3)]));
        Assert.Equal([6, 100, 33, 6], result.Weeks.Select(w => w.HeightPercent));
        Assert.Equal([false, false, true, false], result.Weeks.Select(w => w.Current));
        Assert.Equal(("S3", 2), (result.Weeks[2].Label, result.Weeks[2].Index));
        Assert.Equal("Boa — esta semana você gastou R$ 199,97 a menos que a passada.", result.WeekNote);

        Assert.Equal("Esta semana está R$ 0,03 acima da semana passada.", BudgetCalculator.Calculate(Base(variable: [(16, 3)])).WeekNote);
        Assert.Equal("Ainda não há gastos suficientes nesta semana para comparar.", BudgetCalculator.Calculate(Base()).WeekNote);
        // Fora do mês atual: S4 × S3, nenhuma semana "atual".
        var past = BudgetCalculator.Calculate(Base("2026-08", variable: [(29, 100)]));
        Assert.Equal(("Esta semana está R$ 1,00 acima da semana passada.", 1, false), (past.WeekNote, past.DaysLeft, past.Weeks.Any(w => w.Current)));
    }

    [Fact]
    public void Barras_e_rotulos()
    {
        var result = BudgetCalculator.Calculate(Base(variable: [(1, 48_000)], bills: [(96_000, 10, true), (48_000, 20, false)]));
        Assert.Equal(new BudgetBars(30, 10, 60), result.Bars);
        Assert.Equal(("Setembro 2026", true), (result.MonthLabel, result.IsCurrentMonth));
        Assert.Equal(3, BudgetCalculator.WeekIndexOfDay(31));

        Assert.Equal("vence dia 5", BudgetCalculator.WhenLabel(5, false, 1));
        Assert.Equal("venceu há 1 dia", BudgetCalculator.WhenLabel(14, true, 15));
        Assert.Equal("venceu há 3 dias", BudgetCalculator.WhenLabel(12, true, 15));
        Assert.Equal("vence hoje", BudgetCalculator.WhenLabel(15, true, 15));
        Assert.Equal("em 1 dia", BudgetCalculator.WhenLabel(16, true, 15));
        Assert.Equal("em 16 dias", BudgetCalculator.WhenLabel(31, true, 15));
    }

    private static readonly Category Market = Category.CreateSystem("mercado", "u1", "Mercado", "verde", CategoryKind.Expense);
    private static readonly Category Leisure = Category.CreateSystem("lazer", "u1", "Lazer", "roxo", CategoryKind.Expense);
    private static readonly Category House = Category.CreateSystem("casa", "u1", "Casa", "azul", CategoryKind.Expense);
    private static readonly Category Salary = Category.CreateSystem("salario", "u1", "Salário", "ouro", CategoryKind.Income);

    private static Transaction Tx(Category category, int cents, string date, EntryType type = EntryType.Expense) =>
        Transaction.Create($"t{cents}{date}", "u1", category, type, cents, IsoDate.Parse(date), null, Today);

    [Fact]
    public void Relatorio_soma_lancamentos_contas_e_parcelas_que_vencem_no_mes_com_empates_na_ordem_de_insercao()
    {
        var june = MonthRef.Parse("2025-06");
        var card = Card.Restore("c1", "u1", "Visa", 8, 15, null, active: false);
        var report = CategoryReportBuilder.Build(
            june,
            [Tx(Leisure, 5_000, "2025-06-10"), Tx(Market, 5_000, "2025-06-03"), Tx(Salary, 100_000, "2025-06-05", EntryType.Income)],
            [],
            [Bill.Restore("b1", "u1", CategoryRef.Of(House), "Aluguel", 150_000, 5, true, june, null)],
            [card],
            [CardPurchase.Create("p1", card, Leisure, 60_001, 6, new DateOnly(2025, 4, 20), null, Today), CardPurchase.Create("p2", Card.Restore("sem-cartao", "u1", "X", 1, 2, null, true), Market, 1, 1, new DateOnly(2025, 6, 1), null, Today)]);

        Assert.Equal(("2025-06", "Junho 2025", 150_000L + 5_000 + 5_000 + 10_000), (report.Month.Value, report.MonthLabel, report.TotalCents));
        Assert.Equal(
            [("casa", 150_000L, 88, 100), ("lazer", 15_000L, 9, 10), ("mercado", 5_000L, 3, 3)],
            report.Items.Select(i => (i.CategoryId, i.TotalCents, i.Percent, i.RelativeWidth)));
        Assert.Equal(("Lazer", "roxo"), (report.Items[1].Name, report.Items[1].Color));
        Assert.Equal("Ainda não há mês anterior suficiente para comparar.", report.Comparison);

        var tie = CategoryReportBuilder.Build(june, [Tx(Leisure, 100, "2025-06-02"), Tx(Market, 100, "2025-06-01")], [], [], [], []);
        Assert.Equal(["lazer", "mercado"], tie.Items.Select(i => i.CategoryId));
        Assert.Empty(CategoryReportBuilder.Build(june, [], [], [], [], []).Items);
    }

    [Fact]
    public void Comparacao_por_nome_so_com_lancamentos()
    {
        string Compare(int marketNow, int leisureNow, int marketBefore, int leisureBefore) =>
            CategoryReportBuilder.Comparison(
                [.. new[] { Tx(Market, marketNow, "2024-02-01"), Tx(Leisure, leisureNow, "2024-02-02") }.Where(t => t.AmountCents > 0)],
                [.. new[] { Tx(Market, marketBefore, "2024-01-01"), Tx(Leisure, leisureBefore, "2024-01-02") }.Where(t => t.AmountCents > 0)]);

        Assert.Equal("Você gastou R$ 50,00 a menos em mercado, mas R$ 20,00 a mais em lazer.", Compare(5_000, 7_000, 10_000, 5_000));
        Assert.Equal("O maior aumento veio de mercado: R$ 15,00 a mais que no mês passado.", Compare(2_500, 1_000, 1_000, 1_000));
        Assert.Equal("Você economizou R$ 20,00 em mercado em relação ao mês passado.", Compare(1_000, 1_000, 3_000, 1_000));
        Assert.Equal("Seus gastos ficaram estáveis em relação ao mês passado.", Compare(1_000, 1_000, 1_000, 1_000));
        // Categoria que só existia no mês anterior conta como queda.
        Assert.Equal("Você economizou R$ 10,00 em mercado em relação ao mês passado.", Compare(0, 0, 1_000, 0));
    }

    [Fact]
    public void Mes_anterior_antes_do_ano_1000_quebra_como_no_Node()
    {
        Assert.Equal("2025-12", CategoryReportBuilder.PreviousMonth(MonthRef.Parse("2026-01")).Value);
        Assert.Equal("1000-01", CategoryReportBuilder.PreviousMonth(MonthRef.Parse("1000-02")).Value);
        Assert.Throws<InvalidOperationException>(() => CategoryReportBuilder.PreviousMonth(MonthRef.Parse("1000-01")));
    }
}
