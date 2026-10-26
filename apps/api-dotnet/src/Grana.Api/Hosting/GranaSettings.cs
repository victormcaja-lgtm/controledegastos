using System.Globalization;

namespace Grana.Api.Hosting;

/// <summary>
/// Configuração lida das MESMAS variáveis de ambiente da API Node (RNF-09).
/// Falha no boot se algo obrigatório faltar — melhor quebrar ao subir do que em produção.
/// </summary>
public sealed record GranaSettings
{
    public required string Environment { get; init; }

    public bool IsProduction => Environment == "production";

    public required string Host { get; init; }

    public required int Port { get; init; }

    public required string DatabaseUrl { get; init; }

    public required IReadOnlyList<string> CorsOrigins { get; init; }

    /// <summary>API Node para onde a fachada repassa as rotas ainda não migradas.</summary>
    public string? NodeUpstreamUrl { get; init; }

    public static GranaSettings FromEnvironment(Func<string, string?> read)
    {
        ArgumentNullException.ThrowIfNull(read);
        var environment = read("NODE_ENV") ?? "development";
        if (environment is not ("development" or "test" or "production"))
        {
            throw new InvalidOperationException($"NODE_ENV inválido: {environment}");
        }

        var databaseUrl = read("DATABASE_URL");
        if (string.IsNullOrWhiteSpace(databaseUrl)) throw new InvalidOperationException("DATABASE_URL é obrigatória.");

        return new GranaSettings
        {
            Environment = environment,
            Host = read("HOST") ?? "0.0.0.0",
            Port = int.Parse(read("PORT") ?? "3333", CultureInfo.InvariantCulture),
            DatabaseUrl = databaseUrl,
            CorsOrigins = [.. (read("CORS_ORIGINS") ?? "http://localhost:5173")
                .Split(',')
                .Select(origin => origin.Trim().TrimEnd('/'))
                .Where(origin => origin.Length > 0)],
            NodeUpstreamUrl = read("NODE_UPSTREAM_URL"),
        };
    }
}
