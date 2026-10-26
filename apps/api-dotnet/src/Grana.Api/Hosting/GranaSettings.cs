using System.Globalization;

namespace Grana.Api.Hosting;

/// <summary>
/// Configuração lida das MESMAS variáveis de ambiente da API Node (RNF-09).
/// Falha no boot se algo obrigatório faltar — melhor quebrar ao subir do que em produção.
/// </summary>
public sealed record GranaSettings
{
    /// <summary>
    /// Módulos do Strangler (plano.md §6.2), na ordem de migração. Cada um vale
    /// <c>node</c> (padrão: repassado ao Node) ou <c>dotnet</c> (atendido aqui) pela
    /// variável <c>Strangler__Modules__&lt;Módulo&gt;</c>. Voltar um módulo para o Node
    /// é trocar a variável e reiniciar.
    /// </summary>
    public static readonly IReadOnlyList<string> Modules = ["Settings", "Incomes", "Categories", "Transactions"];

    public required string Environment { get; init; }

    public bool IsProduction => Environment == "production";

    public required string Host { get; init; }

    public required int Port { get; init; }

    public required string DatabaseUrl { get; init; }

    public required IReadOnlyList<string> CorsOrigins { get; init; }

    /// <summary>API Node para onde a fachada repassa as rotas ainda não migradas.</summary>
    public string? NodeUpstreamUrl { get; init; }

    /// <summary>Segredo do access token, o MESMO do Node (R-02). Obrigatório com algum módulo em <c>dotnet</c>.</summary>
    public string? JwtAccessSecret { get; init; }

    /// <summary>Rate limit global por IP e por minuto (RN-015).</summary>
    public int RateLimitMax { get; init; } = 200;

    /// <summary>Saltos de proxy confiáveis no <c>X-Forwarded-For</c> (RN-162, D-02).</summary>
    public int TrustProxyHops { get; init; } = 1;

    /// <summary>Módulos atendidos pelo .NET.</summary>
    public IReadOnlySet<string> NativeModules { get; init; } = new HashSet<string>(StringComparer.Ordinal);

    public bool IsNative(string module) => NativeModules.Contains(module);

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

        var native = new HashSet<string>(StringComparer.Ordinal);
        foreach (var module in Modules)
        {
            var value = read($"Strangler__Modules__{module}")?.Trim() ?? "node";
            if (value is not ("node" or "dotnet"))
            {
                throw new InvalidOperationException($"Strangler__Modules__{module} precisa ser \"node\" ou \"dotnet\" (veio \"{value}\").");
            }

            if (value == "dotnet") native.Add(module);
        }

        var secret = read("JWT_ACCESS_SECRET");
        if (native.Count > 0 && (secret is null || secret.Length < 32))
        {
            throw new InvalidOperationException("JWT_ACCESS_SECRET precisa ter ao menos 32 caracteres.");
        }

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
            JwtAccessSecret = secret,
            RateLimitMax = IntInRange(read, "RATE_LIMIT_MAX", 200, minimum: 10, maximum: int.MaxValue),
            TrustProxyHops = IntInRange(read, "TRUST_PROXY_HOPS", 1, minimum: 0, maximum: 10),
            NativeModules = native,
        };
    }

    private static int IntInRange(Func<string, string?> read, string name, int fallback, int minimum, int maximum)
    {
        var raw = read(name);
        if (string.IsNullOrWhiteSpace(raw)) return fallback;
        if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) || value < minimum || value > maximum)
        {
            throw new InvalidOperationException($"{name} inválido: {raw}");
        }

        return value;
    }
}
