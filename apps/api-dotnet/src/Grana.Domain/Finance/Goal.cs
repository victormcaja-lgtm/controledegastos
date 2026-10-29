using Grana.Domain.Common;

namespace Grana.Domain.Finance;

public sealed record GoalDeposit(string Id, int AmountCents, DateTime CreatedAt);

/// <summary>
/// Meta de economia — RN-109. O valor guardado inicial ou editado à mão NÃO gera
/// depósito; depósito é outra operação, que incrementa o guardado no banco.
/// </summary>
public sealed class Goal
{
    /// <summary>Quantos depósitos o extrato traz (os mais recentes primeiro).</summary>
    public const int StatementSize = 10;

    private Goal(string id, string userId, string name, int targetCents, int savedCents, bool featured, IReadOnlyList<GoalDeposit> deposits)
    {
        Id = id;
        UserId = userId;
        Name = name;
        TargetCents = targetCents;
        SavedCents = savedCents;
        Featured = featured;
        Deposits = deposits;
    }

    public string Id { get; }

    public string UserId { get; }

    public string Name { get; private set; }

    public int TargetCents { get; private set; }

    public int SavedCents { get; private set; }

    /// <summary>Só uma meta fica em destaque; o repositório tira das outras (RN-109).</summary>
    public bool Featured { get; private set; }

    /// <summary>Os <see cref="StatementSize"/> depósitos mais recentes, do mais novo ao mais antigo.</summary>
    public IReadOnlyList<GoalDeposit> Deposits { get; }

    public long RemainingCents => Math.Max(0L, (long)TargetCents - SavedCents);

    public int ProgressPercent => JsMath.PercentOf(SavedCents, TargetCents);

    public bool Achieved => RemainingCents == 0;

    public static Goal Restore(string id, string userId, string name, int targetCents, int savedCents, bool featured, IReadOnlyList<GoalDeposit> deposits) =>
        new(id, userId, name, targetCents, savedCents, featured, deposits);

    public static Goal Create(string id, string userId, string name, int targetCents, int savedCents, bool featured) =>
        new(id, userId, name, targetCents, savedCents, featured, []);

    public void Update(Patch<string> name, Patch<int> targetCents, Patch<int> savedCents, Patch<bool> featured)
    {
        Name = name.Or(Name);
        TargetCents = targetCents.Or(TargetCents);
        SavedCents = savedCents.Or(SavedCents);
        Featured = featured.Or(Featured);
    }
}
