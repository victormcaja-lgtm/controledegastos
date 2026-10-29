using Grana.Application.Common;
using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Tests.Finance;

/// <summary>cards.usecases.ts — RN-130–136.</summary>
public class CardUseCasesTests
{
    private static readonly DateTime Now = new(2026, 10, 26, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Actor Ana = new("u1", "ana@grana.app", "USER");

    private readonly InMemoryCategories _categories = new();
    private readonly InMemoryCards _cards = new();
    private readonly CardUseCases _useCases;

    public CardUseCasesTests()
    {
        _useCases = new CardUseCases(_cards, _categories, new FixedClock(Now), new SequentialIds());
        _categories.Items.Add(Category.CreateSystem("mercado", "u1", "Mercado", "verde", CategoryKind.Expense));
        _categories.Items.Add(Category.CreateSystem("salario", "u1", "Salário", "azul", CategoryKind.Income));
    }

    [Fact]
    public async Task Cria_lista_edita_e_exclui_cartao()
    {
        var created = await _useCases.CreateAsync(Ana, new CreateCardCommand("Nubank", 3, 10, 500000), CancellationToken.None);
        Assert.Equal(("Nubank", (int?)500000, true, 0L), (created.Name, created.LimitCents, created.Active, created.UsedLimitCents));
        Assert.Equal(new InvoiceSummaryDto("2026-11", new DateOnly(2026, 11, 3), new DateOnly(2026, 11, 10), 0, "OPEN"), created.Invoices.Single());

        await _useCases.CreatePurchaseAsync(Ana, created.Id, new CreateCardPurchaseCommand(30000, 3, "2026-10-05", "mercado", null), CancellationToken.None);
        var listed = await _useCases.ListAsync(Ana, "2026-10-05", CancellationToken.None);
        Assert.Equal(30000L, listed.Single().UsedLimitCents);
        Assert.Equal(["OPEN", "FUTURE", "FUTURE"], listed.Single().Invoices.Select(i => i.Status));
        Assert.Equal(3, (await _useCases.ListAsync(Ana, null, CancellationToken.None)).Single().Invoices.Count);

        var updated = await _useCases.UpdateAsync(Ana, created.Id, new UpdateCardCommand(default, default, default, Patch.Set<int?>(null), Patch.Set(false)), CancellationToken.None);
        Assert.Equal(((int?)null, false, 30000L), (updated.LimitCents, updated.Active, updated.UsedLimitCents));
        await Assert.ThrowsAsync<NotFoundError>(() => _useCases.UpdateAsync(Ana, "nada", new UpdateCardCommand(Patch.Set("x"), default, default, default, default), CancellationToken.None));

        await _useCases.DeleteAsync(Ana, created.Id, CancellationToken.None);
        Assert.Equal("Cartão não encontrado.", (await Assert.ThrowsAsync<NotFoundError>(() => _useCases.DeleteAsync(Ana, created.Id, CancellationToken.None))).Message);
    }

    [Fact]
    public async Task Compra_checa_cartao_categoria_e_tipo_e_rola_a_data()
    {
        var card = await _useCases.CreateAsync(Ana, new CreateCardCommand("Visa", 31, 10, null), CancellationToken.None);
        await Assert.ThrowsAsync<NotFoundError>(() => _useCases.CreatePurchaseAsync(Ana, "nada", new CreateCardPurchaseCommand(1, 1, "2026-01-01", "mercado", null), CancellationToken.None));
        Assert.Equal("Categoria não encontrado.", (await Assert.ThrowsAsync<NotFoundError>(() =>
            _useCases.CreatePurchaseAsync(Ana, card.Id, new CreateCardPurchaseCommand(1, 1, "2026-01-01", "nada", null), CancellationToken.None))).Message);
        await Assert.ThrowsAsync<BusinessRuleError>(() =>
            _useCases.CreatePurchaseAsync(Ana, card.Id, new CreateCardPurchaseCommand(1, 1, "2026-01-01", "salario", null), CancellationToken.None));

        var purchase = await _useCases.CreatePurchaseAsync(Ana, card.Id, new CreateCardPurchaseCommand(100, 2, "2026-02-31", "mercado", ""), CancellationToken.None);
        Assert.Equal(new CardPurchaseDto(purchase.Id, card.Id, 100, 2, new DateOnly(2026, 3, 3), null, new CategoryRefDto("mercado", "Mercado", "verde", "EXPENSE")), purchase);

        await _useCases.DeletePurchaseAsync(Ana, purchase.Id, CancellationToken.None);
        Assert.Equal("Compra não encontrado.", (await Assert.ThrowsAsync<NotFoundError>(() => _useCases.DeletePurchaseAsync(Ana, purchase.Id, CancellationToken.None))).Message);
    }

    [Fact]
    public async Task Fatura_com_itens_rotulos_e_mes_padrao()
    {
        var card = await _useCases.CreateAsync(Ana, new CreateCardCommand("Nubank", 3, 10, null), CancellationToken.None);
        await _useCases.CreatePurchaseAsync(Ana, card.Id, new CreateCardPurchaseCommand(20000, 2, "2026-10-05", "mercado", "Geladeira"), CancellationToken.None);
        await _useCases.CreatePurchaseAsync(Ana, card.Id, new CreateCardPurchaseCommand(5000, 1, "2026-11-01", "mercado", null), CancellationToken.None);

        var november = await _useCases.InvoiceAsync(Ana, card.Id, MonthRef.Parse("2026-11"), CancellationToken.None);
        Assert.Equal(("2026-11", 15000L, "OPEN", "Nubank"), (november.Month, november.TotalCents, november.Status, november.CardName));
        Assert.Equal([("Mercado", 1, 1, 5000), ("Geladeira", 1, 2, 10000)], november.Items.Select(i => (i.Label, i.InstallmentNumber, i.Installments, i.AmountCents)));

        var open = await _useCases.InvoiceAsync(Ana, card.Id, null, CancellationToken.None);
        Assert.Equal("2026-11", open.Month);
        Assert.Empty((await _useCases.InvoiceAsync(Ana, card.Id, MonthRef.Parse("2027-06"), CancellationToken.None)).Items);
        await Assert.ThrowsAsync<NotFoundError>(() => _useCases.InvoiceAsync(Ana, "nada", null, CancellationToken.None));
    }
}

internal sealed class InMemoryCards : ICardRepository
{
    private readonly List<Card> _cards = [];
    private readonly List<CardPurchase> _purchases = [];

    public Task<IReadOnlyList<Card>> ListAsync(string userId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Card>>([.. _cards.Where(c => c.UserId == userId)]);

    public Task<Card?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken) =>
        Task.FromResult(_cards.FirstOrDefault(c => c.UserId == userId && c.Id == id));

    public Task AddAsync(Card card, DateTime nowUtc, CancellationToken cancellationToken)
    {
        _cards.Add(card);
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Card card, DateTime nowUtc, CancellationToken cancellationToken) => Task.CompletedTask;

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken)
    {
        _cards.RemoveAll(c => c.UserId == userId && c.Id == id);
        _purchases.RemoveAll(p => p.CardId == id);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<CardPurchase>> ListPurchasesAsync(string userId, string? cardId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<CardPurchase>>([.. _purchases.Where(p => p.UserId == userId && (cardId is null || p.CardId == cardId)).OrderByDescending(p => p.PurchasedOn)]);

    public Task<CardPurchase?> FindPurchaseAsync(string userId, string id, CancellationToken cancellationToken) =>
        Task.FromResult(_purchases.FirstOrDefault(p => p.UserId == userId && p.Id == id));

    public Task AddPurchaseAsync(CardPurchase purchase, CancellationToken cancellationToken)
    {
        _purchases.Add(purchase);
        return Task.CompletedTask;
    }

    public Task DeletePurchaseAsync(string userId, string id, CancellationToken cancellationToken)
    {
        _purchases.RemoveAll(p => p.UserId == userId && p.Id == id);
        return Task.CompletedTask;
    }
}
