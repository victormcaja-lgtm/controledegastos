using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Domain.Tests.Finance;

/// <summary>Ajustes — RN-150, RN-151 (dashboard.usecases.ts e PrismaSettingsRepository).</summary>
public class UserSettingsTests
{
    // 26/10 às 23h30 UTC: amanhã em UTC é 27/10.
    private static readonly DateTime Now = new(2026, 10, 26, 23, 30, 0, DateTimeKind.Utc);

    [Fact]
    public void Padroes_iguais_aos_do_Node()
    {
        var settings = UserSettings.Defaults("u1");
        Assert.Equal("u1", settings.UserId);
        Assert.True(settings.OverspendAlerts);
        Assert.True(settings.WeeklySummary);
        Assert.False(settings.RoundCents);
        Assert.False(settings.AutoDarkMode);
        Assert.True(settings.ShowDailyAllowance);
        Assert.Equal(0, settings.OpeningBalanceCents);
        Assert.Null(settings.OpeningDate);
        Assert.Null(settings.DailyBudgetCents);
    }

    [Fact]
    public void Patch_altera_so_o_que_veio()
    {
        var settings = UserSettings.Defaults("u1");
        settings.Apply(new SettingsPatch
        {
            RoundCents = Patch.Set<bool>(true),
            OpeningBalanceCents = Patch.Set<int>(-150_000),
            OpeningDate = Patch.Set<string?>("2026-10-01"),
            DailyBudgetCents = Patch.Set<int?>(4_500),
        }, Now);

        Assert.True(settings.RoundCents);
        Assert.True(settings.OverspendAlerts);
        Assert.Equal(-150_000, settings.OpeningBalanceCents);
        Assert.Equal(new DateOnly(2026, 10, 1), settings.OpeningDate);
        Assert.Equal(4_500, settings.DailyBudgetCents);
    }

    [Fact]
    public void Todos_os_booleanos_podem_ser_trocados()
    {
        var settings = UserSettings.Defaults("u1");
        settings.Apply(new SettingsPatch
        {
            OverspendAlerts = Patch.Set<bool>(false),
            WeeklySummary = Patch.Set<bool>(false),
            AutoDarkMode = Patch.Set<bool>(true),
            ShowDailyAllowance = Patch.Set<bool>(false),
        }, Now);
        Assert.Equal((false, false, true, false),
            (settings.OverspendAlerts, settings.WeeklySummary, settings.AutoDarkMode, settings.ShowDailyAllowance));
    }

    [Fact]
    public void Null_desliga_o_saldo_futuro_e_o_gasto_diario_volta_ao_historico()
    {
        var settings = UserSettings.Restore("u1", true, true, false, false, true, 1_000, new DateOnly(2026, 1, 1), 3_000);
        settings.Apply(new SettingsPatch
        {
            OpeningDate = Patch.Set<string?>(null),
            DailyBudgetCents = Patch.Set<int?>(null),
        }, Now);
        Assert.Null(settings.OpeningDate);
        Assert.Null(settings.DailyBudgetCents);
        Assert.Equal(1_000, settings.OpeningBalanceCents);
    }

    [Fact]
    public void Data_ausente_no_patch_mantem_a_atual()
    {
        var settings = UserSettings.Restore("u1", true, true, false, false, true, 0, new DateOnly(2026, 1, 1), null);
        settings.Apply(new SettingsPatch { RoundCents = Patch.Set<bool>(true) }, Now);
        Assert.Equal(new DateOnly(2026, 1, 1), settings.OpeningDate);
    }

    [Theory]
    [InlineData("2026-10-26")]
    [InlineData("2026-10-27")]
    public void Ate_amanha_em_UTC_e_aceito(string date)
    {
        var settings = UserSettings.Defaults("u1");
        settings.Apply(new SettingsPatch { OpeningDate = Patch.Set<string?>(date) }, Now);
        Assert.Equal(IsoDate.Parse(date), settings.OpeningDate);
    }

    [Fact]
    public void Depois_de_amanha_e_recusado_e_nada_muda()
    {
        var settings = UserSettings.Defaults("u1");
        var error = Assert.Throws<BusinessRuleError>(() => settings.Apply(new SettingsPatch
        {
            RoundCents = Patch.Set<bool>(true),
            OpeningDate = Patch.Set<string?>("2026-10-28"),
        }, Now));
        Assert.Equal("A data do saldo inicial não pode ser no futuro.", error.Message);
        Assert.False(settings.RoundCents);
        Assert.Null(settings.OpeningDate);
    }

    [Fact]
    public void Compara_o_texto_e_grava_a_data_rolada_como_o_JavaScript()
    {
        // "2026-02-31" < "2026-03-01" como texto: passa; o Date do JS grava 03/03.
        var settings = UserSettings.Defaults("u1");
        settings.Apply(new SettingsPatch { OpeningDate = Patch.Set<string?>("2026-02-31") },
            new DateTime(2026, 2, 28, 12, 0, 0, DateTimeKind.Utc));
        Assert.Equal(new DateOnly(2026, 3, 3), settings.OpeningDate);
    }

    [Fact]
    public void Data_que_o_JavaScript_nao_le_e_erro_de_programacao() =>
        Assert.Throws<ArgumentException>(() =>
            UserSettings.Defaults("u1").Apply(new SettingsPatch { OpeningDate = Patch.Set<string?>("2026-00-10") }, Now));
}
