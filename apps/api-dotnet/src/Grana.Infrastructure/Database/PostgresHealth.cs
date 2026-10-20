using Grana.Application.Health;
using Npgsql;

namespace Grana.Infrastructure.Database;

public sealed class PostgresHealth(NpgsqlDataSource dataSource) : IDatabaseHealth
{
    public async Task PingAsync(CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("SELECT 1");
        await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
    }
}
