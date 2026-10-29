using Grana.Application.Common;
using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Tests.Finance;

/// <summary>incomes.usecases.ts (RN-105) e os casos de uso de ajustes (RN-150, RN-151).</summary>
public class IncomeAndSettingsUseCasesTests
{
    private static readonly DateTime Now = new(2026, 10, 26, 23, 0, 0, DateTimeKind.Utc);
    private static readonly Actor Ana = new("u1", "ana@grana.app", "USER");

    private readonly InMemoryIncomes _incomes = new();
    private readonly InMemorySettings _settings = new();
    private readonly IncomeUseCases _incomeUseCases;
    private readonly SettingsUseCases _settingsUseCases;

    public IncomeAndSettingsUseCasesTests()
    {
        var clock = new FixedClock(Now);
        _incomeUseCases = new IncomeUseCases(_incomes, clock, new SequentialIds());
        _settingsUseCases = new SettingsUseCases(_settings, clock);
    }

    [Fact]
    public async Task Entrada_cria_edita_lista_e_exclui()
    {
        var created = await _incomeUseCases.CreateAsync(Ana, new CreateIncomeCommand("Salário", 500_000, 5), CancellationToken.None);
        Assert.Equal(new IncomeDto("id-1", "Salário", 500_000, 5, true), created);

        var updated = await _incomeUseCases.UpdateAsync(
            Ana, "id-1", new UpdateIncomeCommand(default, Patch.Set(510_000), default, Patch.Set(false)), CancellationToken.None);
        Assert.Equal(new IncomeDto("id-1", "Salário", 510_000, 5, false), updated);
        Assert.Equal(1, _incomes.UpdateCount);

        _incomes.Items.Add(Income.Create("de-outro", "u2", "Bolsa", 100, 1));
        Assert.Equal(["id-1"], (await _incomeUseCases.ListAsync(Ana, CancellationToken.None)).Select(i => i.Id));

        await _incomeUseCases.DeleteAsync(Ana, "id-1", CancellationToken.None);
        Assert.Single(_incomes.Items);
    }

    [Fact]
    public async Task Entrada_de_outro_usuario_responde_404_no_masculino()
    {
        _incomes.Items.Add(Income.Create("de-outro", "u2", "Bolsa", 100, 1));
        var update = await Assert.ThrowsAsync<NotFoundError>(() =>
            _incomeUseCases.UpdateAsync(Ana, "de-outro", new UpdateIncomeCommand(Patch.Set("Roubado"), default, default, default), CancellationToken.None));
        Assert.Equal("Entrada não encontrado.", update.Message);
        await Assert.ThrowsAsync<NotFoundError>(() => _incomeUseCases.DeleteAsync(Ana, "de-outro", CancellationToken.None));
        Assert.Single(_incomes.Items);
    }

    [Fact]
    public async Task Ajustes_sem_linha_devolvem_os_padroes_e_o_patch_cria_a_linha()
    {
        Assert.Equal(new SettingsDto(true, true, false, false, true, 0, null, null), await _settingsUseCases.GetAsync(Ana, CancellationToken.None));
        Assert.Empty(_settings.Rows);

        var saved = await _settingsUseCases.UpdateAsync(Ana, new SettingsPatch { RoundCents = Patch.Set(true) }, CancellationToken.None);
        Assert.True(saved.RoundCents);
        Assert.True(_settings.Rows["u1"].RoundCents);

        var again = await _settingsUseCases.UpdateAsync(Ana, new SettingsPatch { OpeningDate = Patch.Set<string?>("2026-10-27") }, CancellationToken.None);
        Assert.Equal((true, (DateOnly?)new DateOnly(2026, 10, 27)), (again.RoundCents, again.OpeningDate));
        Assert.Equal(again, await _settingsUseCases.GetAsync(Ana, CancellationToken.None));
    }

    [Fact]
    public async Task Ajustes_com_data_depois_de_amanha_nao_gravam()
    {
        await Assert.ThrowsAsync<BusinessRuleError>(() =>
            _settingsUseCases.UpdateAsync(Ana, new SettingsPatch { OpeningDate = Patch.Set<string?>("2026-10-28") }, CancellationToken.None));
        Assert.Empty(_settings.Rows);
    }
}
