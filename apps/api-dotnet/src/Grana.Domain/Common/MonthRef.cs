using System.Globalization;
using System.Text.RegularExpressions;

namespace Grana.Domain.Common;

/// <summary>
/// Competência (mês de referência) — um conceito do domínio, não uma data.
/// Espelha <c>packages/shared/src/month.ts</c>. No banco, é o dia 1 do mês.
/// </summary>
public readonly partial record struct MonthRef : IComparable<MonthRef>
{
    private static readonly string[] ShortNames =
        ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

    private static readonly string[] LongNames =
    [
        "janeiro", "fevereiro", "março", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
    ];

    private MonthRef(int year, int month)
    {
        Year = year;
        Month = month;
    }

    public int Year { get; }

    public int Month { get; }

    /// <summary><c>AAAA-MM</c>.</summary>
    public string Value => $"{Year:D4}-{Month:D2}";

    /// <summary>"Março 2026".</summary>
    public string Label => $"{char.ToUpperInvariant(LongNames[Month - 1][0])}{LongNames[Month - 1][1..]} {Year}";

    /// <summary>"mar".</summary>
    public string ShortName => ShortNames[Month - 1];

    public string LongName => LongNames[Month - 1];

    public int DaysInMonth => DateTime.DaysInMonth(Year, Month);

    /// <summary>Dia 1 da competência (o valor gravado em <c>referenceMonth</c>/<c>startMonth</c>).</summary>
    public DateOnly Start => new(Year, Month, 1);

    public static bool IsValid(string value) => Pattern().IsMatch(value);

    public static MonthRef Parse(string value)
    {
        if (!IsValid(value)) throw new ArgumentException($"Competência inválida: \"{value}\". Formato esperado: YYYY-MM.", nameof(value));
        return new MonthRef(
            int.Parse(value[..4], CultureInfo.InvariantCulture),
            int.Parse(value[5..], CultureInfo.InvariantCulture));
    }

    public static MonthRef Of(DateOnly date) => new(date.Year, date.Month);

    public MonthRef AddMonths(int amount)
    {
        var absolute = (Year * 12) + (Month - 1) + amount;
        var year = (int)Math.Floor(absolute / 12.0);
        return new MonthRef(year, (((absolute % 12) + 12) % 12) + 1);
    }

    /// <summary>Quantos meses de <c>this</c> até <paramref name="other"/> (negativo se antes).</summary>
    public int MonthsUntil(MonthRef other) => ((other.Year - Year) * 12) + (other.Month - Month);

    /// <summary>Dia da competência limitado ao intervalo do mês (dia 31 em fevereiro → 28/29).</summary>
    public DateOnly DayOf(int day) => new(Year, Month, Math.Clamp(day, 1, DaysInMonth));

    public DateOnly LastDay => DayOf(31);

    public int CompareTo(MonthRef other) => (Year, Month).CompareTo((other.Year, other.Month));

    public static bool operator <(MonthRef left, MonthRef right) => left.CompareTo(right) < 0;

    public static bool operator >(MonthRef left, MonthRef right) => left.CompareTo(right) > 0;

    public static bool operator <=(MonthRef left, MonthRef right) => left.CompareTo(right) <= 0;

    public static bool operator >=(MonthRef left, MonthRef right) => left.CompareTo(right) >= 0;

    public override string ToString() => Value;

    [GeneratedRegex(@"^\d{4}-(0[1-9]|1[0-2])$")]
    private static partial Regex Pattern();
}
