using System.Globalization;

namespace Grana.Domain.Common;

/// <summary>
/// Datas <c>AAAA-MM-DD</c> tratadas como TEXTO, como no <c>cashflow.calculator.ts</c>: a
/// comparação é de strings e a aritmética passa pelo <c>Date.parse</c> do V8, que rola dias
/// inexistentes (31/02 → 03/03). Um <c>today</c> como "2026-02-31" segue texto até o fim.
/// </summary>
public static class IsoText
{
    private const long DayMs = 86_400_000;

    public static int Compare(string left, string right) => string.CompareOrdinal(left, right);

    /// <summary><c>addDaysISO</c>: <c>new Date(Date.parse(iso) + n dias).toISOString().slice(0, 10)</c>.</summary>
    public static string AddDays(string iso, int amount)
    {
        var milliseconds = JsDate.MidnightUtcMilliseconds(iso);
        if (double.IsNaN(milliseconds)) throw new ArgumentException($"Data inválida: \"{iso}\".", nameof(iso));
        return FromMilliseconds(milliseconds + (amount * (double)DayMs));
    }

    /// <summary><c>diffDaysISO</c>: dias de <paramref name="from"/> até <paramref name="to"/>, arredondados.</summary>
    public static int DiffDays(string from, string to) =>
        (int)JsMath.Round((JsDate.MidnightUtcMilliseconds(to) - JsDate.MidnightUtcMilliseconds(from)) / DayMs);

    /// <summary>Competência pelos 7 primeiros caracteres (<c>monthRefFromISODate</c>).</summary>
    public static MonthRef Month(string iso)
    {
        ArgumentNullException.ThrowIfNull(iso);
        return MonthRef.Parse(iso[..7]);
    }

    /// <summary><c>lastDayOfMonthISO</c>: último dia do mês do texto.</summary>
    public static string LastDayOfMonth(string iso) => Month(iso).LastDay.ToIso();

    public static string Max(params string[] values)
    {
        ArgumentNullException.ThrowIfNull(values);
        return values.Aggregate((a, b) => Compare(b, a) > 0 ? b : a);
    }

    /// <summary><c>formatShortDate</c>: "DD/MM".</summary>
    public static string ShortDate(string iso)
    {
        ArgumentNullException.ThrowIfNull(iso);
        return $"{iso[8..10]}/{iso[5..7]}";
    }

    private static string FromMilliseconds(double milliseconds)
    {
        var date = DateTimeOffset.FromUnixTimeMilliseconds((long)milliseconds).UtcDateTime;
        return date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }
}
