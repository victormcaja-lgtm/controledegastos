namespace Grana.Domain.Finance;

/// <summary>
/// Paleta do app e categorias criadas com a conta. Espelha <c>CATEGORY_COLORS</c>
/// (<c>packages/shared/src/enums.ts</c>) e <c>DEFAULT_CATEGORIES</c>
/// (<c>apps/api/src/modules/finance/domain/default-categories.ts</c>).
/// </summary>
public static class CategoryPalette
{
    public static IReadOnlyList<string> Colors { get; } =
    [
        "oklch(0.62 0.10 145)",
        "oklch(0.62 0.10 300)",
        "oklch(0.62 0.10 20)",
        "oklch(0.62 0.10 70)",
        "oklch(0.62 0.10 250)",
        "oklch(0.62 0.10 200)",
        "oklch(0.62 0.10 330)",
        "oklch(0.62 0.10 40)",
        "oklch(0.62 0.10 160)",
        "oklch(0.62 0.10 120)",
        "oklch(0.62 0.10 90)",
    ];

    /// <summary>
    /// Cor padrão de uma categoria nova: a da posição <paramref name="index"/>,
    /// dando a volta na paleta. O índice é o total de categorias do usuário,
    /// incluindo as arquivadas (RN-072).
    /// </summary>
    public static string ColorForIndex(int index)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(index);
        return Colors[index % Colors.Count];
    }

    /// <summary>
    /// Categorias do onboarding, marcadas como do sistema: podem ser renomeadas e
    /// arquivadas, mas não excluídas (RN-073, RN-074).
    /// </summary>
    public static IReadOnlyList<(string Name, string Color, CategoryKind Kind)> Defaults { get; } =
    [
        ("Mercado", "oklch(0.62 0.10 145)", CategoryKind.Expense),
        ("Lazer", "oklch(0.62 0.10 300)", CategoryKind.Expense),
        ("Roupa", "oklch(0.62 0.10 20)", CategoryKind.Expense),
        ("Transporte", "oklch(0.62 0.10 70)", CategoryKind.Expense),
        ("Casa", "oklch(0.62 0.10 250)", CategoryKind.Expense),
        ("Educação", "oklch(0.62 0.10 200)", CategoryKind.Expense),
        ("Assinaturas", "oklch(0.62 0.10 330)", CategoryKind.Expense),
        ("Dívidas", "oklch(0.62 0.10 40)", CategoryKind.Expense),
        ("Salário", "oklch(0.62 0.10 160)", CategoryKind.Income),
        ("Renda extra", "oklch(0.62 0.10 120)", CategoryKind.Income),
        ("Bônus", "oklch(0.62 0.10 90)", CategoryKind.Income),
    ];
}
