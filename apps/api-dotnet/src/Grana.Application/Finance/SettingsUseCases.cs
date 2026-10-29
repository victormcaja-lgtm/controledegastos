using Grana.Application.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Finance;

/// <summary>Ajustes — <c>GetSettingsUseCase</c>/<c>UpdateSettingsUseCase</c> (RN-150, RN-151).</summary>
public sealed class SettingsUseCases(IUserSettingsRepository settings, IClock clock)
{
    public async Task<SettingsDto> GetAsync(Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var found = await settings.FindAsync(actor.UserId, cancellationToken).ConfigureAwait(false);
        return SettingsDto.From(found ?? UserSettings.Defaults(actor.UserId));
    }

    /// <summary>Upsert: sem linha gravada, aplica o PATCH sobre os padrões e cria a linha.</summary>
    public async Task<SettingsDto> UpdateAsync(Actor actor, SettingsPatch patch, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(patch);
        var now = clock.UtcNow;
        var current = await settings.FindAsync(actor.UserId, cancellationToken).ConfigureAwait(false)
            ?? UserSettings.Defaults(actor.UserId);
        current.Apply(patch, now);
        await settings.SaveAsync(current, now, cancellationToken).ConfigureAwait(false);
        return SettingsDto.From(current);
    }
}
