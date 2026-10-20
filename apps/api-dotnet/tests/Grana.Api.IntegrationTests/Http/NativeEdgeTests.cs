using System.Net;
using System.Text.Json;
using Grana.Application.Health;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Grana.Api.IntegrationTests.Http;

/// <summary>
/// Borda das rotas atendidas pelo .NET, com os valores caracterizados na API
/// Node em modo produção (tests/paridade/specs/01 e 12). Sem banco nem Node: o
/// health check usa uma porta falsa e não há fachada configurada.
/// </summary>
public sealed class NativeEdgeTests : IClassFixture<NativeEdgeTests.Api>
{
    private readonly Api _api;

    public NativeEdgeTests(Api api) => _api = api;

    public sealed class Api : WebApplicationFactory<Program>
    {
        public static bool DatabaseUp { get; set; } = true;

        static Api()
        {
            Environment.SetEnvironmentVariable("NODE_ENV", "production");
            Environment.SetEnvironmentVariable("DATABASE_URL", "postgresql://u:p@localhost:5432/x");
            Environment.SetEnvironmentVariable("CORS_ORIGINS", "http://localhost:5173/");
            Environment.SetEnvironmentVariable("NODE_UPSTREAM_URL", null);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder) =>
            builder.ConfigureServices(services => services.AddSingleton<IDatabaseHealth>(new FakeHealth()));

        private sealed class FakeHealth : IDatabaseHealth
        {
            public Task PingAsync(CancellationToken cancellationToken) =>
                DatabaseUp ? Task.CompletedTask : throw new InvalidOperationException("banco fora");
        }
    }

    [Fact]
    public async Task Health_responde_e_traz_os_cabecalhos_do_helmet_e_do_cors()
    {
        using var client = _api.CreateClient();
        var response = await client.GetAsync(new Uri("/health", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("ok", body.GetProperty("status").GetString());
        Assert.Equal("up", body.GetProperty("database").GetString());
        Assert.Equal(JsonValueKind.Number, body.GetProperty("uptime").ValueKind);

        Assert.Equal("application/json; charset=utf-8", response.Content.Headers.ContentType!.ToString());
        Assert.Equal("true", response.Headers.GetValues("Access-Control-Allow-Credentials").Single());
        Assert.Equal("Origin", response.Headers.Vary.Single());
        Assert.StartsWith("default-src 'self';", response.Headers.GetValues("Content-Security-Policy").Single(), StringComparison.Ordinal);
        Assert.Equal("SAMEORIGIN", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("0", response.Headers.GetValues("X-XSS-Protection").Single());
        Assert.False(response.Headers.Contains("Server"));
    }

    [Fact]
    public async Task Origem_da_lista_recebe_allow_origin_mesmo_com_barra_final_na_config()
    {
        using var client = _api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", "http://localhost:5173");
        var response = await client.SendAsync(request);
        Assert.Equal("http://localhost:5173", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Fact]
    public async Task Origem_fora_da_lista_vira_500_generico_RN161()
    {
        using var client = _api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", "https://grana-abc.vercel.app");
        request.Headers.Add("X-Request-Id", "req-123");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal(
            "{\"statusCode\":500,\"error\":\"Internal Server Error\",\"code\":\"INTERNAL_ERROR\"," +
            "\"message\":\"Algo deu errado do nosso lado. Tente novamente em instantes.\",\"requestId\":\"req-123\"}",
            await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Banco_fora_vira_500_generico()
    {
        Api.DatabaseUp = false;
        try
        {
            using var client = _api.CreateClient();
            var response = await client.GetAsync(new Uri("/health", UriKind.Relative));
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            Assert.Contains("\"code\":\"INTERNAL_ERROR\"", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
        finally
        {
            Api.DatabaseUp = true;
        }
    }
}
