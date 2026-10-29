using Grana.Application.Common;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Finance;

/// <summary>Entradas fixas — <c>incomes.usecases.ts</c> (RN-105).</summary>
public sealed class IncomeUseCases(IIncomeRepository incomes, IClock clock, IIdGenerator ids)
{
    public async Task<IReadOnlyList<IncomeDto>> ListAsync(Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var records = await incomes.ListAsync(actor.UserId, cancellationToken).ConfigureAwait(false);
        return [.. records.Select(IncomeDto.From)];
    }

    public async Task<IncomeDto> CreateAsync(Actor actor, CreateIncomeCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var income = Income.Create(ids.NewId(), actor.UserId, command.Name, command.AmountCents, command.ReceiptDay);
        await incomes.AddAsync(income, clock.UtcNow, cancellationToken).ConfigureAwait(false);
        return IncomeDto.From(income);
    }

    public async Task<IncomeDto> UpdateAsync(Actor actor, string id, UpdateIncomeCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var income = await incomes.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false)
            ?? throw new NotFoundError("Entrada");
        income.Update(command.Name, command.AmountCents, command.ReceiptDay, command.Active);
        await incomes.UpdateAsync(income, clock.UtcNow, cancellationToken).ConfigureAwait(false);
        return IncomeDto.From(income);
    }

    public async Task DeleteAsync(Actor actor, string id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        _ = await incomes.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false)
            ?? throw new NotFoundError("Entrada");
        await incomes.DeleteAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false);
    }
}
