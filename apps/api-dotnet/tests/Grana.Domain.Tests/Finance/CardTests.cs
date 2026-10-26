using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Domain.Tests.Finance;

/// <summary>Cartões, compras e faturas — RN-130–136 (card.calculator.ts).</summary>
public class CardTests
{
    private static readonly DateTime Now = new(2026, 10, 26, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Category Market = Category.CreateSystem("mercado", "u1", "Mercado", "verde", CategoryKind.Expense);
    private static readonly Card Nubank = Card.Restore("c1", "u1", "Nubank", 3, 10, null, true);

    private static CardPurchase Buy(string id, int amount, int installments, string date, string? note = null, Card? card = null) =>
        CardPurchase.Create(id, card ?? Nubank, Market, amount, installments, IsoDate.Parse(date), note, Now);

    /* Casos portados de apps/api/src/modules/finance/domain/card.calculator.test.ts. */

    [Fact]
    public void Portado_compra_antes_do_fechamento_cai_no_mes_no_dia_ou_depois_na_seguinte()
    {
        Assert.Equal("2026-10", CardInvoiceCalculator.InvoiceMonthFor(Nubank, "2026-10-02").Value);
        Assert.Equal("2026-11", CardInvoiceCalculator.InvoiceMonthFor(Nubank, "2026-10-03").Value);
        Assert.Equal("2027-01", CardInvoiceCalculator.InvoiceMonthFor(Nubank, "2026-12-25").Value);
    }

    [Fact]
    public void Portado_vencimento_depois_do_fechamento_no_mesmo_mes_antes_no_seguinte()
    {
        Assert.Equal(new DateOnly(2026, 10, 10), CardInvoiceCalculator.DueDate(Nubank, MonthRef.Parse("2026-10")));
        Assert.Equal(new DateOnly(2026, 11, 5), CardInvoiceCalculator.DueDate(Card.Restore("x", "u1", "x", 25, 5, null, true), MonthRef.Parse("2026-10")));
    }

    [Fact]
    public void Portado_parcelas_somam_o_total_e_o_resto_vai_na_primeira()
    {
        Assert.Equal([3_334, 3_333, 3_333], CardInvoiceCalculator.SplitInstallments(10_000, 3));
        Assert.Equal([7], CardInvoiceCalculator.SplitInstallments(7, 0));
    }

    [Fact]
    public void Portado_parcelada_espalha_uma_parcela_por_fatura()
    {
        var items = CardInvoiceCalculator.InstallmentsOf(Nubank, Buy("p1", 30_000, 3, "2026-10-05"));
        Assert.Equal(
            [("2026-11", "2026-11-10", 10_000, 1), ("2026-12", "2026-12-10", 10_000, 2), ("2027-01", "2027-01-10", 10_000, 3)],
            items.Select(i => (i.Month.Value, i.DueDate.ToIso(), i.AmountCents, i.Number)));
    }

    [Fact]
    public void Portado_agrupa_as_parcelas_por_fatura_e_marca_o_status()
    {
        var invoices = CardInvoiceCalculator.BuildInvoices(Nubank, [Buy("p1", 20_000, 2, "2026-10-05"), Buy("p2", 5_000, 1, "2026-11-01")], "2026-11-05");
        Assert.Equal([("2026-11", 15_000L, InvoiceStatus.Closed), ("2026-12", 10_000L, InvoiceStatus.Open)], invoices.Select(i => (i.Month.Value, i.TotalCents, i.Status)));

        var later = CardInvoiceCalculator.BuildInvoices(Nubank, [Buy("p3", 30_000, 3, "2026-10-05")], "2026-10-05");
        Assert.Equal([InvoiceStatus.Open, InvoiceStatus.Future, InvoiceStatus.Future], later.Select(i => i.Status));
    }

    /* Casos do .NET. */

    [Fact]
    public void Status_passado_e_dia_31_limitado()
    {
        var card = Card.Restore("c", "u1", "C", 31, 5, null, true);
        Assert.Equal(new DateOnly(2026, 2, 28), CardInvoiceCalculator.ClosingDate(card, MonthRef.Parse("2026-02")));
        Assert.Equal("2026-03", CardInvoiceCalculator.InvoiceMonthFor(card, "2026-02-28").Value);
        Assert.Equal(InvoiceStatus.Past, CardInvoiceCalculator.StatusOf(card, MonthRef.Parse("2026-01"), "2026-02-06"));
        Assert.Equal(InvoiceStatus.Closed, CardInvoiceCalculator.StatusOf(card, MonthRef.Parse("2026-01"), "2026-02-05"));
    }

    [Fact]
    public void Hoje_inexistente_e_comparado_como_texto()
    {
        // "2026-02-31" < "2026-03-..." mas > "2026-02-28": fecha fevereiro e fica na fatura de março.
        var card = Card.Restore("c", "u1", "C", 28, 10, null, true);
        Assert.Equal("2026-03", CardInvoiceCalculator.OpenInvoiceMonth(card, "2026-02-31").Value);
        Assert.Equal(InvoiceStatus.Closed, CardInvoiceCalculator.StatusOf(card, MonthRef.Parse("2026-02"), "2026-02-31"));
    }

    [Fact]
    public void Resumo_da_listagem_inclui_a_aberta_vazia_ate_4_e_limite_pelos_vencimentos()
    {
        var purchases = new[] { Buy("p1", 12_000, 12, "2026-09-02"), Buy("p2", 500, 1, "2026-07-01") };
        var (invoices, used) = CardInvoiceCalculator.Summary(Nubank, purchases, "2026-10-26");
        Assert.Equal(["2026-11", "2026-12", "2027-01", "2027-02"], invoices.Select(i => i.Month.Value));
        Assert.Equal(1_000L * 10, used);

        var (empty, nothing) = CardInvoiceCalculator.Summary(Nubank, [], "2026-10-26");
        Assert.Equal(("2026-11", 0L, InvoiceStatus.Open, 0L), (empty.Single().Month.Value, empty.Single().TotalCents, empty.Single().Status, nothing));
        Assert.Empty(CardInvoiceCalculator.InvoiceFor(Nubank, purchases, MonthRef.Parse("2030-01"), "2026-10-26").Items);
    }

    [Fact]
    public void Cartao_e_compra()
    {
        var card = Card.Create("c2", "u1", "Elo", 1, 8, 100);
        card.Update(Patch.Set("Elo+"), Patch.Set(2), Patch.Set(9), Patch.Set<int?>(null), Patch.Set(false));
        Assert.Equal(("Elo+", 2, 9, (int?)null, false, "u1"), (card.Name, card.ClosingDay, card.DueDay, card.LimitCents, card.Active, card.UserId));

        var purchase = Buy("p", 100, 1, "2026-10-01", note: "");
        Assert.Equal((null, "Mercado", "c1", "u1"), (purchase.Note, purchase.Label, purchase.CardId, purchase.UserId));
        Assert.Equal("Geladeira", Buy("q", 100, 1, "2026-10-01", note: "Geladeira").Label);

        var salary = Category.CreateSystem("s", "u1", "Salário", "x", CategoryKind.Income);
        Assert.Equal("Compra no cartão precisa de uma categoria de despesa.",
            Assert.Throws<BusinessRuleError>(() => CardPurchase.Create("z", Nubank, salary, 1, 1, new DateOnly(2026, 1, 1), null, Now)).Message);
        var restored = CardPurchase.Restore("r", "u1", "c1", CategoryRef.Of(Market), 1, 2, new DateOnly(2026, 1, 1), "x", Now);
        Assert.Equal((2, Now), (restored.Installments, restored.CreatedAt));
    }
}
