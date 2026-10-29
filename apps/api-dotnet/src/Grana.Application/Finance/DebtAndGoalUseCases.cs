using Grana.Application.Common;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Finance;

public interface IDebtRepository
{
    /// <summary>Ordem <c>createdAt asc</c> (RN-106).</summary>
    Task<IReadOnlyList<Debt>> ListAsync(string userId, CancellationToken cancellationToken);

    Task<Debt?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken);

    Task AddAsync(Debt debt, DateTime nowUtc, CancellationToken cancellationToken);

    Task UpdateAsync(Debt debt, DateTime nowUtc, CancellationToken cancellationToken);

    Task DeleteAsync(string userId, string id, CancellationToken cancellationToken);
}

public interface IGoalRepository
{
    /// <summary>Ordem <c>featured desc, createdAt asc</c>, com os 10 últimos depósitos de cada meta (RN-109).</summary>
    Task<IReadOnlyList<Goal>> ListAsync(string userId, CancellationToken cancellationToken);

    Task<Goal?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken);

    Task AddAsync(Goal goal, DateTime nowUtc, CancellationToken cancellationToken);

    Task UpdateAsync(Goal goal, DateTime nowUtc, CancellationToken cancellationToken);

    Task DeleteAsync(string userId, string id, CancellationToken cancellationToken);

    /// <summary>Tira o destaque das outras metas do usuário.</summary>
    Task ClearFeaturedAsync(string userId, string exceptGoalId, DateTime nowUtc, CancellationToken cancellationToken);

    /// <summary>Grava o depósito e incrementa o guardado NO BANCO, numa transação só.</summary>
    Task AddDepositAsync(string userId, string goalId, string depositId, int amountCents, DateTime nowUtc, CancellationToken cancellationToken);

    /// <summary>Depósitos de todas as metas com <c>createdAt ≥ since</c>, na ordem de criação, com o nome da meta.</summary>
    Task<IReadOnlyList<(string GoalId, string GoalName, int AmountCents, DateTime CreatedAt)>> DepositsSinceAsync(
        string userId, DateTime since, CancellationToken cancellationToken);
}

public sealed record DebtDto(
    string Id, string Name, int InstallmentCents, int PaidInstallments, int TotalInstallments,
    int RemainingInstallments, long RemainingCents, int ProgressPercent, bool Settled)
{
    public static DebtDto From(Debt debt)
    {
        ArgumentNullException.ThrowIfNull(debt);
        return new(debt.Id, debt.Name, debt.InstallmentCents, debt.PaidInstallments, debt.TotalInstallments,
            debt.RemainingInstallments, debt.RemainingCents, debt.ProgressPercent, debt.Settled);
    }
}

public sealed record DebtProjectionDto(string Month, string Label, long TotalCents);

public sealed record DebtOverviewDto(IReadOnlyList<DebtDto> Debts, long MonthlyTotalCents, IReadOnlyList<DebtProjectionDto> Projection, string Note);

public sealed record GoalDepositDto(string Id, int AmountCents, DateTime CreatedAt);

public sealed record GoalDto(
    string Id, string Name, int TargetCents, int SavedCents, long RemainingCents, int ProgressPercent, bool Achieved, bool Featured,
    IReadOnlyList<GoalDepositDto> Deposits)
{
    public static GoalDto From(Goal goal)
    {
        ArgumentNullException.ThrowIfNull(goal);
        return new(goal.Id, goal.Name, goal.TargetCents, goal.SavedCents, goal.RemainingCents, goal.ProgressPercent, goal.Achieved, goal.Featured,
            [.. goal.Deposits.Select(deposit => new GoalDepositDto(deposit.Id, deposit.AmountCents, deposit.CreatedAt))]);
    }
}

public sealed record CreateDebtCommand(string Name, int InstallmentCents, int TotalInstallments, int PaidInstallments);

public sealed record UpdateDebtCommand(Patch<string> Name, Patch<int> InstallmentCents, Patch<int> TotalInstallments, Patch<int> PaidInstallments);

public sealed record CreateGoalCommand(string Name, int TargetCents, int SavedCents, bool Featured);

public sealed record UpdateGoalCommand(Patch<string> Name, Patch<int> TargetCents, Patch<int> SavedCents, Patch<bool> Featured);

/// <summary>Dívidas — <c>debts.usecases.ts</c> (RN-106–108).</summary>
public sealed class DebtUseCases(IDebtRepository debts, IBillRepository bills, ICategoryRepository categories, IClock clock, IIdGenerator ids)
{
    public async Task<DebtOverviewDto> OverviewAsync(Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var records = await debts.ListAsync(actor.UserId, cancellationToken).ConfigureAwait(false);
        var projection = DebtProjector.Project(records, MonthRef.Of(DateOnly.FromDateTime(clock.UtcNow)));
        return new DebtOverviewDto(
            [.. records.Select(DebtDto.From)],
            projection.MonthlyTotalCents,
            [.. projection.Months.Select(month => new DebtProjectionDto(month.Month.Value, month.Label, month.TotalCents))],
            projection.Note);
    }

    public async Task<DebtDto> CreateAsync(Actor actor, CreateDebtCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var debt = Debt.Create(ids.NewId(), actor.UserId, command.Name, command.InstallmentCents, command.PaidInstallments, command.TotalInstallments);
        await debts.AddAsync(debt, clock.UtcNow, cancellationToken).ConfigureAwait(false);
        return DebtDto.From(debt);
    }

    public async Task<DebtDto> UpdateAsync(Actor actor, string id, UpdateDebtCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var debt = await debts.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Dívida");
        debt.Update(command.Name, command.InstallmentCents, command.PaidInstallments, command.TotalInstallments);
        await debts.UpdateAsync(debt, clock.UtcNow, cancellationToken).ConfigureAwait(false);
        return DebtDto.From(debt);
    }

    public async Task DeleteAsync(Actor actor, string id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        _ = await debts.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Dívida");
        await debts.DeleteAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Dívida → conta fixa com o que falta (RN-108): quitada (422), categoria (404), tipo
    /// de despesa (422), nessa ordem. Cria a conta e DEPOIS apaga a dívida — dois passos
    /// sem transação, como no Node.
    /// </summary>
    public async Task<BillDto> ConvertAsync(Actor actor, string id, string categoryId, int dueDay, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var debt = await debts.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Dívida");
        _ = debt.InstallmentsToConvert();
        var category = await categories.FindByIdAsync(actor.UserId, categoryId, cancellationToken).ConfigureAwait(false)
            ?? throw new NotFoundError("Categoria");

        var now = clock.UtcNow;
        var month = MonthRef.Of(DateOnly.FromDateTime(now));
        var bill = Bill.FromDebt(ids.NewId(), debt, category, dueDay, month);
        await bills.AddAsync(bill, now, cancellationToken).ConfigureAwait(false);
        await debts.DeleteAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false);
        return BillDto.Unpaid(bill, month);
    }
}

/// <summary>Metas — <c>goals.usecases.ts</c> (RN-109).</summary>
public sealed class GoalUseCases(IGoalRepository goals, IClock clock, IIdGenerator ids)
{
    public async Task<IReadOnlyList<GoalDto>> ListAsync(Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        return [.. (await goals.ListAsync(actor.UserId, cancellationToken).ConfigureAwait(false)).Select(GoalDto.From)];
    }

    /// <summary>Criada em destaque, tira o destaque das outras.</summary>
    public async Task<GoalDto> CreateAsync(Actor actor, CreateGoalCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var now = clock.UtcNow;
        var goal = Goal.Create(ids.NewId(), actor.UserId, command.Name, command.TargetCents, command.SavedCents, command.Featured);
        await goals.AddAsync(goal, now, cancellationToken).ConfigureAwait(false);
        if (goal.Featured) await goals.ClearFeaturedAsync(actor.UserId, goal.Id, now, cancellationToken).ConfigureAwait(false);
        return GoalDto.From(goal);
    }

    /// <summary><c>featured: true</c> tira o destaque das outras; <c>false</c> pode deixar nenhuma em destaque.</summary>
    public async Task<GoalDto> UpdateAsync(Actor actor, string id, UpdateGoalCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var goal = await goals.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Meta");
        var now = clock.UtcNow;
        goal.Update(command.Name, command.TargetCents, command.SavedCents, command.Featured);
        await goals.UpdateAsync(goal, now, cancellationToken).ConfigureAwait(false);
        if (command.Featured is { IsSet: true, Value: true }) await goals.ClearFeaturedAsync(actor.UserId, id, now, cancellationToken).ConfigureAwait(false);
        return GoalDto.From(goal);
    }

    public async Task DeleteAsync(Actor actor, string id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        _ = await goals.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Meta");
        await goals.DeleteAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Depósito → 200 com a meta relida (guardado e extrato atualizados).</summary>
    public async Task<GoalDto> DepositAsync(Actor actor, string id, int amountCents, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        _ = await goals.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Meta");
        await goals.AddDepositAsync(actor.UserId, id, ids.NewId(), amountCents, clock.UtcNow, cancellationToken).ConfigureAwait(false);
        var updated = await goals.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Meta");
        return GoalDto.From(updated);
    }
}
