using Grana.Domain.Common;

namespace Grana.Domain.Finance;

/// <summary>Um dia da tela "Lista": rótulo, saldo do dia (despesas − entradas) e os lançamentos.</summary>
public sealed record TransactionDay(DateOnly Date, string Label, long TotalCents, IReadOnlyList<Transaction> Items);

/// <summary>
/// <c>groupByDay</c> e o <c>summary</c> da listagem (RN-085, RN-086).
/// </summary>
public static class TransactionGrouping
{
    /// <summary>
    /// Agrupa a PÁGINA por dia, do mais recente ao mais antigo, mantendo a ordem dos
    /// itens dentro do dia. "Hoje" e "Ontem" pela data UTC do servidor; os demais dias,
    /// "05 de março".
    /// </summary>
    public static IReadOnlyList<TransactionDay> GroupByDay(IReadOnlyList<Transaction> items, DateOnly todayUtc)
    {
        ArgumentNullException.ThrowIfNull(items);
        var yesterday = todayUtc.AddDays(-1);
        return [.. items
            .GroupBy(item => item.OccurredOn)
            .OrderByDescending(group => group.Key)
            .Select(group => new TransactionDay(
                group.Key,
                group.Key == todayUtc ? "Hoje" : group.Key == yesterday ? "Ontem" : $"{group.Key.Day:D2} de {MonthRef.Of(group.Key).LongName}",
                group.Sum(item => item.SignedCents),
                [.. group]))];
    }

    /// <summary>
    /// "4 lançamentos · R$ 30,00 em gastos". ⚠️ <paramref name="total"/> conta TODOS os
    /// resultados do filtro, mas o valor soma só as despesas da página (RN-086).
    /// </summary>
    public static string Summary(long total, IReadOnlyList<Transaction> page)
    {
        ArgumentNullException.ThrowIfNull(page);
        var expenses = page.Where(item => item.Type == EntryType.Expense).Sum(item => (long)item.AmountCents);
        return $"{total} lançamento{(total == 1 ? string.Empty : "s")} · {MoneyFormatter.Format(expenses)} em gastos";
    }
}
