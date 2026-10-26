using Grana.Application.Common;
using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Tests.Finance;

/// <summary>transactions.usecases.ts — RN-080–086, na ordem de checagens do Node.</summary>
public class TransactionUseCasesTests
{
    private static readonly DateTime Now = new(2026, 10, 26, 9, 0, 0, DateTimeKind.Utc);
    private static readonly Actor Ana = new("u1", "ana@grana.app", "USER");

    private readonly InMemoryCategories _categories = new();
    private readonly InMemoryTransactions _transactions = new();
    private readonly TransactionUseCases _useCases;

    public TransactionUseCasesTests()
    {
        _useCases = new TransactionUseCases(_transactions, _categories, new FixedClock(Now), new SequentialIds());
        _categories.Items.Add(Category.CreateSystem("mercado", "u1", "Mercado", "verde", CategoryKind.Expense));
        _categories.Items.Add(Category.CreateSystem("lazer", "u1", "Lazer", "roxo", CategoryKind.Expense));
        _categories.Items.Add(Category.CreateSystem("salario", "u1", "Salário", "azul", CategoryKind.Income));
        _categories.Items.Add(Category.CreateSystem("alheia", "u2", "Mercado", "verde", CategoryKind.Expense));
    }

    private Task<TransactionDto> Create(string category = "mercado", EntryType type = EntryType.Expense, int cents = 100, string date = "2026-10-26", string? note = null) =>
        _useCases.CreateAsync(Ana, new CreateTransactionCommand(type, cents, category, date, note), CancellationToken.None);

    [Fact]
    public async Task Cria_rola_a_data_e_devolve_a_categoria_resumida()
    {
        var created = await Create(date: "2026-02-31", note: "");
        Assert.Equal(new TransactionDto("id-1", "EXPENSE", 100, new DateOnly(2026, 3, 3), "", new CategoryRefDto("mercado", "Mercado", "verde", "EXPENSE"), Now), created);
        Assert.Single(_transactions.Items);
    }

    [Fact]
    public async Task Categoria_de_outro_usuario_da_404_e_tipo_errado_da_422()
    {
        Assert.Equal("Categoria não encontrado.", (await Assert.ThrowsAsync<NotFoundError>(() => Create("alheia"))).Message);
        await Assert.ThrowsAsync<BusinessRuleError>(() => Create("salario"));
        Assert.Empty(_transactions.Items);
    }

    [Fact]
    public async Task Edita_com_a_ordem_de_checagens_do_Node()
    {
        var created = await Create(note: "antes");
        await Assert.ThrowsAsync<NotFoundError>(() =>
            _useCases.UpdateAsync(Ana, "nada", new UpdateTransactionCommand(Patch.Set(1), default, default, default), CancellationToken.None));
        await Assert.ThrowsAsync<NotFoundError>(() =>
            _useCases.UpdateAsync(Ana, created.Id, new UpdateTransactionCommand(default, Patch.Set("alheia"), default, default), CancellationToken.None));
        await Assert.ThrowsAsync<BusinessRuleError>(() =>
            _useCases.UpdateAsync(Ana, created.Id, new UpdateTransactionCommand(default, Patch.Set("salario"), default, default), CancellationToken.None));

        var updated = await _useCases.UpdateAsync(
            Ana, created.Id, new UpdateTransactionCommand(Patch.Set(999), Patch.Set("lazer"), Patch.Set("2026-01-15"), Patch.Set<string?>(null)), CancellationToken.None);
        Assert.Equal((999, "lazer", new DateOnly(2026, 1, 15), (string?)null), (updated.AmountCents, updated.Category.Id, updated.OccurredOn, updated.Note));
        Assert.Equal(1, _transactions.UpdateCount);
    }

    [Fact]
    public async Task Exclui_e_depois_404()
    {
        var created = await Create();
        await _useCases.DeleteAsync(Ana, created.Id, CancellationToken.None);
        Assert.Equal("Lançamento não encontrado.", (await Assert.ThrowsAsync<NotFoundError>(() => _useCases.DeleteAsync(Ana, created.Id, CancellationToken.None))).Message);
    }

    [Fact]
    public async Task Lista_com_grupos_paginas_e_resumo()
    {
        await Create(cents: 3000, date: "2026-10-26");
        await Create("salario", EntryType.Income, 500000, "2026-10-25");
        _transactions.TotalOverride = 7;

        var list = await _useCases.ListAsync(new TransactionFilter("u1", null, null, null, null, 1, 2), CancellationToken.None);

        Assert.Equal((1L, 2L, 7L, 4L), (list.Page, list.PerPage, list.Total, list.TotalPages));
        Assert.Equal("7 lançamentos · R$ 30,00 em gastos", list.Summary);
        Assert.Equal([("Hoje", 3000L), ("Ontem", -500000L)], list.Groups.Select(g => (g.Label, g.TotalCents)));
        Assert.Equal(2, list.Items.Count);

        _transactions.TotalOverride = 0;
        var empty = await _useCases.ListAsync(new TransactionFilter("u2", null, null, null, null, 3, 20), CancellationToken.None);
        Assert.Equal((1L, "0 lançamentos · R$ 0,00 em gastos"), (empty.TotalPages, empty.Summary));
    }
}

internal sealed class InMemoryTransactions : ITransactionRepository
{
    public List<Transaction> Items { get; } = [];

    public int UpdateCount { get; private set; }

    /// <summary>Total do filtro, para simular páginas além da primeira.</summary>
    public long? TotalOverride { get; set; }

    public Task<(IReadOnlyList<Transaction> Items, long Total)> ListAsync(TransactionFilter filter, CancellationToken cancellationToken)
    {
        IReadOnlyList<Transaction> mine = [.. Items.Where(t => t.UserId == filter.UserId)];
        return Task.FromResult((mine, TotalOverride ?? mine.Count));
    }

    public Task<Transaction?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken) =>
        Task.FromResult(Items.FirstOrDefault(t => t.UserId == userId && t.Id == id));

    public Task AddAsync(Transaction transaction, CancellationToken cancellationToken)
    {
        Items.Add(transaction);
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Transaction transaction, DateTime nowUtc, CancellationToken cancellationToken)
    {
        UpdateCount++;
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken)
    {
        Items.RemoveAll(t => t.UserId == userId && t.Id == id);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<Transaction>> ListForMonthAsync(string userId, MonthRef month, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Transaction>>([.. Items.Where(t => t.UserId == userId && MonthRef.Of(t.OccurredOn) == month).OrderByDescending(t => t.OccurredOn)]);

    /// <summary>Valor fixo: a média é consulta de banco (coberta no teste do repositório).</summary>
    public long Average { get; set; }

    public Task<long> AverageMonthlyExpenseAsync(string userId, int months, DateTime nowUtc, CancellationToken cancellationToken) => Task.FromResult(Average);
}
