using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Domain.Tests.Finance;

/// <summary>Lançamentos — RN-080–086 (transactions.usecases.ts).</summary>
public class TransactionTests
{
    private static readonly DateTime Now = new(2026, 10, 26, 13, 0, 0, 500, DateTimeKind.Utc);
    private static readonly Category Market = Category.CreateSystem("mercado", "u1", "Mercado", "oklch(0.62 0.10 145)", CategoryKind.Expense);
    private static readonly Category Salary = Category.CreateSystem("salario", "u1", "Salário", "oklch(0.62 0.10 160)", CategoryKind.Income);

    private static Transaction Expense(int cents = 100, string date = "2026-10-26", string? note = null) =>
        Transaction.Create($"t-{cents}-{date}", "u1", Market, EntryType.Expense, cents, IsoDate.Parse(date), note, Now);

    private static Transaction Income(int cents, string date) =>
        Transaction.Create($"t-{cents}-{date}", "u1", Salary, EntryType.Income, cents, IsoDate.Parse(date), null, Now);

    [Fact]
    public void Cria_com_a_categoria_resumida()
    {
        var transaction = Expense(1250, "2026-12-05", "feira");
        Assert.Equal((EntryType.Expense, 1250, new DateOnly(2026, 12, 5), "feira", Now),
            (transaction.Type, transaction.AmountCents, transaction.OccurredOn, transaction.Note, transaction.CreatedAt));
        Assert.Equal(new CategoryRef("mercado", "Mercado", "oklch(0.62 0.10 145)", CategoryKind.Expense), transaction.Category);
        Assert.Equal(("t-1250-2026-12-05", "u1"), (transaction.Id, transaction.UserId));
    }

    [Fact]
    public void Categoria_arquivada_e_recusada_antes_do_tipo()
    {
        var archived = Category.CreateCustom("arq", "u1", "Arquivada", CategoryKind.Income, null, 0);
        archived.SetArchived(true, Now);
        var error = Assert.Throws<BusinessRuleError>(() =>
            Transaction.Create("t", "u1", archived, EntryType.Expense, 1, new DateOnly(2026, 1, 1), null, Now));
        Assert.Equal("Esta categoria está arquivada. Escolha outra.", error.Message);
    }

    [Fact]
    public void Tipo_da_categoria_precisa_combinar_na_criacao()
    {
        Assert.Equal("Escolha uma categoria de despesa para um gasto.", Assert.Throws<BusinessRuleError>(() =>
            Transaction.Create("t", "u1", Salary, EntryType.Expense, 1, new DateOnly(2026, 1, 1), null, Now)).Message);
        Assert.Equal("Escolha uma categoria de entrada para um recebimento.", Assert.Throws<BusinessRuleError>(() =>
            Transaction.Create("t", "u1", Market, EntryType.Income, 1, new DateOnly(2026, 1, 1), null, Now)).Message);
    }

    [Fact]
    public void Edicao_troca_categoria_do_mesmo_tipo_mesmo_arquivada_e_limpa_observacao()
    {
        var transaction = Expense(note: "antes");
        Assert.Equal("A categoria escolhida não combina com o tipo do lançamento.",
            Assert.Throws<BusinessRuleError>(() => transaction.ChangeCategory(Salary)).Message);

        var archived = Category.CreateCustom("arq", "u1", "Arquivada", CategoryKind.Expense, "#000", 0);
        archived.SetArchived(true, Now);
        transaction.ChangeCategory(archived);
        transaction.ChangeAmount(999);
        transaction.ChangeDate(new DateOnly(2026, 3, 3));
        transaction.ChangeNote(null);
        Assert.Equal(("arq", 999, new DateOnly(2026, 3, 3), (string?)null),
            (transaction.Category.Id, transaction.AmountCents, transaction.OccurredOn, transaction.Note));
    }

    [Fact]
    public void Restore_preserva_o_estado()
    {
        var category = new CategoryRef("c", "Lazer", "x", CategoryKind.Expense);
        var transaction = Transaction.Restore("t", "u1", EntryType.Income, 7, new DateOnly(2025, 1, 2), "", category, Now);
        Assert.Equal((EntryType.Income, "", category, -7L), (transaction.Type, transaction.Note, transaction.Category, transaction.SignedCents));
    }

    [Fact]
    public void Agrupa_por_dia_do_mais_recente_com_rotulos_e_saldo()
    {
        var today = new DateOnly(2026, 10, 26);
        var items = new[]
        {
            Expense(3000, "2026-10-26"),
            Expense(1, "2026-10-25"),
            Income(500000, "2025-03-05"),
            Expense(2000, "2025-03-05"),
            Expense(1000, "2025-03-05"),
            Expense(5, "2026-12-31"),
        };

        var groups = TransactionGrouping.GroupByDay(items, today);

        Assert.Equal(
            [("2026-12-31", "31 de dezembro", 5L, 1), ("2026-10-26", "Hoje", 3000L, 1), ("2026-10-25", "Ontem", 1L, 1), ("2025-03-05", "05 de março", 1000L + 2000 - 500000, 3)],
            groups.Select(g => (g.Date.ToIso(), g.Label, g.TotalCents, g.Items.Count)));
        Assert.Equal([500000, 2000, 1000], groups[3].Items.Select(t => t.AmountCents));
        Assert.Empty(TransactionGrouping.GroupByDay([], today));
    }

    [Fact]
    public void Ontem_atravessa_a_virada_do_mes()
    {
        var groups = TransactionGrouping.GroupByDay([Expense(1, "2026-02-28")], new DateOnly(2026, 3, 1));
        Assert.Equal("Ontem", groups.Single().Label);
    }

    [Fact]
    public void Resumo_conta_o_total_e_soma_so_as_despesas_da_pagina()
    {
        Assert.Equal("4 lançamentos · R$ 30,00 em gastos", TransactionGrouping.Summary(4, [Expense(3000), Income(500000, "2025-03-05")]));
        Assert.Equal("1 lançamento · R$ 0,00 em gastos", TransactionGrouping.Summary(1, [Income(500000, "2025-03-05")]));
        Assert.Equal("0 lançamentos · R$ 0,00 em gastos", TransactionGrouping.Summary(0, []));
        Assert.Equal("2 lançamentos · R$ 1.234.567,89 em gastos", TransactionGrouping.Summary(2, [Expense(123456789), Expense(0)]));
    }
}
