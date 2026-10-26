using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;
using Microsoft.EntityFrameworkCore;

namespace Grana.Infrastructure.Persistence;

/// <summary>Dívidas — <c>PrismaDebtRepository</c>.</summary>
public sealed class EfDebtRepository(GranaDbContext db) : IDebtRepository
{
    public async Task<IReadOnlyList<Debt>> ListAsync(string userId, CancellationToken cancellationToken)
    {
        var rows = await db.Debts.AsNoTracking().Where(d => d.UserId == userId).OrderBy(d => d.CreatedAt)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(ToDomain)];
    }

    public async Task<Debt?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken)
    {
        var row = await db.Debts.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id && d.UserId == userId, cancellationToken).ConfigureAwait(false);
        return row is null ? null : ToDomain(row);
    }

    public async Task AddAsync(Debt debt, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(debt);
        db.Debts.Add(new DebtRow
        {
            Id = debt.Id,
            UserId = debt.UserId,
            Name = debt.Name,
            InstallmentCents = debt.InstallmentCents,
            PaidInstallments = debt.PaidInstallments,
            TotalInstallments = debt.TotalInstallments,
            CreatedAt = nowUtc,
            UpdatedAt = nowUtc,
        });
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdateAsync(Debt debt, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(debt);
        var row = await db.Debts.FirstAsync(d => d.Id == debt.Id && d.UserId == debt.UserId, cancellationToken).ConfigureAwait(false);
        row.Name = debt.Name;
        row.InstallmentCents = debt.InstallmentCents;
        row.PaidInstallments = debt.PaidInstallments;
        row.TotalInstallments = debt.TotalInstallments;
        row.UpdatedAt = nowUtc;
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken) =>
        db.Debts.Where(d => d.Id == id && d.UserId == userId).ExecuteDeleteAsync(cancellationToken);

    private static Debt ToDomain(DebtRow row) =>
        Debt.Restore(row.Id, row.UserId, row.Name, row.InstallmentCents, row.PaidInstallments, row.TotalInstallments);
}

/// <summary>Metas — <c>PrismaGoalRepository</c> (com os 10 últimos depósitos, <c>GOAL_INCLUDE</c>).</summary>
public sealed class EfGoalRepository(GranaDbContext db) : IGoalRepository
{
    private IQueryable<GoalRow> WithStatement() =>
        db.Goals.AsNoTracking().Include(g => g.Deposits.OrderByDescending(d => d.CreatedAt).Take(Goal.StatementSize));

    public async Task<IReadOnlyList<Goal>> ListAsync(string userId, CancellationToken cancellationToken)
    {
        var rows = await WithStatement().Where(g => g.UserId == userId)
            .OrderByDescending(g => g.Featured).ThenBy(g => g.CreatedAt)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(ToDomain)];
    }

    public async Task<Goal?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken)
    {
        var row = await WithStatement().FirstOrDefaultAsync(g => g.Id == id && g.UserId == userId, cancellationToken).ConfigureAwait(false);
        return row is null ? null : ToDomain(row);
    }

    public async Task AddAsync(Goal goal, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(goal);
        db.Goals.Add(new GoalRow
        {
            Id = goal.Id,
            UserId = goal.UserId,
            Name = goal.Name,
            TargetCents = goal.TargetCents,
            SavedCents = goal.SavedCents,
            Featured = goal.Featured,
            CreatedAt = nowUtc,
            UpdatedAt = nowUtc,
        });
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdateAsync(Goal goal, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(goal);
        var row = await db.Goals.FirstAsync(g => g.Id == goal.Id && g.UserId == goal.UserId, cancellationToken).ConfigureAwait(false);
        row.Name = goal.Name;
        row.TargetCents = goal.TargetCents;
        row.SavedCents = goal.SavedCents;
        row.Featured = goal.Featured;
        row.UpdatedAt = nowUtc;
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Os depósitos saem junto, em cascata (FK das migrations).</summary>
    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken) =>
        db.Goals.Where(g => g.Id == id && g.UserId == userId).ExecuteDeleteAsync(cancellationToken);

    public Task ClearFeaturedAsync(string userId, string exceptGoalId, DateTime nowUtc, CancellationToken cancellationToken) =>
        db.Goals.Where(g => g.UserId == userId && g.Featured && g.Id != exceptGoalId)
            .ExecuteUpdateAsync(set => set.SetProperty(g => g.Featured, false).SetProperty(g => g.UpdatedAt, nowUtc), cancellationToken);

    public async Task AddDepositAsync(string userId, string goalId, string depositId, int amountCents, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var transaction = await db.Database.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);
        await using (transaction.ConfigureAwait(false))
        {
            db.GoalDeposits.Add(new GoalDepositRow { Id = depositId, GoalId = goalId, AmountCents = amountCents, CreatedAt = nowUtc });
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            // `increment` do Prisma: a soma é feita pelo banco (estoura o INTEGER lá, como no Node).
            await db.Goals.Where(g => g.Id == goalId && g.UserId == userId)
                .ExecuteUpdateAsync(set => set.SetProperty(g => g.SavedCents, g => g.SavedCents + amountCents).SetProperty(g => g.UpdatedAt, nowUtc), cancellationToken)
                .ConfigureAwait(false);
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    public async Task<IReadOnlyList<(string GoalId, string GoalName, int AmountCents, DateTime CreatedAt)>> DepositsSinceAsync(
        string userId, DateTime since, CancellationToken cancellationToken)
    {
        var rows = await db.GoalDeposits.AsNoTracking()
            .Join(db.Goals, deposit => deposit.GoalId, goal => goal.Id, (deposit, goal) => new { deposit, goal })
            .Where(pair => pair.goal.UserId == userId && pair.deposit.CreatedAt >= since)
            .OrderBy(pair => pair.deposit.CreatedAt)
            .Select(pair => new { pair.deposit.GoalId, pair.goal.Name, pair.deposit.AmountCents, pair.deposit.CreatedAt })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(row => (row.GoalId, row.Name, row.AmountCents, row.CreatedAt))];
    }

    private static Goal ToDomain(GoalRow row) =>
        Goal.Restore(row.Id, row.UserId, row.Name, row.TargetCents, row.SavedCents, row.Featured,
            [.. row.Deposits.Select(deposit => new GoalDeposit(deposit.Id, deposit.AmountCents, deposit.CreatedAt))]);
}
