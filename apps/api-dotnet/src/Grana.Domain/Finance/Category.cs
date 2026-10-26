using Grana.Domain.Common;

namespace Grana.Domain.Finance;

/// <summary>
/// Categoria de gastos ou entradas (RN-070–074). O que depende do banco — nome
/// repetido sem diferenciar maiúsculas, contagem de uso — chega aqui já
/// resolvido pelo caso de uso; as regras ficam no agregado.
/// </summary>
public sealed class Category
{
    public const string DuplicateNameMessage = "Você já tem uma categoria com esse nome.";

    private Category(string id, string userId, string name, string color, CategoryKind kind, bool isSystem, DateTime? archivedAt)
    {
        Id = id;
        UserId = userId;
        Name = name;
        Color = color;
        Kind = kind;
        IsSystem = isSystem;
        ArchivedAt = archivedAt;
    }

    public string Id { get; }

    public string UserId { get; }

    public string Name { get; private set; }

    public string Color { get; private set; }

    /// <summary>Não muda depois de criada: lançamentos e contas dependem dele.</summary>
    public CategoryKind Kind { get; }

    public bool IsSystem { get; }

    /// <summary>Instante em UTC; <c>null</c> = ativa.</summary>
    public DateTime? ArchivedAt { get; private set; }

    public bool IsArchived => ArchivedAt is not null;

    /// <summary>Reconstrói uma categoria lida do banco.</summary>
    public static Category Restore(
        string id, string userId, string name, string color, CategoryKind kind, bool isSystem, DateTime? archivedAt) =>
        new(id, userId, name, color, kind, isSystem, archivedAt);

    /// <summary>
    /// Categoria personalizada (RN-072). Sem cor escolhida, usa a da paleta na
    /// posição <paramref name="existingCount"/> (total do usuário, com as arquivadas).
    /// </summary>
    public static Category CreateCustom(
        string id, string userId, string name, CategoryKind kind, string? color, int existingCount) =>
        new(id, userId, name, color ?? CategoryPalette.ColorForIndex(existingCount), kind, isSystem: false, archivedAt: null);

    /// <summary>Uma das categorias do onboarding (<see cref="CategoryPalette.Defaults"/>).</summary>
    public static Category CreateSystem(string id, string userId, string name, string color, CategoryKind kind) =>
        new(id, userId, name, color, kind, isSystem: true, archivedAt: null);

    /// <summary>
    /// A troca de nome só precisa da checagem de repetido quando muda além de
    /// maiúsculas e minúsculas (RN-073): "mercado" → "Mercado" passa direto.
    /// </summary>
    /// <remarks>
    /// Compara com <c>ToLowerInvariant</c>, a mesma escolha do <c>ZodCompat</c> para o
    /// <c>toLowerCase()</c> do JavaScript. Os dois só divergem em "İ" e no sigma final
    /// grego, que não aparecem em nomes de categoria.
    /// </remarks>
    public bool NeedsDuplicateCheckFor(string newName) =>
        !string.Equals(newName.ToLowerInvariant(), Name.ToLowerInvariant(), StringComparison.Ordinal);

    public void Rename(string name) => Name = name;

    public void ChangeColor(string color) => Color = color;

    /// <summary>
    /// Arquivar sempre grava o instante atual, inclusive numa categoria já arquivada;
    /// desarquivar limpa a data. Vale também para as do sistema (RN-073).
    /// </summary>
    public void SetArchived(bool archived, DateTime nowUtc) => ArchivedAt = archived ? nowUtc : null;

    /// <summary>
    /// Excluir: primeiro o uso (lançamentos, contas e compras), depois a regra das
    /// categorias do sistema — nessa ordem, como no Node (RN-074).
    /// </summary>
    public void EnsureCanBeDeleted(int usages)
    {
        if (usages > 0)
        {
            throw new BusinessRuleError($"Esta categoria está em {usages} registro(s). Arquive-a em vez de excluir.");
        }

        if (IsSystem)
        {
            throw new BusinessRuleError("Categorias padrão não podem ser excluídas — apenas arquivadas.");
        }
    }
}
