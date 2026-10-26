using Grana.Application.Common;
using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Tests.Finance;

/// <summary>debts.usecases.ts e goals.usecases.ts — RN-106–109.</summary>
public class DebtAndGoalUseCasesTests
{
    private static readonly DateTime Now = new(2026, 10, 26, 9, 0, 0, DateTimeKind.Utc);
    private static readonly Actor Ana = new("u1", "ana@grana.app", "USER");

    private readonly InMemoryCategories _categories = new();
    private readonly InMemoryDebts _debts = new();
    private readonly InMemoryGoals _goals = new();
    private readonly InMemoryBills _bills = new();
    private readonly DebtUseCases _debtUseCases;
    private readonly GoalUseCases _goalUseCases;

    public DebtAndGoalUseCasesTests()
    {
        var clock = new FixedClock(Now);
        var ids = new SequentialIds();
        _debtUseCases = new DebtUseCases(_debts, _bills, _categories, clock, ids);
        _goalUseCases = new GoalUseCases(_goals, clock, ids);
        _categories.Items.Add(Category.CreateSystem("casa", "u1", "Casa", "x", CategoryKind.Expense));
        _categories.Items.Add(Category.CreateSystem("salario", "u1", "Salário", "y", CategoryKind.Income));
    }

    [Fact]
    public async Task Dividas_crud_e_visao_geral()
    {
        var created = await _debtUseCases.CreateAsync(Ana, new CreateDebtCommand("Celular", 10000, 12, 10), CancellationToken.None);
        Assert.Equal(new DebtDto("id-1", "Celular", 10000, 10, 12, 2, 20000, 83, false), created);

        var overview = await _debtUseCases.OverviewAsync(Ana, CancellationToken.None);
        Assert.Equal(("2026-10", "out", 10000L), (overview.Projection[0].Month, overview.Projection[0].Label, overview.MonthlyTotalCents));
        Assert.StartsWith("Em dezembro 2026 sobram R$ 100,00", overview.Note, StringComparison.Ordinal);

        var updated = await _debtUseCases.UpdateAsync(Ana, "id-1", new UpdateDebtCommand(default, default, default, Patch.Set(12)), CancellationToken.None);
        Assert.True(updated.Settled);
        await Assert.ThrowsAsync<NotFoundError>(() => _debtUseCases.UpdateAsync(Ana, "nada", new UpdateDebtCommand(Patch.Set("x"), default, default, default), CancellationToken.None));

        await _debtUseCases.DeleteAsync(Ana, "id-1", CancellationToken.None);
        Assert.Equal("Dívida não encontrado.", (await Assert.ThrowsAsync<NotFoundError>(() => _debtUseCases.DeleteAsync(Ana, "id-1", CancellationToken.None))).Message);
    }

    [Fact]
    public async Task Conversao_checa_quitada_categoria_e_tipo_nessa_ordem_e_apaga_a_divida()
    {
        await _debtUseCases.CreateAsync(Ana, new CreateDebtCommand("Quitada", 100, 1, 1), CancellationToken.None);
        await _debtUseCases.CreateAsync(Ana, new CreateDebtCommand("Sofá", 25000, 10, 4), CancellationToken.None);

        await Assert.ThrowsAsync<NotFoundError>(() => _debtUseCases.ConvertAsync(Ana, "nada", "casa", 5, CancellationToken.None));
        Assert.Equal("Esta dívida já está quitada.", (await Assert.ThrowsAsync<BusinessRuleError>(() => _debtUseCases.ConvertAsync(Ana, "id-1", "nada", 5, CancellationToken.None))).Message);
        Assert.Equal("Categoria não encontrado.", (await Assert.ThrowsAsync<NotFoundError>(() => _debtUseCases.ConvertAsync(Ana, "id-2", "nada", 5, CancellationToken.None))).Message);
        await Assert.ThrowsAsync<BusinessRuleError>(() => _debtUseCases.ConvertAsync(Ana, "id-2", "salario", 5, CancellationToken.None));

        var bill = await _debtUseCases.ConvertAsync(Ana, "id-2", "casa", 31, CancellationToken.None);
        Assert.Equal(new BillDto("id-4", "Sofá", 25000, 31, true, new CategoryRefDto("casa", "Casa", "x", "EXPENSE"), false, false, null, new DateOnly(2026, 10, 31), 6, 1), bill);
        Assert.Single(_bills.Items);
        Assert.DoesNotContain(_debts.Items, d => d.Id == "id-2");
    }

    [Fact]
    public async Task Metas_destaque_unico_deposito_e_exclusao()
    {
        var trip = await _goalUseCases.CreateAsync(Ana, new CreateGoalCommand("Viagem", 100000, 0, true), CancellationToken.None);
        Assert.Equal(["id-1"], _goals.ClearedExcept);
        var reserve = await _goalUseCases.CreateAsync(Ana, new CreateGoalCommand("Reserva", 50000, 10000, false), CancellationToken.None);
        Assert.Equal((20, 0), (reserve.ProgressPercent, reserve.Deposits.Count));
        Assert.Single(_goals.ClearedExcept);

        await _goalUseCases.UpdateAsync(Ana, reserve.Id, new UpdateGoalCommand(default, default, default, Patch.Set(true)), CancellationToken.None);
        await _goalUseCases.UpdateAsync(Ana, reserve.Id, new UpdateGoalCommand(Patch.Set("R"), default, default, Patch.Set(false)), CancellationToken.None);
        Assert.Equal(["id-1", "id-2"], _goals.ClearedExcept);

        var deposited = await _goalUseCases.DepositAsync(Ana, trip.Id, 2500, CancellationToken.None);
        Assert.Equal((2500, 97500L, 3), (deposited.SavedCents, deposited.RemainingCents, deposited.ProgressPercent));
        Assert.Equal(["id-3"], deposited.Deposits.Select(d => d.Id));
        Assert.Equal(2, (await _goalUseCases.ListAsync(Ana, CancellationToken.None)).Count);

        Assert.Equal("Meta não encontrado.", (await Assert.ThrowsAsync<NotFoundError>(() => _goalUseCases.DepositAsync(Ana, "nada", 1, CancellationToken.None))).Message);
        await Assert.ThrowsAsync<NotFoundError>(() => _goalUseCases.UpdateAsync(Ana, "nada", new UpdateGoalCommand(Patch.Set("x"), default, default, default), CancellationToken.None));
        await _goalUseCases.DeleteAsync(Ana, trip.Id, CancellationToken.None);
        await Assert.ThrowsAsync<NotFoundError>(() => _goalUseCases.DeleteAsync(Ana, trip.Id, CancellationToken.None));
    }
}

internal sealed class InMemoryDebts : IDebtRepository
{
    public List<Debt> Items { get; } = [];

    public Task<IReadOnlyList<Debt>> ListAsync(string userId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Debt>>([.. Items.Where(d => d.UserId == userId)]);

    public Task<Debt?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken) =>
        Task.FromResult(Items.FirstOrDefault(d => d.UserId == userId && d.Id == id));

    public Task AddAsync(Debt debt, DateTime nowUtc, CancellationToken cancellationToken)
    {
        Items.Add(debt);
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Debt debt, DateTime nowUtc, CancellationToken cancellationToken) => Task.CompletedTask;

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken)
    {
        Items.RemoveAll(d => d.UserId == userId && d.Id == id);
        return Task.CompletedTask;
    }
}

internal sealed class InMemoryGoals : IGoalRepository
{
    private readonly Dictionary<string, (Goal Goal, List<GoalDeposit> Deposits)> _rows = [];

    public List<string> ClearedExcept { get; } = [];

    public Task<IReadOnlyList<Goal>> ListAsync(string userId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Goal>>([.. _rows.Values.Where(r => r.Goal.UserId == userId).Select(Snapshot)]);

    public Task<Goal?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken) =>
        Task.FromResult(_rows.TryGetValue(id, out var row) && row.Goal.UserId == userId ? Snapshot(row) : null);

    public Task AddAsync(Goal goal, DateTime nowUtc, CancellationToken cancellationToken)
    {
        _rows[goal.Id] = (goal, []);
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Goal goal, DateTime nowUtc, CancellationToken cancellationToken)
    {
        _rows[goal.Id] = (goal, _rows[goal.Id].Deposits);
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken)
    {
        _rows.Remove(id);
        return Task.CompletedTask;
    }

    public Task ClearFeaturedAsync(string userId, string exceptGoalId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ClearedExcept.Add(exceptGoalId);
        return Task.CompletedTask;
    }

    public Task AddDepositAsync(string userId, string goalId, string depositId, int amountCents, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var (goal, deposits) = _rows[goalId];
        deposits.Insert(0, new GoalDeposit(depositId, amountCents, nowUtc));
        goal.Update(default, default, Patch.Set(goal.SavedCents + amountCents), default);
        return Task.CompletedTask;
    }

    private static Goal Snapshot((Goal Goal, List<GoalDeposit> Deposits) row) =>
        Goal.Restore(row.Goal.Id, row.Goal.UserId, row.Goal.Name, row.Goal.TargetCents, row.Goal.SavedCents, row.Goal.Featured, [.. row.Deposits]);
}

internal sealed class InMemoryBills : IBillRepository
{
    public List<Bill> Items { get; } = [];

    public Task AddAsync(Bill bill, DateTime nowUtc, CancellationToken cancellationToken)
    {
        Items.Add(bill);
        return Task.CompletedTask;
    }
}
