using Grana.Domain.Common;

namespace Grana.Domain.Tests.Common;

/// <summary>Competência (AAAA-MM) — espelha packages/shared/src/month.ts.</summary>
public class MonthRefTests
{
    [Theory]
    [InlineData("2026-01", -1, "2025-12")]
    [InlineData("2026-12", 1, "2027-01")]
    [InlineData("2026-03", -15, "2024-12")]
    [InlineData("2025-11", 14, "2027-01")]
    public void AddMonths_atravessa_anos(string month, int amount, string expected) =>
        Assert.Equal(expected, MonthRef.Parse(month).AddMonths(amount).Value);

    [Fact]
    public void Rotulos_e_nomes()
    {
        Assert.Equal("Março 2026", MonthRef.Parse("2026-03").Label);
        Assert.Equal("out", MonthRef.Parse("2026-10").ShortName);
    }

    [Theory]
    [InlineData("2026-02", 31, "2026-02-28")]
    [InlineData("2028-02", 30, "2028-02-29")]
    [InlineData("2026-04", 0, "2026-04-01")]
    [InlineData("2026-01", 15, "2026-01-15")]
    public void DayOf_limita_ao_fim_do_mes(string month, int day, string expected) =>
        Assert.Equal(expected, MonthRef.Parse(month).DayOf(day).ToIso());

    [Fact]
    public void MonthsBetween_e_comparacao()
    {
        var start = MonthRef.Parse("2025-05");
        Assert.Equal(13, start.MonthsUntil(MonthRef.Parse("2026-06")));
        Assert.Equal(-2, start.MonthsUntil(MonthRef.Parse("2025-03")));
        Assert.True(start < MonthRef.Parse("2025-06"));
        Assert.Equal(MonthRef.Parse("2026-10"), MonthRef.Of(new DateOnly(2026, 10, 20)));
    }

    [Theory]
    [InlineData("2026-13")]
    [InlineData("2026-00")]
    [InlineData("26-01")]
    public void Parse_recusa_competencia_invalida(string value)
    {
        Assert.False(MonthRef.IsValid(value));
        Assert.Throws<ArgumentException>(() => MonthRef.Parse(value));
    }

    [Theory]
    [InlineData("2026-12-31", 1, "2027-01-01")]
    [InlineData("2026-03-01", -1, "2026-02-28")]
    public void IsoDate_soma_dias(string iso, int days, string expected) =>
        Assert.Equal(expected, IsoDate.Parse(iso).AddDays(days).ToIso());
}
