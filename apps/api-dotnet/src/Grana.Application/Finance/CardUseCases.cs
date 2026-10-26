using Grana.Application.Common;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Finance;

public interface ICardRepository
{
    /// <summary>Ordem <c>active desc, createdAt asc</c>.</summary>
    Task<IReadOnlyList<Card>> ListAsync(string userId, CancellationToken cancellationToken);

    Task<Card?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken);

    Task AddAsync(Card card, DateTime nowUtc, CancellationToken cancellationToken);

    Task UpdateAsync(Card card, DateTime nowUtc, CancellationToken cancellationToken);

    /// <summary>As compras vão junto, em cascata (RN-130).</summary>
    Task DeleteAsync(string userId, string id, CancellationToken cancellationToken);

    /// <summary>Compras do usuário (ou de um cartão), na ordem <c>purchasedOn desc, createdAt desc</c>.</summary>
    Task<IReadOnlyList<CardPurchase>> ListPurchasesAsync(string userId, string? cardId, CancellationToken cancellationToken);

    Task<CardPurchase?> FindPurchaseAsync(string userId, string id, CancellationToken cancellationToken);

    Task AddPurchaseAsync(CardPurchase purchase, CancellationToken cancellationToken);

    Task DeletePurchaseAsync(string userId, string id, CancellationToken cancellationToken);
}

public sealed record InvoiceSummaryDto(string Month, DateOnly ClosingDate, DateOnly DueDate, long TotalCents, string Status)
{
    public static InvoiceSummaryDto From(CardInvoice invoice)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        return new(invoice.Month.Value, invoice.ClosingDate, invoice.DueDate, invoice.TotalCents, StatusName(invoice.Status));
    }

    public static string StatusName(InvoiceStatus status) => status switch
    {
        InvoiceStatus.Open => "OPEN",
        InvoiceStatus.Closed => "CLOSED",
        InvoiceStatus.Future => "FUTURE",
        _ => "PAST",
    };
}

public sealed record CardDto(
    string Id, string Name, int ClosingDay, int DueDay, int? LimitCents, bool Active, long UsedLimitCents, IReadOnlyList<InvoiceSummaryDto> Invoices)
{
    public static CardDto From(Card card, IReadOnlyList<CardPurchase> purchases, string today)
    {
        ArgumentNullException.ThrowIfNull(card);
        var (invoices, used) = CardInvoiceCalculator.Summary(card, purchases, today);
        return new(card.Id, card.Name, card.ClosingDay, card.DueDay, card.LimitCents, card.Active, used, [.. invoices.Select(InvoiceSummaryDto.From)]);
    }
}

public sealed record InvoiceItemDto(
    string PurchaseId, string Label, CategoryRefDto Category, DateOnly PurchasedOn, int InstallmentNumber, int Installments, long AmountCents);

public sealed record InvoiceDetailDto(
    string CardId, string CardName, string Month, DateOnly ClosingDate, DateOnly DueDate, long TotalCents, string Status, IReadOnlyList<InvoiceItemDto> Items);

public sealed record CardPurchaseDto(
    string Id, string CardId, int AmountCents, int Installments, DateOnly PurchasedOn, string? Note, CategoryRefDto Category)
{
    public static CardPurchaseDto From(CardPurchase purchase)
    {
        ArgumentNullException.ThrowIfNull(purchase);
        return new(purchase.Id, purchase.CardId, purchase.AmountCents, purchase.Installments, purchase.PurchasedOn, purchase.Note, CategoryRefDtoOf(purchase.Category));
    }

    internal static CategoryRefDto CategoryRefDtoOf(CategoryRef category) =>
        new(category.Id, category.Name, category.Color, CategoryDto.KindName(category.Kind));
}

public sealed record CreateCardCommand(string Name, int ClosingDay, int DueDay, int? LimitCents);

public sealed record UpdateCardCommand(Patch<string> Name, Patch<int> ClosingDay, Patch<int> DueDay, Patch<int?> LimitCents, Patch<bool> Active);

/// <summary>Compra: a data vem como texto e é lida como o <c>Date</c> do JS (31/02 → 03/03).</summary>
public sealed record CreateCardPurchaseCommand(int AmountCents, int Installments, string PurchasedOn, string CategoryId, string? Note);

/// <summary>Cartões, faturas e compras — <c>cards.usecases.ts</c> (RN-130–136).</summary>
public sealed class CardUseCases(ICardRepository cards, ICategoryRepository categories, IClock clock, IIdGenerator ids)
{
    private string ServerToday => DateOnly.FromDateTime(clock.UtcNow).ToIso();

    /// <param name="today"><c>?today=</c> como texto; padrão: hoje em UTC.</param>
    public async Task<IReadOnlyList<CardDto>> ListAsync(Actor actor, string? today, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var list = await cards.ListAsync(actor.UserId, cancellationToken).ConfigureAwait(false);
        var purchases = await cards.ListPurchasesAsync(actor.UserId, null, cancellationToken).ConfigureAwait(false);
        var day = today ?? ServerToday;
        return [.. list.Select(card => CardDto.From(card, [.. purchases.Where(purchase => purchase.CardId == card.Id)], day))];
    }

    public async Task<CardDto> CreateAsync(Actor actor, CreateCardCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var card = Card.Create(ids.NewId(), actor.UserId, command.Name, command.ClosingDay, command.DueDay, command.LimitCents);
        await cards.AddAsync(card, clock.UtcNow, cancellationToken).ConfigureAwait(false);
        return CardDto.From(card, [], ServerToday);
    }

    public async Task<CardDto> UpdateAsync(Actor actor, string id, UpdateCardCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var card = await cards.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Cartão");
        card.Update(command.Name, command.ClosingDay, command.DueDay, command.LimitCents, command.Active);
        await cards.UpdateAsync(card, clock.UtcNow, cancellationToken).ConfigureAwait(false);
        var purchases = await cards.ListPurchasesAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false);
        return CardDto.From(card, purchases, ServerToday);
    }

    public async Task DeleteAsync(Actor actor, string id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        _ = await cards.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Cartão");
        await cards.DeleteAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Fatura de <paramref name="month"/> (padrão: a aberta pela data UTC do servidor; sem <c>today</c> na rota — RN-136).</summary>
    public async Task<InvoiceDetailDto> InvoiceAsync(Actor actor, string cardId, MonthRef? month, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var card = await cards.FindByIdAsync(actor.UserId, cardId, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Cartão");
        var purchases = await cards.ListPurchasesAsync(actor.UserId, cardId, cancellationToken).ConfigureAwait(false);
        var byId = purchases.ToDictionary(purchase => purchase.Id);
        var today = ServerToday;
        var invoice = CardInvoiceCalculator.InvoiceFor(card, purchases, month ?? CardInvoiceCalculator.OpenInvoiceMonth(card, today), today);
        return new InvoiceDetailDto(
            card.Id, card.Name, invoice.Month.Value, invoice.ClosingDate, invoice.DueDate, invoice.TotalCents, InvoiceSummaryDto.StatusName(invoice.Status),
            [.. invoice.Items.Select(item =>
            {
                var purchase = byId[item.PurchaseId];
                return new InvoiceItemDto(
                    purchase.Id, purchase.Label, CardPurchaseDto.CategoryRefDtoOf(purchase.Category), purchase.PurchasedOn, item.Number, item.Installments, item.AmountCents);
            })]);
    }

    /// <summary>Cartão (404), categoria (404) e categoria de despesa (422), nessa ordem (RN-133).</summary>
    public async Task<CardPurchaseDto> CreatePurchaseAsync(Actor actor, string cardId, CreateCardPurchaseCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var card = await cards.FindByIdAsync(actor.UserId, cardId, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Cartão");
        var category = await categories.FindByIdAsync(actor.UserId, command.CategoryId, cancellationToken).ConfigureAwait(false)
            ?? throw new NotFoundError("Categoria");
        var purchasedOn = JsDate.ParseIsoDate(command.PurchasedOn)
            ?? throw new ArgumentException($"Data inválida depois da validação: \"{command.PurchasedOn}\".", nameof(command));
        var purchase = CardPurchase.Create(ids.NewId(), card, category, command.AmountCents, command.Installments, purchasedOn, command.Note, clock.UtcNow);
        await cards.AddPurchaseAsync(purchase, cancellationToken).ConfigureAwait(false);
        return CardPurchaseDto.From(purchase);
    }

    public async Task DeletePurchaseAsync(Actor actor, string id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        _ = await cards.FindPurchaseAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Compra");
        await cards.DeletePurchaseAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false);
    }
}
