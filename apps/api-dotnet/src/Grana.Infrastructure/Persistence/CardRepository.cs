using Grana.Application.Finance;
using Grana.Domain.Finance;
using Microsoft.EntityFrameworkCore;

namespace Grana.Infrastructure.Persistence;

/// <summary>Cartões e compras — <c>PrismaCardRepository</c>.</summary>
public sealed class EfCardRepository(GranaDbContext db) : ICardRepository
{
    public async Task<IReadOnlyList<Card>> ListAsync(string userId, CancellationToken cancellationToken)
    {
        var rows = await db.Cards.AsNoTracking().Where(c => c.UserId == userId).OrderByDescending(c => c.Active).ThenBy(c => c.CreatedAt)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(ToDomain)];
    }

    public async Task<Card?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken)
    {
        var row = await db.Cards.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId, cancellationToken).ConfigureAwait(false);
        return row is null ? null : ToDomain(row);
    }

    public async Task AddAsync(Card card, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(card);
        db.Cards.Add(new CardRow
        {
            Id = card.Id,
            UserId = card.UserId,
            Name = card.Name,
            ClosingDay = card.ClosingDay,
            DueDay = card.DueDay,
            LimitCents = card.LimitCents,
            Active = card.Active,
            CreatedAt = nowUtc,
            UpdatedAt = nowUtc,
        });
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdateAsync(Card card, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(card);
        var row = await db.Cards.FirstAsync(c => c.Id == card.Id && c.UserId == card.UserId, cancellationToken).ConfigureAwait(false);
        row.Name = card.Name;
        row.ClosingDay = card.ClosingDay;
        row.DueDay = card.DueDay;
        row.LimitCents = card.LimitCents;
        row.Active = card.Active;
        row.UpdatedAt = nowUtc;
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken) =>
        db.Cards.Where(c => c.Id == id && c.UserId == userId).ExecuteDeleteAsync(cancellationToken);

    public async Task<IReadOnlyList<CardPurchase>> ListPurchasesAsync(string userId, string? cardId, CancellationToken cancellationToken)
    {
        var query = db.CardPurchases.AsNoTracking().Include(p => p.Category).Where(p => p.UserId == userId);
        if (!string.IsNullOrEmpty(cardId)) query = query.Where(p => p.CardId == cardId);
        var rows = await query.OrderByDescending(p => p.PurchasedOn).ThenByDescending(p => p.CreatedAt)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(ToDomain)];
    }

    public async Task<CardPurchase?> FindPurchaseAsync(string userId, string id, CancellationToken cancellationToken)
    {
        var row = await db.CardPurchases.AsNoTracking().Include(p => p.Category)
            .FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId, cancellationToken).ConfigureAwait(false);
        return row is null ? null : ToDomain(row);
    }

    public async Task AddPurchaseAsync(CardPurchase purchase, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(purchase);
        db.CardPurchases.Add(new CardPurchaseRow
        {
            Id = purchase.Id,
            UserId = purchase.UserId,
            CardId = purchase.CardId,
            CategoryId = purchase.Category.Id,
            AmountCents = purchase.AmountCents,
            Installments = purchase.Installments,
            PurchasedOn = purchase.PurchasedOn,
            Note = purchase.Note,
            CreatedAt = purchase.CreatedAt,
        });
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public Task DeletePurchaseAsync(string userId, string id, CancellationToken cancellationToken) =>
        db.CardPurchases.Where(p => p.Id == id && p.UserId == userId).ExecuteDeleteAsync(cancellationToken);

    private static Card ToDomain(CardRow row) =>
        Card.Restore(row.Id, row.UserId, row.Name, row.ClosingDay, row.DueDay, row.LimitCents, row.Active);

    private static CardPurchase ToDomain(CardPurchaseRow row)
    {
        var category = row.Category ?? throw new InvalidOperationException($"Compra {row.Id} sem categoria carregada.");
        return CardPurchase.Restore(row.Id, row.UserId, row.CardId,
            new CategoryRef(category.Id, category.Name, category.Color, category.Kind == CategoryKindDb.INCOME ? CategoryKind.Income : CategoryKind.Expense),
            row.AmountCents, row.Installments, row.PurchasedOn, row.Note, row.CreatedAt);
    }
}
