using Grana.Application.Common;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Finance;

/// <summary>Categorias — <c>categories.usecases.ts</c> (RN-070–074), na mesma ordem de checagens.</summary>
public sealed class CategoryUseCases(ICategoryRepository categories, IClock clock, IIdGenerator ids)
{
    public async Task<IReadOnlyList<CategoryDto>> ListAsync(Actor actor, bool includeArchived, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var records = await categories.ListAsync(actor.UserId, includeArchived, cancellationToken).ConfigureAwait(false);
        return [.. records.Select(CategoryDto.From)];
    }

    public async Task<CategoryDto> CreateAsync(Actor actor, CreateCategoryCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var existing = await categories.FindByNameAsync(actor.UserId, command.Name, command.Kind, cancellationToken).ConfigureAwait(false);
        if (existing is not null) throw new ConflictError(Category.DuplicateNameMessage);

        var total = await categories.CountAsync(actor.UserId, cancellationToken).ConfigureAwait(false);
        var category = Category.CreateCustom(ids.NewId(), actor.UserId, command.Name, command.Kind, command.Color, total);
        await categories.AddAsync(category, clock.UtcNow, cancellationToken).ConfigureAwait(false);
        return CategoryDto.From(category);
    }

    public async Task<CategoryDto> UpdateAsync(Actor actor, string id, UpdateCategoryCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var category = await categories.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false)
            ?? throw new NotFoundError("Categoria");

        if (command.Name.IsSet && category.NeedsDuplicateCheckFor(command.Name.Value))
        {
            // Sem excluir a própria categoria: com o ILIKE do Prisma, "Laz_r" casa com "Lazer" e dá 409 (⚠️).
            var clash = await categories.FindByNameAsync(actor.UserId, command.Name.Value, category.Kind, cancellationToken).ConfigureAwait(false);
            if (clash is not null) throw new ConflictError(Category.DuplicateNameMessage);
        }

        var now = clock.UtcNow;
        if (command.Name.IsSet) category.Rename(command.Name.Value);
        if (command.Color.IsSet) category.ChangeColor(command.Color.Value);
        if (command.Archived.IsSet) category.SetArchived(command.Archived.Value, now);
        await categories.UpdateAsync(category, now, cancellationToken).ConfigureAwait(false);
        return CategoryDto.From(category);
    }

    /// <summary>Em uso → arquive; do sistema → só arquivar (RN-074).</summary>
    public async Task DeleteAsync(Actor actor, string id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var category = await categories.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false)
            ?? throw new NotFoundError("Categoria");
        var usages = await categories.CountUsagesAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false);
        category.EnsureCanBeDeleted(usages);
        await categories.DeleteAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false);
    }
}
