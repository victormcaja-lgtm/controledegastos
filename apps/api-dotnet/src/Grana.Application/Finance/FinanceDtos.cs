using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Finance;

/// <summary>
/// Respostas da API, na ordem de campos dos schemas de resposta do Node
/// (<c>packages/shared/src/contracts/finance.contract.ts</c>).
/// </summary>
public sealed record CategoryDto(string Id, string Name, string Color, string Kind, bool IsSystem, DateTime? ArchivedAt)
{
    public static CategoryDto From(Category category)
    {
        ArgumentNullException.ThrowIfNull(category);
        return new(category.Id, category.Name, category.Color, KindName(category.Kind), category.IsSystem, category.ArchivedAt);
    }

    public static string KindName(CategoryKind kind) => kind == CategoryKind.Income ? "INCOME" : "EXPENSE";
}

public sealed record IncomeDto(string Id, string Name, int AmountCents, int ReceiptDay, bool Active)
{
    public static IncomeDto From(Income income)
    {
        ArgumentNullException.ThrowIfNull(income);
        return new(income.Id, income.Name, income.AmountCents, income.ReceiptDay, income.Active);
    }
}

public sealed record SettingsDto(
    bool OverspendAlerts,
    bool WeeklySummary,
    bool RoundCents,
    bool AutoDarkMode,
    bool ShowDailyAllowance,
    int OpeningBalanceCents,
    DateOnly? OpeningDate,
    int? DailyBudgetCents)
{
    public static SettingsDto From(UserSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return new(
            settings.OverspendAlerts,
            settings.WeeklySummary,
            settings.RoundCents,
            settings.AutoDarkMode,
            settings.ShowDailyAllowance,
            settings.OpeningBalanceCents,
            settings.OpeningDate,
            settings.DailyBudgetCents);
    }
}

/// <summary>Corpo de <c>POST /api/categories</c> já validado (nome aparado, tipo com padrão).</summary>
public sealed record CreateCategoryCommand(string Name, string? Color, CategoryKind Kind);

/// <summary>Corpo de <c>PATCH /api/categories/:id</c>; o que não veio fica como está.</summary>
public sealed record UpdateCategoryCommand(Patch<string> Name, Patch<string> Color, Patch<bool> Archived);

public sealed record CreateIncomeCommand(string Name, int AmountCents, int ReceiptDay);

public sealed record UpdateIncomeCommand(Patch<string> Name, Patch<int> AmountCents, Patch<int> ReceiptDay, Patch<bool> Active);
