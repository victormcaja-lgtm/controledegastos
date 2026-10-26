using System.Diagnostics;
using Grana.Api.Http;
using Grana.Application.Health;
using Grana.Domain.Common;

namespace Grana.Api.Endpoints;

/// <summary>
/// <c>GET /health</c> (RN-018): toca o banco e responde
/// <c>{status:"ok", uptime:&lt;segundos&gt;, database:"up"}</c>. Fora do rate limit.
/// Um health check que não toca o banco mente.
/// </summary>
public static class HealthEndpoint
{
    private static readonly Stopwatch Uptime = Stopwatch.StartNew();

    public static void MapHealth(this IEndpointRouteBuilder routes) =>
        routes.MapGet("/health", async (IDatabaseHealth database, CancellationToken cancellationToken) =>
            {
                await database.PingAsync(cancellationToken).ConfigureAwait(false);
                return Results.Json(new
                {
                    status = "ok",
                    uptime = (long)JsMath.Round(Uptime.Elapsed.TotalSeconds),
                    database = "up",
                });
            })
            .WithMetadata(new NativeEndpointMetadata());
}
