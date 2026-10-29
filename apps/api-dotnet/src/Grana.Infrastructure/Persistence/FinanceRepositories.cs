using Grana.Application.Finance;
using Grana.Domain.Finance;
using Microsoft.EntityFrameworkCore;

namespace Grana.Infrastructure.Persistence;

/// <summary>
/// Repositórios do M1 — as mesmas consultas de <c>prisma-finance.repositories.ts</c>.
/// Toda consulta filtra por <c>userId</c> (RN-021) e a ORDEM fica no SQL, para sair
/// pela mesma collation do banco (R-06).
/// </summary>
public sealed class EfCategoryRepository(GranaDbContext db) : ICategoryRepository
{
    public async Task<IReadOnlyList<Category>> ListAsync(string userId, bool includeArchived, CancellationToken cancellationToken)
    {
        var query = db.Categories.AsNoTracking().Where(c => c.UserId == userId);
        if (!includeArchived) query = query.Where(c => c.ArchivedAt == null);
        var rows = await query.OrderBy(c => c.Kind).ThenBy(c => c.Name).ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(ToDomain)];
    }

    public async Task<Category?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken)
    {
        var row = await db.Categories.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId, cancellationToken).ConfigureAwait(false);
        return row is null ? null : ToDomain(row);
    }

    public async Task<Category?> FindByNameAsync(string userId, string name, CategoryKind kind, CancellationToken cancellationToken)
    {
        var kindDb = ToDb(kind);
        // ILIKE sem escape, igual ao `mode: 'insensitive'` do Prisma (⚠️ `_` e `%` viram curinga).
        var row = await db.Categories.AsNoTracking()
            .FirstOrDefaultAsync(c => c.UserId == userId && c.Kind == kindDb && EF.Functions.ILike(c.Name, name), cancellationToken)
            .ConfigureAwait(false);
        return row is null ? null : ToDomain(row);
    }

    public Task<int> CountAsync(string userId, CancellationToken cancellationToken) =>
        db.Categories.CountAsync(c => c.UserId == userId, cancellationToken);

    public async Task<int> CountUsagesAsync(string userId, string id, CancellationToken cancellationToken)
    {
        var transactions = await db.Transactions.CountAsync(t => t.UserId == userId && t.CategoryId == id, cancellationToken).ConfigureAwait(false);
        var bills = await db.Bills.CountAsync(b => b.UserId == userId && b.CategoryId == id, cancellationToken).ConfigureAwait(false);
        var purchases = await db.CardPurchases.CountAsync(p => p.UserId == userId && p.CategoryId == id, cancellationToken).ConfigureAwait(false);
        return transactions + bills + purchases;
    }

    public async Task AddAsync(Category category, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(category);
        db.Categories.Add(new CategoryRow
        {
            Id = category.Id,
            UserId = category.UserId,
            Name = category.Name,
            Color = category.Color,
            Kind = ToDb(category.Kind),
            IsSystem = category.IsSystem,
            ArchivedAt = category.ArchivedAt,
            CreatedAt = nowUtc,
            UpdatedAt = nowUtc,
        });
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdateAsync(Category category, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(category);
        var row = await db.Categories
            .FirstAsync(c => c.Id == category.Id && c.UserId == category.UserId, cancellationToken).ConfigureAwait(false);
        row.Name = category.Name;
        row.Color = category.Color;
        row.ArchivedAt = category.ArchivedAt;
        row.UpdatedAt = nowUtc;
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken) =>
        db.Categories.Where(c => c.Id == id && c.UserId == userId).ExecuteDeleteAsync(cancellationToken);

    private static Category ToDomain(CategoryRow row) =>
        Category.Restore(row.Id, row.UserId, row.Name, row.Color, ToDomain(row.Kind), row.IsSystem, row.ArchivedAt);

    private static CategoryKind ToDomain(CategoryKindDb kind) => kind == CategoryKindDb.INCOME ? CategoryKind.Income : CategoryKind.Expense;

    private static CategoryKindDb ToDb(CategoryKind kind) => kind == CategoryKind.Income ? CategoryKindDb.INCOME : CategoryKindDb.EXPENSE;
}

public sealed class EfIncomeRepository(GranaDbContext db) : IIncomeRepository
{
    public async Task<IReadOnlyList<Income>> ListAsync(string userId, CancellationToken cancellationToken)
    {
        var rows = await db.Incomes.AsNoTracking()
            .Where(i => i.UserId == userId)
            .OrderByDescending(i => i.Active).ThenBy(i => i.ReceiptDay)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(ToDomain)];
    }

    public async Task<IReadOnlyList<Income>> ListActiveAsync(string userId, CancellationToken cancellationToken)
    {
        var rows = await db.Incomes.AsNoTracking()
            .Where(i => i.UserId == userId && i.Active)
            .OrderBy(i => i.ReceiptDay)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(ToDomain)];
    }

    public async Task<Income?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken)
    {
        var row = await db.Incomes.AsNoTracking()
            .FirstOrDefaultAsync(i => i.Id == id && i.UserId == userId, cancellationToken).ConfigureAwait(false);
        return row is null ? null : ToDomain(row);
    }

    public async Task AddAsync(Income income, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(income);
        db.Incomes.Add(new IncomeRow
        {
            Id = income.Id,
            UserId = income.UserId,
            Name = income.Name,
            AmountCents = income.AmountCents,
            ReceiptDay = income.ReceiptDay,
            Active = income.Active,
            CreatedAt = nowUtc,
            UpdatedAt = nowUtc,
        });
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdateAsync(Income income, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(income);
        var row = await db.Incomes
            .FirstAsync(i => i.Id == income.Id && i.UserId == income.UserId, cancellationToken).ConfigureAwait(false);
        row.Name = income.Name;
        row.AmountCents = income.AmountCents;
        row.ReceiptDay = income.ReceiptDay;
        row.Active = income.Active;
        row.UpdatedAt = nowUtc;
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken) =>
        db.Incomes.Where(i => i.Id == id && i.UserId == userId).ExecuteDeleteAsync(cancellationToken);

    private static Income ToDomain(IncomeRow row) =>
        Income.Restore(row.Id, row.UserId, row.Name, row.AmountCents, row.ReceiptDay, row.Active);
}

public sealed class EfUserSettingsRepository(GranaDbContext db) : IUserSettingsRepository
{
    public async Task<UserSettings?> FindAsync(string userId, CancellationToken cancellationToken)
    {
        var row = await db.UserSettings.AsNoTracking()
            .FirstOrDefaultAsync(s => s.UserId == userId, cancellationToken).ConfigureAwait(false);
        return row is null
            ? null
            : UserSettings.Restore(
                row.UserId,
                row.OverspendAlerts,
                row.WeeklySummary,
                row.RoundCents,
                row.AutoDarkMode,
                row.ShowDailyAllowance,
                row.OpeningBalanceCents,
                row.OpeningDate,
                row.DailyBudgetCents);
    }

    public async Task SaveAsync(UserSettings settings, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var row = await db.UserSettings.FirstOrDefaultAsync(s => s.UserId == settings.UserId, cancellationToken).ConfigureAwait(false);
        if (row is null)
        {
            row = new UserSettingsRow { UserId = settings.UserId };
            db.UserSettings.Add(row);
        }

        row.OverspendAlerts = settings.OverspendAlerts;
        row.WeeklySummary = settings.WeeklySummary;
        row.RoundCents = settings.RoundCents;
        row.AutoDarkMode = settings.AutoDarkMode;
        row.ShowDailyAllowance = settings.ShowDailyAllowance;
        row.OpeningBalanceCents = settings.OpeningBalanceCents;
        row.OpeningDate = settings.OpeningDate;
        row.DailyBudgetCents = settings.DailyBudgetCents;
        row.UpdatedAt = nowUtc;
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }
}
