using Grana.Domain.Common;

namespace Grana.Domain.Finance;

public sealed record CategoryReportItem(string CategoryId, string Name, string Color, long TotalCents, int Percent, int RelativeWidth);

public sealed record CategoryReport(MonthRef Month, string MonthLabel, long TotalCents, IReadOnlyList<CategoryReportItem> Items, string Comparison);

/// <summary>
/// Relatório por categoria — <c>GetCategoryReportUseCase</c> e <c>buildComparison</c>
/// (RN-115–117). Função pura sobre o que o caso de uso carregou.
/// </summary>
public static class CategoryReportBuilder
{
    /// <summary>
    /// Despesas do mês, TODAS as contas em vigor (inclusive dispensadas, ⚠️ RN-116) e as
    /// parcelas de cartão que VENCEM no mês (todos os cartões). Agrupa por id de categoria,
    /// do maior total ao menor; empates na ordem de inserção: lançamentos, contas, cartão.
    /// </summary>
    public static CategoryReport Build(
        MonthRef month,
        IReadOnlyList<Transaction> monthTransactions,
        IReadOnlyList<Transaction> previousTransactions,
        IReadOnlyList<Bill> billsInEffect,
        IReadOnlyList<Card> cards,
        IReadOnlyList<CardPurchase> purchases)
    {
        ArgumentNullException.ThrowIfNull(monthTransactions);
        ArgumentNullException.ThrowIfNull(billsInEffect);
        ArgumentNullException.ThrowIfNull(cards);
        ArgumentNullException.ThrowIfNull(purchases);

        var order = new List<string>();
        var totals = new Dictionary<string, (string Name, string Color, long Total)>(StringComparer.Ordinal);
        void Add(CategoryRef category, long amount)
        {
            if (totals.TryGetValue(category.Id, out var entry))
            {
                totals[category.Id] = entry with { Total = entry.Total + amount };
                return;
            }

            order.Add(category.Id);
            totals[category.Id] = (category.Name, category.Color, amount);
        }

        foreach (var transaction in monthTransactions.Where(t => t.Type == EntryType.Expense)) Add(transaction.Category, transaction.AmountCents);
        foreach (var bill in billsInEffect) Add(bill.Category, bill.AmountCents);

        // Compra no cartão entra pelo mês em que a parcela VENCE (quando o dinheiro sai).
        var cardById = cards.ToDictionary(card => card.Id, StringComparer.Ordinal);
        foreach (var purchase in purchases)
        {
            if (!cardById.TryGetValue(purchase.CardId, out var card)) continue;
            foreach (var installment in CardInvoiceCalculator.InstallmentsOf(card, purchase))
            {
                if (MonthRef.Of(installment.DueDate) == month) Add(purchase.Category, installment.AmountCents);
            }
        }

        var sorted = order.Select(id => (Id: id, Entry: totals[id])).OrderByDescending(item => item.Entry.Total).ToList();
        var grandTotal = sorted.Sum(item => item.Entry.Total);
        var largest = sorted.Count > 0 ? sorted[0].Entry.Total : 1;
        return new CategoryReport(
            month,
            month.Label,
            grandTotal,
            [.. sorted.Select(item => new CategoryReportItem(
                item.Id, item.Entry.Name, item.Entry.Color, item.Entry.Total,
                JsMath.PercentOf(item.Entry.Total, Math.Max(grandTotal, 1)),
                Math.Max(3, JsMath.PercentOf(item.Entry.Total, largest))))],
            Comparison(monthTransactions, previousTransactions));
    }

    /// <summary>
    /// "Mês anterior" como o Node o monta: o ano sai SEM zeros à esquerda, então antes do
    /// ano 1000 a competência é inválida e a consulta do Node quebra (500).
    /// </summary>
    public static MonthRef PreviousMonth(MonthRef month)
    {
        var previous = month.AddMonths(-1);
        return previous.Year >= 1000
            ? previous
            : throw new InvalidOperationException($"Competência inválida: \"{previous.Year}-{previous.Month:D2}\". Formato esperado: YYYY-MM.");
    }

    /// <summary>
    /// A diferença mais relevante entre os dois meses, só com LANÇAMENTOS, agrupados por
    /// NOME de categoria (RN-117). Empates: o primeiro na ordem de inserção.
    /// </summary>
    public static string Comparison(IReadOnlyList<Transaction> current, IReadOnlyList<Transaction> previous)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(previous);
        var currentTotals = SumByCategoryName(current);
        var previousTotals = SumByCategoryName(previous);
        if (previousTotals.Count == 0) return "Ainda não há mês anterior suficiente para comparar.";

        var deltas = currentTotals.Select(pair => pair.Key)
            .Concat(previousTotals.Select(pair => pair.Key))
            .Distinct(StringComparer.Ordinal)
            .Select(name => (Name: name, Delta: Lookup(currentTotals, name) - Lookup(previousTotals, name)))
            .ToList();
        var worst = deltas.Aggregate((a, b) => b.Delta > a.Delta ? b : a);
        var best = deltas.Aggregate((a, b) => b.Delta < a.Delta ? b : a);

        if (worst.Delta <= 0 && best.Delta >= 0) return "Seus gastos ficaram estáveis em relação ao mês passado.";
        if (best.Delta < 0 && worst.Delta > 0)
        {
            return $"Você gastou {MoneyFormatter.Format(Math.Abs(best.Delta))} a menos em {best.Name.ToLowerInvariant()}, mas {MoneyFormatter.Format(worst.Delta)} a mais em {worst.Name.ToLowerInvariant()}.";
        }

        return worst.Delta > 0
            ? $"O maior aumento veio de {worst.Name.ToLowerInvariant()}: {MoneyFormatter.Format(worst.Delta)} a mais que no mês passado."
            : $"Você economizou {MoneyFormatter.Format(Math.Abs(best.Delta))} em {best.Name.ToLowerInvariant()} em relação ao mês passado.";
    }

    private static List<KeyValuePair<string, long>> SumByCategoryName(IReadOnlyList<Transaction> items)
    {
        var order = new List<string>();
        var sums = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var item in items.Where(t => t.Type == EntryType.Expense))
        {
            if (!sums.ContainsKey(item.Category.Name)) order.Add(item.Category.Name);
            sums[item.Category.Name] = sums.GetValueOrDefault(item.Category.Name) + item.AmountCents;
        }

        return [.. order.Select(name => new KeyValuePair<string, long>(name, sums[name]))];
    }

    private static long Lookup(List<KeyValuePair<string, long>> sums, string name) =>
        sums.FirstOrDefault(pair => pair.Key == name).Value;
}
