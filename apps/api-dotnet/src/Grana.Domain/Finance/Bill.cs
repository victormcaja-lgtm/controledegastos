using Grana.Domain.Common;

namespace Grana.Domain.Finance;

/// <summary>
/// Conta fixa — modelo recorrente, pago por competência. Por ora só o necessário para
/// a conversão de dívida (RN-108); as baixas e a vigência completas entram no M4.
/// </summary>
public sealed class Bill
{
    private Bill(string id, string userId, CategoryRef category, string name, int amountCents, int dueDay, bool active, MonthRef startMonth, int? totalInstallments)
    {
        Id = id;
        UserId = userId;
        Category = category;
        Name = name;
        AmountCents = amountCents;
        DueDay = dueDay;
        Active = active;
        StartMonth = startMonth;
        TotalInstallments = totalInstallments;
    }

    public string Id { get; }

    public string UserId { get; }

    public CategoryRef Category { get; }

    public string Name { get; }

    public int AmountCents { get; }

    /// <summary>1–31; em meses mais curtos, vence no último dia.</summary>
    public int DueDay { get; }

    public bool Active { get; }

    /// <summary>Competência a partir da qual a conta vigora.</summary>
    public MonthRef StartMonth { get; }

    /// <summary><c>null</c> = recorrente sem fim; senão, quantas parcelas.</summary>
    public int? TotalInstallments { get; }

    public static Bill Restore(
        string id, string userId, CategoryRef category, string name, int amountCents, int dueDay, bool active, MonthRef startMonth, int? totalInstallments) =>
        new(id, userId, category, name, amountCents, dueDay, active, startMonth, totalInstallments);

    /// <summary>A dívida vira conta com prazo: começa no mês atual, com as parcelas que faltam (RN-108).</summary>
    public static Bill FromDebt(string id, Debt debt, Category category, int dueDay, MonthRef currentMonth)
    {
        ArgumentNullException.ThrowIfNull(debt);
        ArgumentNullException.ThrowIfNull(category);
        var installments = debt.InstallmentsToConvert();
        if (category.Kind != CategoryKind.Expense) throw new BusinessRuleError("Contas fixas precisam de uma categoria de despesa.");
        return new(id, debt.UserId, CategoryRef.Of(category), debt.Name, debt.InstallmentCents, dueDay, active: true, currentMonth, installments);
    }

    /// <summary>Número da parcela na competência (<c>billInstallmentNumber</c>); <c>null</c> sem prazo.</summary>
    public int? InstallmentNumber(MonthRef month) =>
        TotalInstallments is null ? null : StartMonth.MonthsUntil(month) + 1;

    /// <summary>Dia de vencimento na competência, limitado ao fim do mês (<c>isoDateFromMonthDay</c>).</summary>
    public DateOnly DueDate(MonthRef month) => month.DayOf(DueDay);
}
