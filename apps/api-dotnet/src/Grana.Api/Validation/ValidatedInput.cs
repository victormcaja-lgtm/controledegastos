using Grana.Domain.Common;

namespace Grana.Api.Validation;

/// <summary>
/// Leitura tipada da saída de um schema (o objeto que o Zod devolve). Os campos
/// ausentes viram <see cref="Patch{T}"/> não definido; os presentes, inclusive com
/// <c>null</c>, viram <see cref="Patch.Set{T}(T)"/>.
/// </summary>
public static class ValidatedInput
{
    public static string Text(this JsObject data, string key) => ((JsString)Require(data, key)).Value;

    public static string? TextOrNull(this JsObject data, string key) => data[key] is JsString text ? text.Value : null;

    public static bool Flag(this JsObject data, string key) => ((JsBoolean)Require(data, key)).Value;

    /// <summary>
    /// Inteiro de uma coluna <c>INTEGER</c>. O contrato aceita até 10¹⁰ centavos, mais do que
    /// a coluna comporta: fora do int32, estoura e vira o 500 genérico, como o erro do Prisma
    /// (RN-002 ⚠️). Nunca trunca em silêncio.
    /// </summary>
    public static int Int32Column(this JsObject data, string key) => ToInt32(((JsNumber)Require(data, key)).Value);

    /// <summary>Inteiro seguro do JavaScript (até 2⁵³−1), como <c>page</c> e <c>perPage</c>.</summary>
    public static long SafeInteger(this JsObject data, string key) => (long)((JsNumber)Require(data, key)).Value;

    public static Patch<string> OptionalText(this JsObject data, string key) =>
        Has(data, key) ? Patch.Set(data.Text(key)) : default;

    public static Patch<string?> OptionalTextOrNull(this JsObject data, string key) =>
        Has(data, key) ? Patch.Set(data.TextOrNull(key)) : default;

    public static Patch<bool> OptionalFlag(this JsObject data, string key) =>
        Has(data, key) ? Patch.Set(data.Flag(key)) : default;

    public static Patch<int> OptionalInt32Column(this JsObject data, string key) =>
        Has(data, key) ? Patch.Set(data.Int32Column(key)) : default;

    public static Patch<int?> OptionalInt32ColumnOrNull(this JsObject data, string key) =>
        Has(data, key) ? Patch.Set(data[key] is JsNumber number ? ToInt32(number.Value) : (int?)null) : default;

    private static int ToInt32(double value) =>
        value is >= int.MinValue and <= int.MaxValue
            ? (int)value
            : throw new OverflowException($"Valor fora do INTEGER do Postgres: {value}.");

    private static bool Has(JsObject data, string key) =>
        data.Properties.Any(property => property.Key == key && property.Value is not JsUndefined);

    private static JsValue Require(JsObject data, string key) =>
        Has(data, key) ? data[key] : throw new InvalidOperationException($"Campo obrigatório ausente depois da validação: {key}.");
}
