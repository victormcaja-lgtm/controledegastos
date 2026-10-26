using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Grana.Api.Json;

/// <summary>
/// Serialização JSON igual à da API Node: camelCase, <c>null</c> sempre
/// presente e datas no formato que o front espera (RF-01.8, R-04).
/// </summary>
public static class GranaJson
{
    public static void Configure(JsonSerializerOptions options)
    {
        options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.DictionaryKeyPolicy = JsonNamingPolicy.CamelCase;
        options.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
        // As frases têm acentos e "−" (U+2212): o Node os envia sem escapar.
        options.Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping;
        options.Converters.Add(new UtcDateTimeConverter());
        options.Converters.Add(new IsoDateOnlyConverter());
    }

    public static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Configure(options);
        return options;
    }
}

/// <summary>
/// Data-hora como o <c>Date.toISOString()</c> do JavaScript: UTC, 3 casas de
/// milissegundo (truncadas) e <c>Z</c> — o .NET emitiria 7 casas.
/// </summary>
public sealed class UtcDateTimeConverter : JsonConverter<DateTime>
{
    public const string Format = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        DateTime.Parse(reader.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(writer);
        var utc = value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : DateTime.SpecifyKind(value, DateTimeKind.Utc);
        var truncated = new DateTime(utc.Ticks - (utc.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Utc);
        writer.WriteStringValue(truncated.ToString(Format, CultureInfo.InvariantCulture));
    }
}

/// <summary>Data pura como <c>AAAA-MM-DD</c>.</summary>
public sealed class IsoDateOnlyConverter : JsonConverter<DateOnly>
{
    public override DateOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        DateOnly.ParseExact(reader.GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    public override void Write(Utf8JsonWriter writer, DateOnly value, JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(writer);
        writer.WriteStringValue(value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    }
}
