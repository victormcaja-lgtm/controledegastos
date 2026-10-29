using Grana.Domain.Common;

namespace Grana.Domain.Finance;

/// <summary>Dívida parcelada — RN-106. Não entra no resumo nem no saldo futuro (RN-107).</summary>
public sealed class Debt
{
    private Debt(string id, string userId, string name, int installmentCents, int paidInstallments, int totalInstallments)
    {
        Id = id;
        UserId = userId;
        Name = name;
        InstallmentCents = installmentCents;
        PaidInstallments = paidInstallments;
        TotalInstallments = totalInstallments;
    }

    public string Id { get; }

    public string UserId { get; }

    public string Name { get; private set; }

    public int InstallmentCents { get; private set; }

    public int PaidInstallments { get; private set; }

    public int TotalInstallments { get; private set; }

    public int RemainingInstallments => Math.Max(0, TotalInstallments - PaidInstallments);

    public long RemainingCents => (long)RemainingInstallments * InstallmentCents;

    public int ProgressPercent => JsMath.PercentOf(PaidInstallments, TotalInstallments);

    public bool Settled => RemainingInstallments == 0;

    public static Debt Restore(string id, string userId, string name, int installmentCents, int paidInstallments, int totalInstallments) =>
        new(id, userId, name, installmentCents, paidInstallments, totalInstallments);

    /// <summary>Pagas ≤ total já foi checado pelo contrato (400 na criação).</summary>
    public static Debt Create(string id, string userId, string name, int installmentCents, int paidInstallments, int totalInstallments) =>
        new(id, userId, name, installmentCents, paidInstallments, totalInstallments);

    /// <summary>Na edição, pagas acima do total (já com os valores novos) → 422 (RN-106).</summary>
    public void Update(Patch<string> name, Patch<int> installmentCents, Patch<int> paidInstallments, Patch<int> totalInstallments)
    {
        var paid = paidInstallments.Or(PaidInstallments);
        var total = totalInstallments.Or(TotalInstallments);
        if (paid > total) throw new BusinessRuleError("As parcelas pagas não podem passar do total de parcelas.");

        Name = name.Or(Name);
        InstallmentCents = installmentCents.Or(InstallmentCents);
        PaidInstallments = paid;
        TotalInstallments = total;
    }

    /// <summary>Parcelas que viram a conta fixa na conversão (RN-108); quitada → 422.</summary>
    public int InstallmentsToConvert() =>
        TotalInstallments - PaidInstallments > 0
            ? TotalInstallments - PaidInstallments
            : throw new BusinessRuleError("Esta dívida já está quitada.");
}

public sealed record DebtProjectionMonth(MonthRef Month, string Label, long TotalCents);

public sealed record DebtProjection(IReadOnlyList<DebtProjectionMonth> Months, string Note, long MonthlyTotalCents);

/// <summary><c>projectDebts</c> (RN-107): 6 meses a partir do mês atual e o mês em que uma parcela acaba.</summary>
public static class DebtProjector
{
    public static DebtProjection Project(IReadOnlyList<Debt> debts, MonthRef fromMonth, int horizon = 6)
    {
        ArgumentNullException.ThrowIfNull(debts);
        var months = Enumerable.Range(0, horizon)
            .Select(offset =>
            {
                var month = fromMonth.AddMonths(offset);
                var total = debts.Sum(debt => debt.TotalInstallments - debt.PaidInstallments > offset ? (long)debt.InstallmentCents : 0);
                return new DebtProjectionMonth(month, month.ShortName, total);
            })
            .ToList();

        var first = months.Count > 0 ? months[0].TotalCents : 0;
        var freeIndex = months.FindIndex(entry => entry.TotalCents < first);
        var note = freeIndex > 0
            ? $"Em {months[freeIndex].Month.Label.ToLowerInvariant()} sobram {MoneyFormatter.Format(first - months[freeIndex].TotalCents)} a mais no seu bolso: uma parcela acaba."
            : first == 0
                ? "Você não tem parcelas em aberto. 👏"
                : "As parcelas seguem iguais nos próximos meses.";
        return new DebtProjection(months, note, first);
    }
}
