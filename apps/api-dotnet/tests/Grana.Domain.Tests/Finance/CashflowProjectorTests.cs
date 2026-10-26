using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Domain.Tests.Finance;

/// <summary>Saldo futuro — RN-140–149. Casos portados de cashflow.calculator.test.ts e casos do .NET.</summary>
public class CashflowProjectorTests
{
    private static readonly CategoryRef House = new("casa", "Casa", "x", CategoryKind.Expense);

    private static CashflowInput BaseInput(
        string today = "2026-10-15",
        string opening = "2026-10-01",
        long balance = 100_000,
        CashflowTransaction[]? transactions = null,
        CashflowIncome[]? incomes = null,
        Bill[]? bills = null,
        BillPayment[]? payments = null,
        CashflowInvoice[]? invoices = null,
        CashflowGoalDeposit[]? deposits = null,
        long average = 0,
        CashflowExtraEvent[]? extra = null) =>
        new(today, opening, balance, transactions ?? [], incomes ?? [], bills ?? [], payments ?? [], invoices ?? [], deposits ?? [], average, extra);

    private static Bill Rent(int dueDay = 10, string start = "2026-01", int? total = null) =>
        Bill.Restore("b1", "u1", House, "Aluguel", 150_000, dueDay, true, MonthRef.Parse(start), total);

    private static BillPayment Payment(string month, BillPaymentStatus status, int amount, string paidOn) =>
        new("b1", MonthRef.Parse(month), status, amount, IsoDate.Parse(paidOn).ToDateTime(new TimeOnly(15, 30), DateTimeKind.Utc));

    private static long? BalanceOn(Cashflow result, string date) => result.Days.FirstOrDefault(day => day.Date == date)?.BalanceCents;

    /* ── Portados: saldo contínuo ── */

    [Fact]
    public void Portado_parte_do_saldo_inicial_e_soma_lancamentos_reais()
    {
        var result = CashflowProjector.Project(
            BaseInput(transactions: [new("t1", "2026-10-03", EntryType.Expense, 20_000, "Mercado"), new("t2", "2026-10-10", EntryType.Income, 5_000, "Pix")]),
            "2026-10-01", "2026-10-31");
        Assert.Equal((100_000L, 80_000L, 85_000L), (BalanceOn(result, "2026-10-02")!.Value, BalanceOn(result, "2026-10-03")!.Value, result.TodayBalanceCents));
    }

    [Fact]
    public void Portado_a_sobra_de_um_mes_vira_o_ponto_de_partida_do_outro()
    {
        var result = CashflowProjector.Project(BaseInput(incomes: [new("i1", "Salário", 300_000, 5)]), "2026-10-01", "2026-11-30");
        var october = result.Months.Single(m => m.Month == "2026-10");
        var november = result.Months.Single(m => m.Month == "2026-11");
        Assert.Equal((400_000L, october.ClosingCents, 700_000L), (october.ClosingCents, november.OpeningCents, november.ClosingCents));
    }

    [Fact]
    public void Portado_ignora_tudo_antes_do_saldo_inicial()
    {
        var result = CashflowProjector.Project(
            BaseInput(opening: "2026-10-10", transactions: [new("t1", "2026-10-05", EntryType.Expense, 50_000, "Antes")], incomes: [new("i1", "Salário", 300_000, 5)]),
            "2026-10-01", "2026-10-31");
        Assert.Equal(("2026-10-10", 100_000L), (result.Days[0].Date, result.TodayBalanceCents));
    }

    [Fact]
    public void Portado_gasto_medio_so_nos_dias_futuros()
    {
        var result = CashflowProjector.Project(BaseInput(average: 1_000), "2026-10-01", "2026-10-31");
        Assert.Equal((100_000L, 100_000L - (16 * 1_000)), (result.TodayBalanceCents, result.EndOfMonthCents));
        Assert.Empty(result.Days.Single(d => d.Date == "2026-10-15").Events);
    }

    [Fact]
    public void Portado_menor_saldo_e_primeiro_dia_negativo()
    {
        var result = CashflowProjector.Project(
            BaseInput(balance: 10_000, bills: [Bill.Restore("b1", "u1", House, "Aluguel", 50_000, 20, true, MonthRef.Parse("2026-01"), null)], incomes: [new("i1", "Salário", 300_000, 25)]),
            "2026-10-01", "2026-10-31");
        Assert.Equal(new CashflowLowest("2026-10-20", -40_000), result.Lowest);
        Assert.Equal("2026-10-20", result.FirstNegativeDate);
    }

    /* ── Portados: contas fixas ── */

    [Fact]
    public void Portado_conta_vencida_sem_baixa_aparece_hoje_como_atrasada()
    {
        var result = CashflowProjector.Project(BaseInput(bills: [Rent()]), "2026-10-01", "2026-10-31");
        var today = result.Days.Single(d => d.Date == "2026-10-15");
        Assert.Equal((CashflowEventKind.BillOverdue, -150_000L, "Aluguel · atrasada desde 10/10"), (today.Events[0].Kind, today.Events[0].AmountCents, today.Events[0].Label));
        Assert.Equal(("2026-10", 5), (result.OverdueBills.Single().Month.Value, result.OverdueBills.Single().DaysLate));
        Assert.Equal((100_000L, -50_000L), (result.TodayBalanceCents, BalanceOn(result, "2026-10-15")!.Value));
    }

    [Fact]
    public void Portado_conta_nao_paga_acumula()
    {
        var result = CashflowProjector.Project(BaseInput(opening: "2026-09-01", bills: [Rent()]), "2026-10-01", "2026-10-31");
        Assert.Equal(["2026-09", "2026-10"], result.OverdueBills.Select(b => b.Month.Value));
        Assert.Equal(100_000L - 300_000, BalanceOn(result, "2026-10-15"));
    }

    [Fact]
    public void Portado_baixa_atrasada_debita_no_dia_em_que_foi_paga()
    {
        var result = CashflowProjector.Project(BaseInput(bills: [Rent()], payments: [Payment("2026-10", BillPaymentStatus.Paid, 155_000, "2026-10-12")]), "2026-10-01", "2026-10-31");
        Assert.Empty(result.OverdueBills);
        Assert.Equal((100_000L - 155_000, -55_000L), (BalanceOn(result, "2026-10-12")!.Value, result.TodayBalanceCents));
    }

    [Fact]
    public void Portado_nao_vou_pagar_tira_a_competencia()
    {
        var result = CashflowProjector.Project(BaseInput(bills: [Rent()], payments: [Payment("2026-10", BillPaymentStatus.Waived, 150_000, "2026-10-12")]), "2026-10-01", "2026-10-31");
        Assert.Empty(result.OverdueBills);
        Assert.Equal(100_000L, result.EndOfMonthCents);
    }

    [Fact]
    public void Portado_conta_vencida_antes_do_saldo_inicial_ja_esta_embutida()
    {
        var result = CashflowProjector.Project(BaseInput(opening: "2026-10-12", bills: [Rent()]), "2026-10-01", "2026-10-31");
        Assert.Empty(result.OverdueBills);
        Assert.Equal(100_000L, result.EndOfMonthCents);
    }

    [Fact]
    public void Portado_conta_com_prazo_para_depois_da_ultima_parcela()
    {
        var result = CashflowProjector.Project(BaseInput(today: "2026-10-01", bills: [Rent(5, "2026-09", 2)]), "2026-10-01", "2026-12-31");
        var bills = result.Days.SelectMany(d => d.Events).Where(e => e.Kind == CashflowEventKind.Bill).ToList();
        Assert.Equal("Aluguel 2/2", bills.Single().Label);
    }

    [Fact]
    public void Portado_vencimento_31_cai_no_ultimo_dia_de_fevereiro()
    {
        var result = CashflowProjector.Project(BaseInput(today: "2027-02-01", opening: "2027-02-01", bills: [Rent(31)]), "2027-02-01", "2027-02-28");
        Assert.Equal(CashflowEventKind.Bill, result.Days.Single(d => d.Date == "2027-02-28").Events[0].Kind);
    }

    /* ── Portados: cartões, metas e simulação ── */

    [Fact]
    public void Portado_fatura_sai_inteira_no_vencimento()
    {
        var result = CashflowProjector.Project(BaseInput(invoices: [new("c1", "Nubank", MonthRef.Parse("2026-10"), "2026-10-20", 30_000), new("c2", "Zero", MonthRef.Parse("2026-10"), "2026-10-21", 0)]), "2026-10-01", "2026-10-31");
        Assert.Equal((100_000L, 70_000L, 70_000L), (BalanceOn(result, "2026-10-19")!.Value, BalanceOn(result, "2026-10-20")!.Value, BalanceOn(result, "2026-10-21")!.Value));
        Assert.Equal(("Fatura Nubank", true, "2026-10"), (result.Days.Single(d => d.Date == "2026-10-20").Events[0].Label, result.Days.Single(d => d.Date == "2026-10-20").Events[0].Projected, result.Days.Single(d => d.Date == "2026-10-20").Events[0].Month));
    }

    [Fact]
    public void Portado_meta_sai_do_saldo_e_conta_como_guardado()
    {
        var result = CashflowProjector.Project(BaseInput(deposits: [new("g1", "Viagem", "2026-10-05", 10_000)]), "2026-10-01", "2026-10-31");
        var october = result.Months[0];
        Assert.Equal((10_000L, 0L, 90_000L), (october.SavedCents, october.OutCents, october.ClosingCents));
    }

    [Fact]
    public void Portado_veredito_avisa_quando_fica_negativo()
    {
        var input = BaseInput(balance: 20_000);
        var before = CashflowProjector.Project(input, "2026-10-01", "2026-10-31");
        var after = CashflowProjector.Project(input with { ExtraEvents = [new("2026-10-16", "TV", 30_000)] }, "2026-10-01", "2026-10-31");
        var (verdict, fits) = CashflowProjector.BuildVerdict(before, after);
        Assert.False(fits);
        Assert.Contains("fica negativo em 16/10", verdict, StringComparison.Ordinal);
    }

    /* ── Casos do .NET ── */

    [Fact]
    public void Vereditos_cabe_ja_negativo_e_sem_dias()
    {
        var input = BaseInput(balance: 20_000);
        var before = CashflowProjector.Project(input, "2026-10-01", "2026-10-31");
        var cheap = CashflowProjector.Project(input with { ExtraEvents = [new("2026-10-16", "Livro", 5_000)] }, "2026-10-01", "2026-10-31");
        Assert.Equal(("Seu menor saldo vai de R$ 200,00 para R$ 150,00 em 16/10. Cabe no seu saldo.", true), CashflowProjector.BuildVerdict(before, cheap));

        var negative = BaseInput(balance: -1_000);
        var already = CashflowProjector.BuildVerdict(
            CashflowProjector.Project(negative, "2026-10-01", "2026-10-31"),
            CashflowProjector.Project(negative with { ExtraEvents = [new("2026-10-20", "TV", 1)] }, "2026-10-01", "2026-10-31"));
        Assert.EndsWith("Seu saldo já fica negativo sem essa compra — ela aumenta o buraco.", already.Verdict, StringComparison.Ordinal);

        var past = CashflowProjector.Project(input, "2026-10-01", "2026-10-10");
        Assert.Equal(("Não há dias à frente no intervalo para comparar.", true), CashflowProjector.BuildVerdict(past, past));
    }

    [Fact]
    public void Hoje_antes_do_saldo_inicial_e_meses_fechados()
    {
        var early = CashflowProjector.Project(BaseInput(today: "2026-09-20", transactions: [new("t", "2026-10-02", EntryType.Expense, 1, "x")]), "2026-09-01", "2026-10-31");
        Assert.Equal((100_000L, true), (early.TodayBalanceCents, early.Days[1].Events[0].Projected));

        var months = CashflowProjector.Project(BaseInput(opening: "2026-08-01", incomes: [new("i", "S", 10, 1)]), "2026-08-15", "2026-11-30").Months;
        Assert.Equal([("2026-08", true, "Agosto 2026"), ("2026-09", true, "Setembro 2026"), ("2026-10", false, "Outubro 2026"), ("2026-11", false, "Novembro 2026")], months.Select(m => (m.Month, m.Closed, m.Label)));
        Assert.Equal((100_010L, 100_010L), (months[1].OpeningCents, months[0].ClosingCents));
    }

    [Fact]
    public void Hoje_inexistente_e_texto_como_no_Node()
    {
        // "2026-02-31": o fim vai até "2026-02-31" (texto), o laço visita só até 28/02 e o
        // evento de atraso marcado para "2026-02-31" não cai em dia nenhum.
        var result = CashflowProjector.Project(BaseInput(today: "2026-02-31", opening: "2026-02-01", bills: [Rent(10, "2026-02")]), "2026-02-01", "2026-02-28");
        Assert.Equal("2026-02-28", result.Days[^1].Date);
        Assert.Single(result.OverdueBills);
        Assert.DoesNotContain(result.Days.SelectMany(d => d.Events), e => e.Kind == CashflowEventKind.BillOverdue);
        Assert.Equal(0L, result.TodayBalanceCents);

        var empty = Cashflow.NotConfigured("2026-10-01", "2026-10-31", "2026-10-15");
        Assert.Equal((false, null, "2026-10-15", 0L, null), (empty.Configured, empty.OpeningDate, empty.Today, empty.EndOfMonthCents, empty.Lowest));
        Assert.True(empty.Days.Count == 0 && empty.Months.Count == 0 && empty.OverdueBills.Count == 0);
    }

    [Fact]
    public void Datas_como_texto()
    {
        Assert.Equal("2026-03-04", IsoText.AddDays("2026-02-31", 1));
        Assert.Equal("2027-01-01", IsoText.AddDays("2026-12-31", 1));
        Assert.Equal(3, IsoText.DiffDays("2026-02-28", "2026-02-31"));
        Assert.Equal("2026-02-31", IsoText.Max("2026-02-28", "2026-02-31", "2026-01-31"));
        Assert.Equal(("2026-02-28", "31/02"), (IsoText.LastDayOfMonth("2026-02-31"), IsoText.ShortDate("2026-02-31")));
        Assert.Throws<ArgumentException>(() => IsoText.AddDays("2026-00-10", 1));
    }
}
