using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;
using Microsoft.EntityFrameworkCore;

namespace Grana.Infrastructure.Persistence;

/// <summary>
/// Lançamentos — as consultas de <c>PrismaTransactionRepository</c>: mesmos filtros, mesma
/// ordem no SQL e a categoria junto (<c>include: { category }</c>).
/// </summary>
public sealed class EfTransactionRepository(GranaDbContext db) : ITransactionRepository
{
    public async Task<(IReadOnlyList<Transaction> Items, long Total)> ListAsync(TransactionFilter filter, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filter);
        var query = db.Transactions.AsNoTracking().Where(t => t.UserId == filter.UserId);
        if (!string.IsNullOrEmpty(filter.CategoryId)) query = query.Where(t => t.CategoryId == filter.CategoryId);
        if (filter.Type is { } type)
        {
            var typeDb = ToDb(type);
            query = query.Where(t => t.Type == typeDb);
        }

        if (!string.IsNullOrEmpty(filter.Search))
        {
            // `contains` + `mode: 'insensitive'` do Prisma: ILIKE '%…%' sem escapar `%` e `_` (⚠️).
            var pattern = $"%{filter.Search}%";
            query = query.Where(t => t.Note != null && EF.Functions.ILike(t.Note, pattern));
        }

        if (filter.Month is { } month)
        {
            var start = month.Start;
            var end = month.AddMonths(1).Start;
            query = query.Where(t => t.OccurredOn >= start && t.OccurredOn < end);
        }

        var total = await query.LongCountAsync(cancellationToken).ConfigureAwait(false);

        // Página além do alcance de um int: no Node ela sai vazia; aqui nem é consultada.
        var offset = (filter.Page - 1) * filter.PerPage;
        if (offset > int.MaxValue) return ([], total);

        var rows = await query
            .Include(t => t.Category)
            .OrderByDescending(t => t.OccurredOn).ThenByDescending(t => t.CreatedAt)
            .Skip((int)offset).Take((int)filter.PerPage)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return ([.. rows.Select(ToDomain)], total);
    }

    public async Task<Transaction?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken)
    {
        var row = await db.Transactions.AsNoTracking().Include(t => t.Category)
            .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId, cancellationToken).ConfigureAwait(false);
        return row is null ? null : ToDomain(row);
    }

    public async Task AddAsync(Transaction transaction, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(transaction);
        db.Transactions.Add(new TransactionRow
        {
            Id = transaction.Id,
            UserId = transaction.UserId,
            CategoryId = transaction.Category.Id,
            Type = ToDb(transaction.Type),
            AmountCents = transaction.AmountCents,
            OccurredOn = transaction.OccurredOn,
            Note = transaction.Note,
            BillId = null,
            CreatedAt = transaction.CreatedAt,
            UpdatedAt = transaction.CreatedAt,
        });
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdateAsync(Transaction transaction, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(transaction);
        var row = await db.Transactions
            .FirstAsync(t => t.Id == transaction.Id && t.UserId == transaction.UserId, cancellationToken).ConfigureAwait(false);
        row.CategoryId = transaction.Category.Id;
        row.AmountCents = transaction.AmountCents;
        row.OccurredOn = transaction.OccurredOn;
        row.Note = transaction.Note;
        row.UpdatedAt = nowUtc;
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken) =>
        db.Transactions.Where(t => t.Id == id && t.UserId == userId).ExecuteDeleteAsync(cancellationToken);

    public async Task<IReadOnlyList<Transaction>> ListForMonthAsync(string userId, MonthRef month, CancellationToken cancellationToken)
    {
        var start = month.Start;
        var end = month.AddMonths(1).Start;
        var rows = await db.Transactions.AsNoTracking().Include(t => t.Category)
            .Where(t => t.UserId == userId && t.OccurredOn >= start && t.OccurredOn < end)
            .OrderByDescending(t => t.OccurredOn).ThenByDescending(t => t.CreatedAt)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(ToDomain)];
    }

    public async Task<long> AverageMonthlyExpenseAsync(string userId, int months, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var current = MonthRef.Of(DateOnly.FromDateTime(nowUtc));
        var since = current.AddMonths(-months).Start;
        var until = current.Start;
        var sum = await db.Transactions
            .Where(t => t.UserId == userId && t.Type == EntryTypeDb.EXPENSE && t.OccurredOn >= since && t.OccurredOn < until)
            .SumAsync(t => (long)t.AmountCents, cancellationToken).ConfigureAwait(false);
        return (long)JsMath.Round(sum / (double)months);
    }

    private static Transaction ToDomain(TransactionRow row)
    {
        var category = row.Category ?? throw new InvalidOperationException($"Lançamento {row.Id} sem categoria carregada.");
        return Transaction.Restore(
            row.Id,
            row.UserId,
            row.Type == EntryTypeDb.INCOME ? EntryType.Income : EntryType.Expense,
            row.AmountCents,
            row.OccurredOn,
            row.Note,
            new CategoryRef(category.Id, category.Name, category.Color, category.Kind == CategoryKindDb.INCOME ? CategoryKind.Income : CategoryKind.Expense),
            row.CreatedAt);
    }

    private static EntryTypeDb ToDb(EntryType type) => type == EntryType.Income ? EntryTypeDb.INCOME : EntryTypeDb.EXPENSE;
}
