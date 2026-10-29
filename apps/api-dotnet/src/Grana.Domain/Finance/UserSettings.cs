using Grana.Domain.Common;

namespace Grana.Domain.Finance;

/// <summary>
/// Ajustes do usuário (RN-150–153). Sem linha gravada, valem os padrões; o PATCH
/// faz upsert, então aplicar um PATCH sobre <see cref="Defaults"/> dá a mesma
/// linha que o Node cria.
/// </summary>
public sealed class UserSettings
{
    private UserSettings(string userId)
    {
        UserId = userId;
    }

    public string UserId { get; }

    public bool OverspendAlerts { get; private set; } = true;

    public bool WeeklySummary { get; private set; } = true;

    /// <summary>Só o front usa: esconde os centavos (RN-152).</summary>
    public bool RoundCents { get; private set; }

    /// <summary>Gravado e exibido, mas nenhum código o usa (RN-153 ⚠️).</summary>
    public bool AutoDarkMode { get; private set; }

    /// <summary>Só o front usa: mostra o "por dia" na Home (RN-152).</summary>
    public bool ShowDailyAllowance { get; private set; } = true;

    /// <summary>Saldo na conta no INÍCIO de <see cref="OpeningDate"/>; pode ser negativo.</summary>
    public int OpeningBalanceCents { get; private set; }

    /// <summary><c>null</c> = saldo futuro ainda não configurado.</summary>
    public DateOnly? OpeningDate { get; private set; }

    /// <summary><c>null</c> = calcular o gasto diário pelo histórico.</summary>
    public int? DailyBudgetCents { get; private set; }

    /// <summary>O que <c>GET /api/settings</c> devolve quando não há linha gravada.</summary>
    public static UserSettings Defaults(string userId) => new(userId);

    public static UserSettings Restore(
        string userId,
        bool overspendAlerts,
        bool weeklySummary,
        bool roundCents,
        bool autoDarkMode,
        bool showDailyAllowance,
        int openingBalanceCents,
        DateOnly? openingDate,
        int? dailyBudgetCents) =>
        new(userId)
        {
            OverspendAlerts = overspendAlerts,
            WeeklySummary = weeklySummary,
            RoundCents = roundCents,
            AutoDarkMode = autoDarkMode,
            ShowDailyAllowance = showDailyAllowance,
            OpeningBalanceCents = openingBalanceCents,
            OpeningDate = openingDate,
            DailyBudgetCents = dailyBudgetCents,
        };

    /// <summary>
    /// Aplica um PATCH já validado pelo contrato. Recusa a data do saldo inicial
    /// posterior a AMANHÃ em UTC — um dia de folga para quem está num fuso à
    /// frente (RN-151) — e nesse caso não altera nada.
    /// </summary>
    public void Apply(SettingsPatch patch, DateTime nowUtc)
    {
        DateOnly? openingDate = OpeningDate;
        if (patch.OpeningDate.IsSet)
        {
            openingDate = ParseOpeningDate(patch.OpeningDate.Value, nowUtc);
        }

        OverspendAlerts = patch.OverspendAlerts.Or(OverspendAlerts);
        WeeklySummary = patch.WeeklySummary.Or(WeeklySummary);
        RoundCents = patch.RoundCents.Or(RoundCents);
        AutoDarkMode = patch.AutoDarkMode.Or(AutoDarkMode);
        ShowDailyAllowance = patch.ShowDailyAllowance.Or(ShowDailyAllowance);
        OpeningBalanceCents = patch.OpeningBalanceCents.Or(OpeningBalanceCents);
        OpeningDate = openingDate;
        DailyBudgetCents = patch.DailyBudgetCents.Or(DailyBudgetCents);
    }

    /// <remarks>
    /// O Node compara o TEXTO recebido com o de amanhã (<c>"2026-02-31" &gt; "2026-03-01"</c>
    /// é falso) e só depois grava a data, que o <c>Date</c> do JavaScript rola
    /// (31/02 → 03/03). Os dois passos são reproduzidos nessa ordem.
    /// </remarks>
    private static DateOnly? ParseOpeningDate(string? raw, DateTime nowUtc)
    {
        if (string.IsNullOrEmpty(raw)) return null;

        var tomorrow = DateOnly.FromDateTime(nowUtc.AddDays(1)).ToIso();
        if (string.CompareOrdinal(raw, tomorrow) > 0)
        {
            throw new BusinessRuleError("A data do saldo inicial não pode ser no futuro.");
        }

        return JsDate.ParseIsoDate(raw) ?? throw new ArgumentException($"Data inválida: \"{raw}\".", nameof(raw));
    }
}

/// <summary>Campos do <c>PATCH /api/settings</c>; o que não veio fica como está.</summary>
public sealed record SettingsPatch
{
    public Patch<bool> OverspendAlerts { get; init; }

    public Patch<bool> WeeklySummary { get; init; }

    public Patch<bool> RoundCents { get; init; }

    public Patch<bool> AutoDarkMode { get; init; }

    public Patch<bool> ShowDailyAllowance { get; init; }

    public Patch<int> OpeningBalanceCents { get; init; }

    /// <summary>Texto <c>AAAA-MM-DD</c> como chegou; <c>null</c> desliga o saldo futuro.</summary>
    public Patch<string?> OpeningDate { get; init; }

    public Patch<int?> DailyBudgetCents { get; init; }
}
