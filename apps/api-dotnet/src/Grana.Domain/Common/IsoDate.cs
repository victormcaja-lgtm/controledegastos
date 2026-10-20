using System.Globalization;

namespace Grana.Domain.Common;

/// <summary>Datas puras no formato <c>AAAA-MM-DD</c>, como a API as troca.</summary>
public static class IsoDate
{
    /// <summary>Lê <c>AAAA-MM-DD</c> estrito (data que existe).</summary>
    public static DateOnly Parse(string value) =>
        DateOnly.ParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static string ToIso(this DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>"15/10" — formato curto usado nas frases.</summary>
    public static string ToShortBr(this DateOnly date) => date.ToString("dd/MM", CultureInfo.InvariantCulture);
}

/// <summary>
/// Leitura de datas com a semântica do <c>Date.parse("AAAA-MM-DDT00:00:00Z")</c>
/// do V8, usado pela validação da API Node (RN-004 ⚠️): dia de 01 a 31 é
/// aceito em qualquer mês e o excedente "rola" para o mês seguinte
/// (31/02 → 03/03); dia 00, dia > 31 e mês fora de 01–12 são recusados.
/// </summary>
public static class JsDate
{
    /// <summary>Data resultante, ou <c>null</c> quando o V8 devolveria <c>NaN</c>.</summary>
    public static DateOnly? ParseIsoDate(string value)
    {
        if (value.Length != 10 || value[4] != '-' || value[7] != '-') return null;
        if (!TryDigits(value, 0, 4, out var year) || !TryDigits(value, 5, 2, out var month) ||
            !TryDigits(value, 8, 2, out var day))
        {
            return null;
        }

        // DateOnly começa no ano 1; o V8 aceitaria o ano 0 (ver tasks.md, D-06).
        if (year < 1 || month is < 1 or > 12 || day is < 1 or > 31) return null;
        var first = new DateOnly(year, month, 1);
        return day - 1 > DateOnly.MaxValue.DayNumber - first.DayNumber ? null : first.AddDays(day - 1);
    }

    private static bool TryDigits(string value, int start, int length, out int result)
    {
        result = 0;
        for (var index = start; index < start + length; index++)
        {
            var digit = value[index] - '0';
            if (digit is < 0 or > 9) return false;
            result = (result * 10) + digit;
        }

        return true;
    }
}
