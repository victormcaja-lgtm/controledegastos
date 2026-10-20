namespace Grana.Domain.Common;

/// <summary>
/// Aritmética com a mesma semântica do JavaScript da API Node (R-03).
/// O <c>Math.Round</c> do .NET usa arredondamento bancário; o <c>Math.round</c>
/// do JS arredonda o meio para +∞ (2,5 → 3; −2,5 → −2).
/// </summary>
public static class JsMath
{
    /// <summary>Equivalente ao <c>Math.round</c> do JavaScript.</summary>
    public static double Round(double value)
    {
        var floor = Math.Floor(value);
        return value - floor >= 0.5 ? floor + 1 : floor;
    }

    /// <summary><c>Math.round</c> devolvendo inteiro de 64 bits.</summary>
    public static long RoundToLong(double value) => (long)Round(value);

    /// <summary>
    /// Percentual seguro de packages/shared (<c>percentOf</c>): nunca divide por
    /// zero e fica entre 0 e 100. A ordem das operações em ponto flutuante é a mesma do JS.
    /// </summary>
    public static int PercentOf(long part, long total)
    {
        if (total <= 0) return 0;
        var percent = Round((double)part / total * 100);
        return (int)Math.Min(100, Math.Max(0, percent));
    }
}
