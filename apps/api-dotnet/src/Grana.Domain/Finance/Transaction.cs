using Grana.Domain.Common;

namespace Grana.Domain.Finance;

/// <summary>Tipo do lançamento (enum <c>EntryType</c> do Postgres).</summary>
public enum EntryType
{
    Expense = 0,
    Income = 1,
}

/// <summary>Categoria como o lançamento a mostra: <c>{id, name, color, kind}</c>.</summary>
public sealed record CategoryRef(string Id, string Name, string Color, CategoryKind Kind)
{
    public static CategoryRef Of(Category category)
    {
        ArgumentNullException.ThrowIfNull(category);
        return new(category.Id, category.Name, category.Color, category.Kind);
    }
}

/// <summary>
/// Lançamento avulso — RN-080–083 (<c>transactions.usecases.ts</c>). O tipo não muda
/// depois de criado; a categoria precisa ser do mesmo tipo.
/// </summary>
public sealed class Transaction
{
    private Transaction(
        string id, string userId, EntryType type, int amountCents, DateOnly occurredOn, string? note, CategoryRef category, DateTime createdAt)
    {
        Id = id;
        UserId = userId;
        Type = type;
        AmountCents = amountCents;
        OccurredOn = occurredOn;
        Note = note;
        Category = category;
        CreatedAt = createdAt;
    }

    public string Id { get; }

    public string UserId { get; }

    public EntryType Type { get; }

    public int AmountCents { get; private set; }

    /// <summary>Datas futuras são aceitas (lançamento agendado).</summary>
    public DateOnly OccurredOn { get; private set; }

    /// <summary>⚠️ Só com espaços chega como <c>""</c> (já aparada) e é gravada assim, não como <c>null</c> (RN-081).</summary>
    public string? Note { get; private set; }

    public CategoryRef Category { get; private set; }

    public DateTime CreatedAt { get; }

    public static Transaction Restore(
        string id, string userId, EntryType type, int amountCents, DateOnly occurredOn, string? note, CategoryRef category, DateTime createdAt) =>
        new(id, userId, type, amountCents, occurredOn, note, category, createdAt);

    /// <summary>
    /// Novo lançamento. A categoria (já encontrada pelo caso de uso) não pode estar
    /// arquivada e precisa ser do tipo do lançamento (RN-080), nessa ordem.
    /// </summary>
    public static Transaction Create(
        string id, string userId, Category category, EntryType type, int amountCents, DateOnly occurredOn, string? note, DateTime createdAt)
    {
        ArgumentNullException.ThrowIfNull(category);
        if (category.IsArchived) throw new BusinessRuleError("Esta categoria está arquivada. Escolha outra.");
        if (!Matches(category.Kind, type))
        {
            throw new BusinessRuleError(type == EntryType.Expense
                ? "Escolha uma categoria de despesa para um gasto."
                : "Escolha uma categoria de entrada para um recebimento.");
        }

        return new(id, userId, type, amountCents, occurredOn, note, CategoryRef.Of(category), createdAt);
    }

    /// <summary>
    /// Troca a categoria: precisa ser do tipo do lançamento (RN-082). ⚠️ Na edição, uma
    /// categoria arquivada é aceita, ao contrário da criação (RN-083).
    /// </summary>
    public void ChangeCategory(Category category)
    {
        ArgumentNullException.ThrowIfNull(category);
        if (!Matches(category.Kind, Type)) throw new BusinessRuleError("A categoria escolhida não combina com o tipo do lançamento.");
        Category = CategoryRef.Of(category);
    }

    public void ChangeAmount(int amountCents) => AmountCents = amountCents;

    public void ChangeDate(DateOnly occurredOn) => OccurredOn = occurredOn;

    /// <summary><c>null</c> limpa a observação (RN-082).</summary>
    public void ChangeNote(string? note) => Note = note;

    /// <summary>Despesa conta a favor do gasto; entrada, contra (o <c>totalCents</c> do dia).</summary>
    public long SignedCents => Type == EntryType.Expense ? AmountCents : -(long)AmountCents;

    private static bool Matches(CategoryKind kind, EntryType type) =>
        (kind == CategoryKind.Expense) == (type == EntryType.Expense);
}
