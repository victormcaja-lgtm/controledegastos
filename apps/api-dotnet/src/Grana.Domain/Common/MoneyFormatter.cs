using System.Globalization;
using System.Text;

namespace Grana.Domain.Common;

/// <summary>
/// Formatação de dinheiro idêntica ao <c>formatMoney</c> de packages/shared
/// (<c>toLocaleString('pt-BR')</c> no Node). Feita à mão, sem <c>CultureInfo</c>,
/// para não depender da versão de ICU do servidor (R-05).
/// </summary>
public static class MoneyFormatter
{
    /// <summary>Sinal de menos tipográfico (U+2212), o mesmo da API Node.</summary>
    public const char MinusSign = '−';

    /// <summary>"R$ 1.234,56", "−R$ 10,00", "+R$ 5,00", "R$ 1.235" (sem centavos).</summary>
    public static string Format(long cents, bool hideCents = false, bool withSymbol = true, bool withSign = false)
    {
        var absolute = Math.Abs(cents);
        string body;
        if (hideCents)
        {
            body = Group(JsMath.RoundToLong(absolute / 100.0));
        }
        else
        {
            body = $"{Group(absolute / 100)},{absolute % 100:D2}";
        }

        var sign = cents < 0 ? MinusSign.ToString() : withSign ? "+" : string.Empty;
        return $"{sign}{(withSymbol ? "R$ " : string.Empty)}{body}";
    }

    /// <summary>Compacto para eixos de gráfico: "1,2k", "980" (<c>formatCompact</c>).</summary>
    public static string FormatCompact(long cents)
    {
        var value = Math.Abs(cents) / 100.0;
        if (value >= 1000)
        {
            var thousands = JsMath.Round(value / 100) / 10;
            return $"{thousands.ToString(CultureInfo.InvariantCulture).Replace('.', ',')}k";
        }

        return JsMath.RoundToLong(value).ToString(CultureInfo.InvariantCulture);
    }

    private static string Group(long value)
    {
        var digits = value.ToString(CultureInfo.InvariantCulture);
        var builder = new StringBuilder(digits.Length + (digits.Length / 3));
        for (var index = 0; index < digits.Length; index++)
        {
            if (index > 0 && (digits.Length - index) % 3 == 0) builder.Append('.');
            builder.Append(digits[index]);
        }

        return builder.ToString();
    }
}
