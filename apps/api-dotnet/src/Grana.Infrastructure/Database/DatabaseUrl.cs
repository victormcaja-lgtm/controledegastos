using Npgsql;

namespace Grana.Infrastructure.Database;

/// <summary>
/// Converte a <c>DATABASE_URL</c> no formato da Railway/Prisma
/// (<c>postgresql://user:senha@host:porta/banco?schema=public</c>) para a string
/// de conexão do Npgsql. Mesma variável de ambiente do Node (RNF-09).
/// </summary>
public static class DatabaseUrl
{
    public static string ToConnectionString(string databaseUrl)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databaseUrl);
        if (!databaseUrl.StartsWith("postgres", StringComparison.OrdinalIgnoreCase)) return databaseUrl;

        var uri = new Uri(databaseUrl);
        var credentials = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort || uri.Port <= 0 ? 5432 : uri.Port,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            Username = Uri.UnescapeDataString(credentials[0]),
            Password = credentials.Length > 1 ? Uri.UnescapeDataString(credentials[1]) : null,
        };

        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = pair.Split('=', 2);
            var key = Uri.UnescapeDataString(parts[0]);
            var value = parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : string.Empty;
            switch (key)
            {
                case "schema":
                    builder.SearchPath = value;
                    break;
                case "sslmode":
                    builder.SslMode = Enum.Parse<SslMode>(value, ignoreCase: true);
                    break;
                default:
                    break; // parâmetros do Prisma (connection_limit etc.) não se aplicam
            }
        }

        return builder.ConnectionString;
    }
}
