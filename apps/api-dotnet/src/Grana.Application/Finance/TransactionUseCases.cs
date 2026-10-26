using Grana.Application.Common;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Finance;

/// <summary>Filtros de <c>GET /api/transactions</c> já validados (RN-084).</summary>
public sealed record TransactionFilter(
    string UserId, MonthRef? Month, string? CategoryId, EntryType? Type, string? Search, long Page, long PerPage);

public interface ITransactionRepository
{
    /// <summary>
    /// A página pedida, na ordem <c>occurredOn desc, createdAt desc</c>, e o total do filtro.
    /// ⚠️ A busca é <c>note ILIKE '%busca%'</c> SEM escape, como o <c>contains</c> do Prisma.
    /// </summary>
    Task<(IReadOnlyList<Transaction> Items, long Total)> ListAsync(TransactionFilter filter, CancellationToken cancellationToken);

    Task<Transaction?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken);

    Task AddAsync(Transaction transaction, CancellationToken cancellationToken);

    Task UpdateAsync(Transaction transaction, DateTime nowUtc, CancellationToken cancellationToken);

    Task DeleteAsync(string userId, string id, CancellationToken cancellationToken);

    /// <summary>Todos os lançamentos da competência, na ordem <c>occurredOn desc, createdAt desc</c>.</summary>
    Task<IReadOnlyList<Transaction>> ListForMonthAsync(string userId, MonthRef month, CancellationToken cancellationToken);

    /// <summary>
    /// Média mensal de despesas dos <paramref name="months"/> meses FECHADOS antes do mês de
    /// <paramref name="nowUtc"/>: soma ÷ meses, arredondada como o <c>Math.round</c> (RN-111).
    /// </summary>
    Task<long> AverageMonthlyExpenseAsync(string userId, int months, DateTime nowUtc, CancellationToken cancellationToken);

    /// <summary>Lançamentos com <c>first ≤ occurredOn ≤ last</c>, na ordem <c>occurredOn asc, createdAt asc</c> (saldo futuro).</summary>
    Task<IReadOnlyList<Transaction>> ListBetweenAsync(string userId, DateOnly first, DateOnly last, CancellationToken cancellationToken);

    /// <summary>
    /// Média diária de despesas dos <paramref name="days"/> dias antes de <paramref name="before"/>:
    /// soma ÷ max(7, min(dias, dias desde o 1º lançamento do período)), arredondada; sem despesas, 0 (RN-141).
    /// </summary>
    Task<long> AverageDailyExpenseAsync(string userId, DateOnly before, int days, CancellationToken cancellationToken);
}

public sealed record CategoryRefDto(string Id, string Name, string Color, string Kind);

public sealed record TransactionDto(
    string Id, string Type, int AmountCents, DateOnly OccurredOn, string? Note, CategoryRefDto Category, DateTime CreatedAt)
{
    public static TransactionDto From(Transaction transaction)
    {
        ArgumentNullException.ThrowIfNull(transaction);
        var category = transaction.Category;
        return new(
            transaction.Id,
            transaction.Type == EntryType.Income ? "INCOME" : "EXPENSE",
            transaction.AmountCents,
            transaction.OccurredOn,
            transaction.Note,
            new CategoryRefDto(category.Id, category.Name, category.Color, CategoryDto.KindName(category.Kind)),
            transaction.CreatedAt);
    }
}

public sealed record TransactionDayGroupDto(DateOnly Date, string Label, long TotalCents, IReadOnlyList<TransactionDto> Items);

/// <summary>Na ordem de campos do objeto que o Node devolve (o <c>summary</c> vai por último).</summary>
public sealed record TransactionListDto(
    IReadOnlyList<TransactionDto> Items,
    IReadOnlyList<TransactionDayGroupDto> Groups,
    long Page,
    long PerPage,
    long Total,
    long TotalPages,
    string Summary);

/// <summary>Corpo de <c>POST /api/transactions</c>; a data vem como texto e é lida como o <c>Date</c> do JS.</summary>
public sealed record CreateTransactionCommand(EntryType Type, int AmountCents, string CategoryId, string OccurredOn, string? Note);

public sealed record UpdateTransactionCommand(Patch<int> AmountCents, Patch<string> CategoryId, Patch<string> OccurredOn, Patch<string?> Note);

/// <summary>Lançamentos — <c>transactions.usecases.ts</c> (RN-080–086).</summary>
public sealed class TransactionUseCases(ITransactionRepository transactions, ICategoryRepository categories, IClock clock, IIdGenerator ids)
{
    public async Task<TransactionListDto> ListAsync(TransactionFilter filter, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filter);
        var (items, total) = await transactions.ListAsync(filter, cancellationToken).ConfigureAwait(false);
        var groups = TransactionGrouping.GroupByDay(items, DateOnly.FromDateTime(clock.UtcNow));
        return new TransactionListDto(
            [.. items.Select(TransactionDto.From)],
            [.. groups.Select(day => new TransactionDayGroupDto(day.Date, day.Label, day.TotalCents, [.. day.Items.Select(TransactionDto.From)]))],
            filter.Page,
            filter.PerPage,
            total,
            Math.Max(1, (long)Math.Ceiling(total / (double)filter.PerPage)),
            TransactionGrouping.Summary(total, items));
    }

    public async Task<TransactionDto> CreateAsync(Actor actor, CreateTransactionCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var category = await categories.FindByIdAsync(actor.UserId, command.CategoryId, cancellationToken).ConfigureAwait(false)
            ?? throw new NotFoundError("Categoria");
        var transaction = Transaction.Create(
            ids.NewId(), actor.UserId, category, command.Type, command.AmountCents, ParseDate(command.OccurredOn), command.Note, clock.UtcNow);
        await transactions.AddAsync(transaction, cancellationToken).ConfigureAwait(false);
        return TransactionDto.From(transaction);
    }

    public async Task<TransactionDto> UpdateAsync(Actor actor, string id, UpdateTransactionCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var transaction = await transactions.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false)
            ?? throw new NotFoundError("Lançamento");

        if (command.CategoryId.IsSet)
        {
            var category = await categories.FindByIdAsync(actor.UserId, command.CategoryId.Value, cancellationToken).ConfigureAwait(false)
                ?? throw new NotFoundError("Categoria");
            transaction.ChangeCategory(category);
        }

        if (command.AmountCents.IsSet) transaction.ChangeAmount(command.AmountCents.Value);
        if (command.OccurredOn.IsSet) transaction.ChangeDate(ParseDate(command.OccurredOn.Value));
        if (command.Note.IsSet) transaction.ChangeNote(command.Note.Value);
        await transactions.UpdateAsync(transaction, clock.UtcNow, cancellationToken).ConfigureAwait(false);
        return TransactionDto.From(transaction);
    }

    public async Task DeleteAsync(Actor actor, string id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        _ = await transactions.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false)
            ?? throw new NotFoundError("Lançamento");
        await transactions.DeleteAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false);
    }

    /// <summary><c>new Date(`${iso}T00:00:00.000Z`)</c>: 31/02 rola para 03/03 (RN-004 ⚠️).</summary>
    private static DateOnly ParseDate(string iso) =>
        JsDate.ParseIsoDate(iso) ?? throw new ArgumentException($"Data inválida depois da validação: \"{iso}\".", nameof(iso));
}
