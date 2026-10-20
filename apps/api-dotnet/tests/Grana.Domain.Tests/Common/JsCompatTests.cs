using Grana.Domain.Common;

namespace Grana.Domain.Tests.Common;

/// <summary>
/// Valores esperados medidos no Node 24 (V8) e em packages/shared: o .NET
/// precisa arredondar, ler datas e formatar dinheiro exatamente igual (R-03, R-04, R-05).
/// </summary>
public class JsCompatTests
{
    [Theory]
    [InlineData(0.5, 1)]
    [InlineData(1.5, 2)]
    [InlineData(2.5, 3)]
    [InlineData(-0.5, 0)]
    [InlineData(-1.5, -1)]
    [InlineData(-2.5, -2)]
    [InlineData(0.49999999999999994, 0)]
    [InlineData(32.5, 33)]
    [InlineData(1e15 + 0.5, 1000000000000001)]
    public void JsMath_Round_arredonda_meio_para_mais_infinito(double value, double expected) =>
        Assert.Equal(expected, JsMath.Round(value));

    [Theory]
    [InlineData(169000, 520000, 33)]
    [InlineData(1, 3, 33)]
    [InlineData(2, 3, 67)]
    [InlineData(50000, 1, 100)]
    [InlineData(5, 0, 0)]
    [InlineData(-5, 10, 0)]
    public void PercentOf_igual_ao_shared(long part, long total, int expected) =>
        Assert.Equal(expected, JsMath.PercentOf(part, total));

    [Theory]
    [InlineData("2026-02-29", "2026-03-01")]
    [InlineData("2026-02-31", "2026-03-03")]
    [InlineData("2028-02-30", "2028-03-01")]
    [InlineData("2026-04-31", "2026-05-01")]
    [InlineData("2026-11-31", "2026-12-01")]
    [InlineData("2026-12-31", "2026-12-31")]
    [InlineData("9999-12-31", "9999-12-31")]
    public void JsDate_aceita_dia_ate_31_e_rola_para_o_mes_seguinte(string input, string expected) =>
        Assert.Equal(expected, JsDate.ParseIsoDate(input)?.ToIso());

    [Theory]
    [InlineData("2026-02-00")]
    [InlineData("2026-00-10")]
    [InlineData("2026-13-01")]
    [InlineData("2026-02-32")]
    [InlineData("2026-1-01")]
    [InlineData("abc")]
    public void JsDate_recusa_o_que_o_V8_recusa(string input) =>
        Assert.Null(JsDate.ParseIsoDate(input));

    [Theory]
    [InlineData(0, "R$ 0,00", "R$ 0", "+R$ 0,00")]
    [InlineData(5, "R$ 0,05", "R$ 0", "+R$ 0,05")]
    [InlineData(99, "R$ 0,99", "R$ 1", "+R$ 0,99")]
    [InlineData(100, "R$ 1,00", "R$ 1", "+R$ 1,00")]
    [InlineData(123456, "R$ 1.234,56", "R$ 1.235", "+R$ 1.234,56")]
    [InlineData(-1000, "−R$ 10,00", "−R$ 10", "−R$ 10,00")]
    [InlineData(100000000, "R$ 1.000.000,00", "R$ 1.000.000", "+R$ 1.000.000,00")]
    [InlineData(-50, "−R$ 0,50", "−R$ 1", "−R$ 0,50")]
    [InlineData(1999999999, "R$ 19.999.999,99", "R$ 20.000.000", "+R$ 19.999.999,99")]
    [InlineData(150, "R$ 1,50", "R$ 2", "+R$ 1,50")]
    [InlineData(99950, "R$ 999,50", "R$ 1.000", "+R$ 999,50")]
    [InlineData(123456789012, "R$ 1.234.567.890,12", "R$ 1.234.567.890", "+R$ 1.234.567.890,12")]
    public void MoneyFormatter_igual_ao_formatMoney(long cents, string plain, string hidden, string withSignText)
    {
        Assert.Equal(plain, MoneyFormatter.Format(cents));
        Assert.Equal(hidden, MoneyFormatter.Format(cents, hideCents: true));
        Assert.Equal(withSignText, MoneyFormatter.Format(cents, withSign: true));
    }

    [Fact]
    public void MoneyFormatter_sem_simbolo() => Assert.Equal("1.234,56", MoneyFormatter.Format(123456, withSymbol: false));

    [Theory]
    [InlineData(0, "0")]
    [InlineData(98000, "980")]
    [InlineData(99999, "1000")]
    [InlineData(100000, "1k")]
    [InlineData(123456, "1,2k")]
    [InlineData(1250000, "12,5k")]
    [InlineData(99950, "1000")]
    public void FormatCompact_igual_ao_shared(long cents, string expected) =>
        Assert.Equal(expected, MoneyFormatter.FormatCompact(cents));
}
