using Grana.Api.Endpoints;
using Grana.Api.Hosting;
using Grana.Api.Http;
using Grana.Api.Json;
using Grana.Api.Strangler;
using Grana.Application.Health;
using Grana.Infrastructure.Database;
using Npgsql;

var settings = GranaSettings.FromEnvironment(Environment.GetEnvironmentVariable);

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://{settings.Host}:{settings.Port}");
builder.WebHost.ConfigureKestrel(options =>
{
    // O Node não envia "Server"; corpo de até 1 MB como no Fastify (RN-017).
    options.AddServerHeader = false;
    options.Limits.MaxRequestBodySize = 1_048_576;
});

builder.Services.AddSingleton(settings);
builder.Services.ConfigureHttpJsonOptions(options => GranaJson.Configure(options.SerializerOptions));
builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(DatabaseUrl.ToConnectionString(settings.DatabaseUrl)));
builder.Services.AddSingleton<IDatabaseHealth, PostgresHealth>();

if (settings.NodeUpstreamUrl is { Length: > 0 } upstream) builder.Services.AddNodeFallback(upstream);

var app = builder.Build();

app.UseRouting();
app.UseMiddleware<NativeEdgeMiddleware>();

app.MapHealth();
if (settings.NodeUpstreamUrl is { Length: > 0 }) app.MapReverseProxy();

await app.RunAsync().ConfigureAwait(false);

/// <summary>Ponto de entrada (exposto para os testes de integração).</summary>
public partial class Program;
