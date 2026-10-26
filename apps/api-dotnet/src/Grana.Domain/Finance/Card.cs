using Grana.Domain.Common;

namespace Grana.Domain.Finance;

/// <summary>
/// Cartão de crédito — RN-130. A fatura não é tabela: é calculada das compras
/// (<see cref="CardInvoiceCalculator"/>). <c>Active</c> é só informativo.
/// </summary>
public sealed class Card
{
    private Card(string id, string userId, string name, int closingDay, int dueDay, int? limitCents, bool active)
    {
        Id = id;
        UserId = userId;
        Name = name;
        ClosingDay = closingDay;
        DueDay = dueDay;
        LimitCents = limitCents;
        Active = active;
    }

    public string Id { get; }

    public string UserId { get; }

    public string Name { get; private set; }

    public int ClosingDay { get; private set; }

    public int DueDay { get; private set; }

    public int? LimitCents { get; private set; }

    public bool Active { get; private set; }

    public static Card Restore(string id, string userId, string name, int closingDay, int dueDay, int? limitCents, bool active) =>
        new(id, userId, name, closingDay, dueDay, limitCents, active);

    public static Card Create(string id, string userId, string name, int closingDay, int dueDay, int? limitCents) =>
        new(id, userId, name, closingDay, dueDay, limitCents, active: true);

    public void Update(Patch<string> name, Patch<int> closingDay, Patch<int> dueDay, Patch<int?> limitCents, Patch<bool> active)
    {
        Name = name.Or(Name);
        ClosingDay = closingDay.Or(ClosingDay);
        DueDay = dueDay.Or(DueDay);
        LimitCents = limitCents.Or(LimitCents);
        Active = active.Or(Active);
    }
}

/// <summary>
/// Compra no cartão — RN-133. <c>AmountCents</c> é o TOTAL; as parcelas são calculadas.
/// Categoria de despesa (arquivada é aceita); sem checagem de limite.
/// </summary>
public sealed class CardPurchase
{
    private CardPurchase(
        string id, string userId, string cardId, CategoryRef category, int amountCents, int installments, DateOnly purchasedOn, string? note, DateTime createdAt)
    {
        Id = id;
        UserId = userId;
        CardId = cardId;
        Category = category;
        AmountCents = amountCents;
        Installments = installments;
        PurchasedOn = purchasedOn;
        Note = note;
        CreatedAt = createdAt;
    }

    public string Id { get; }

    public string UserId { get; }

    public string CardId { get; }

    public CategoryRef Category { get; }

    public int AmountCents { get; }

    /// <summary>1–48.</summary>
    public int Installments { get; }

    public DateOnly PurchasedOn { get; }

    /// <summary>Vazia depois do trim vira <c>null</c> — ao contrário do lançamento (RN-081).</summary>
    public string? Note { get; }

    public DateTime CreatedAt { get; }

    /// <summary>Rótulo na fatura: a observação ou, sem ela, o nome da categoria (RN-136).</summary>
    public string Label => Note ?? Category.Name;

    public static CardPurchase Restore(
        string id, string userId, string cardId, CategoryRef category, int amountCents, int installments, DateOnly purchasedOn, string? note, DateTime createdAt) =>
        new(id, userId, cardId, category, amountCents, installments, purchasedOn, note, createdAt);

    public static CardPurchase Create(
        string id, Card card, Category category, int amountCents, int installments, DateOnly purchasedOn, string? note, DateTime createdAt)
    {
        ArgumentNullException.ThrowIfNull(card);
        ArgumentNullException.ThrowIfNull(category);
        if (category.Kind != CategoryKind.Expense) throw new BusinessRuleError("Compra no cartão precisa de uma categoria de despesa.");
        return new(id, card.UserId, card.Id, CategoryRef.Of(category), amountCents, installments, purchasedOn,
            string.IsNullOrEmpty(note) ? null : note, createdAt);
    }
}

public enum InvoiceStatus
{
    Open,
    Closed,
    Future,
    Past,
}

/// <summary>Uma parcela de compra numa fatura (a competência é o mês de fechamento).</summary>
public sealed record CardInstallment(
    string PurchaseId, int Number, int Installments, long AmountCents, MonthRef Month, DateOnly ClosingDate, DateOnly DueDate);

public sealed record CardInvoice(
    MonthRef Month, DateOnly ClosingDate, DateOnly DueDate, long TotalCents, InvoiceStatus Status, IReadOnlyList<CardInstallment> Items);

/// <summary>
/// Faturas — <c>card.calculator.ts</c> (RN-131–135). As datas são comparadas como TEXTO
/// <c>AAAA-MM-DD</c>, como no Node: o <c>today</c> vindo da query é usado do jeito que chegou.
/// </summary>
public static class CardInvoiceCalculator
{
    public static DateOnly ClosingDate(Card card, MonthRef month)
    {
        ArgumentNullException.ThrowIfNull(card);
        return month.DayOf(card.ClosingDay);
    }

    /// <summary>No mesmo mês se o vencimento é depois do fechamento; senão no seguinte.</summary>
    public static DateOnly DueDate(Card card, MonthRef month)
    {
        ArgumentNullException.ThrowIfNull(card);
        return (card.DueDay > card.ClosingDay ? month : month.AddMonths(1)).DayOf(card.DueDay);
    }

    /// <summary>Compra ANTES do fechamento do mês → fatura do mês; no dia ou depois → a seguinte (RN-131).</summary>
    public static MonthRef InvoiceMonthFor(Card card, string isoDate)
    {
        ArgumentNullException.ThrowIfNull(isoDate);
        var month = MonthRef.Parse(isoDate[..7]);
        return Before(isoDate, ClosingDate(card, month)) ? month : month.AddMonths(1);
    }

    /// <summary>A fatura aberta: a que receberia uma compra feita hoje.</summary>
    public static MonthRef OpenInvoiceMonth(Card card, string today) => InvoiceMonthFor(card, today);

    /// <summary><c>⌊total / n⌋</c> e o resto inteiro na primeira parcela (RN-132).</summary>
    public static IReadOnlyList<long> SplitInstallments(long amountCents, int installments)
    {
        var count = Math.Max(1, installments);
        var baseAmount = (long)Math.Floor(amountCents / (double)count);
        var remainder = amountCents - (baseAmount * count);
        return [.. Enumerable.Range(0, count).Select(index => baseAmount + (index == 0 ? remainder : 0))];
    }

    public static IReadOnlyList<CardInstallment> InstallmentsOf(Card card, CardPurchase purchase)
    {
        ArgumentNullException.ThrowIfNull(purchase);
        return InstallmentsOf(card, purchase.Id, purchase.AmountCents, purchase.Installments, purchase.PurchasedOn.ToIso());
    }

    /// <summary>Parcelas de uma compra com a data como TEXTO — a simulação usa a data como chegou.</summary>
    public static IReadOnlyList<CardInstallment> InstallmentsOf(Card card, string purchaseId, long amountCents, int installments, string purchasedOn)
    {
        var first = InvoiceMonthFor(card, purchasedOn);
        return [.. SplitInstallments(amountCents, installments).Select((amount, index) =>
        {
            var month = first.AddMonths(index);
            return new CardInstallment(purchaseId, index + 1, installments, amount, month, ClosingDate(card, month), DueDate(card, month));
        })];
    }

    /// <summary>PAST, CLOSED, OPEN ou FUTURE, nessa ordem de checagem (RN-134).</summary>
    public static InvoiceStatus StatusOf(Card card, MonthRef month, string today)
    {
        if (Before(DueDate(card, month), today)) return InvoiceStatus.Past;
        if (!After(ClosingDate(card, month), today)) return InvoiceStatus.Closed;
        return month == InvoiceMonthFor(card, today) ? InvoiceStatus.Open : InvoiceStatus.Future;
    }

    /// <summary>Todas as faturas com pelo menos uma parcela, em ordem cronológica; itens na ordem das compras.</summary>
    public static IReadOnlyList<CardInvoice> BuildInvoices(Card card, IReadOnlyList<CardPurchase> purchases, string today)
    {
        ArgumentNullException.ThrowIfNull(purchases);
        return [.. purchases
            .SelectMany(purchase => InstallmentsOf(card, purchase))
            .GroupBy(installment => installment.Month)
            .OrderBy(group => group.Key)
            .Select(group => new CardInvoice(
                group.Key, ClosingDate(card, group.Key), DueDate(card, group.Key), group.Sum(item => item.AmountCents), StatusOf(card, group.Key, today), [.. group]))];
    }

    /// <summary>Uma fatura específica — vazia, com o status calculado, se não houver parcela no mês.</summary>
    public static CardInvoice InvoiceFor(Card card, IReadOnlyList<CardPurchase> purchases, MonthRef month, string today) =>
        BuildInvoices(card, purchases, today).FirstOrDefault(invoice => invoice.Month == month)
        ?? new CardInvoice(month, ClosingDate(card, month), DueDate(card, month), 0, StatusOf(card, month, today), []);

    /// <summary>
    /// Para a listagem (RN-135): faturas não PAST com parcelas, mais a aberta (vazia, se
    /// preciso), em ordem cronológica, até 4; e o limite usado = parcelas que vencem hoje ou depois.
    /// </summary>
    public static (IReadOnlyList<CardInvoice> Invoices, long UsedLimitCents) Summary(Card card, IReadOnlyList<CardPurchase> purchases, string today)
    {
        ArgumentNullException.ThrowIfNull(purchases);
        var upcoming = BuildInvoices(card, purchases, today).Where(invoice => invoice.Status != InvoiceStatus.Past).ToList();
        var open = OpenInvoiceMonth(card, today);
        if (!upcoming.Exists(invoice => invoice.Month == open))
        {
            upcoming.Add(InvoiceFor(card, [], open, today));
            upcoming = [.. upcoming.OrderBy(invoice => invoice.Month)];
        }

        var used = purchases
            .SelectMany(purchase => InstallmentsOf(card, purchase))
            .Where(installment => !Before(installment.DueDate, today))
            .Sum(installment => installment.AmountCents);
        return ([.. upcoming.Take(4)], used);
    }

    private static bool Before(string isoDate, DateOnly other) => string.CompareOrdinal(isoDate, other.ToIso()) < 0;

    private static bool Before(DateOnly date, string isoDate) => string.CompareOrdinal(date.ToIso(), isoDate) < 0;

    private static bool After(DateOnly date, string isoDate) => string.CompareOrdinal(date.ToIso(), isoDate) > 0;
}
