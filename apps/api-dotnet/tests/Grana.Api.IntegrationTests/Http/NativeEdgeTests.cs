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
[Collection(SerialApi.Name)]
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

    // Sem Node atrás (T-091): o 404 e o preflight passam a ser do .NET.
    [Theory]
    [InlineData("GET", "/api/nada?x=1&y=%20")]
    [InlineData("PUT", "/health")]
    [InlineData("GET", "/HEALTH")]
    [InlineData("DELETE", "/favicon.ico")]
    public async Task Rota_inexistente_vira_404_com_metodo_e_url_crua_RN012(string method, string url)
    {
        using var client = _api.CreateClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), url);
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(("Not Found", "ROUTE_NOT_FOUND", $"Rota {method} {url} não existe."), (body.GetProperty("error").GetString(), body.GetProperty("code").GetString(), body.GetProperty("message").GetString()));
        Assert.Equal("SAMEORIGIN", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.False(response.Headers.Contains("x-ratelimit-limit"));
    }

    [Fact]
    public async Task Preflight_do_fastify_cors_em_qualquer_caminho()
    {
        using var client = _api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/auth/login");
        request.Headers.Add("Origin", "http://localhost:5173");
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "content-type,authorization");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal("http://localhost:5173", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Equal("GET, POST, PATCH, PUT, DELETE, OPTIONS", response.Headers.GetValues("Access-Control-Allow-Methods").Single());
        Assert.Equal("content-type,authorization", response.Headers.GetValues("Access-Control-Allow-Headers").Single());
        Assert.Equal("86400", response.Headers.GetValues("Access-Control-Max-Age").Single());
        Assert.Equal(["Origin", "Access-Control-Request-Headers"], response.Headers.Vary);
        Assert.False(response.Headers.Contains("x-ratelimit-limit"));
    }

    [Theory]
    [InlineData(null, "GET")]
    [InlineData("http://localhost:5173", null)]
    public async Task Preflight_incompleto_vira_400_em_texto(string? origin, string? method)
    {
        using var client = _api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/settings");
        if (origin is not null) request.Headers.Add("Origin", origin);
        if (method is not null) request.Headers.Add("Access-Control-Request-Method", method);
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("text/plain", response.Content.Headers.ContentType!.ToString());
        Assert.Equal("Invalid Preflight Request", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Preflight_de_origem_recusada_expoe_a_mensagem_sem_code_RN161()
    {
        using var client = _api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/settings");
        request.Headers.Add("Origin", "http://evil.com");
        request.Headers.Add("Access-Control-Request-Method", "GET");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("""{"statusCode":500,"error":"Internal Server Error","message":"Origem não autorizada: http://evil.com"}""", await response.Content.ReadAsStringAsync());
        Assert.False(response.Headers.Contains("Access-Control-Allow-Credentials"));
    }

    [Fact]
    public async Task HEAD_nas_rotas_GET_como_o_exposeHeadRoutes()
    {
        using var client = _api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Head, "/health");
        var response = await client.SendAsync(request);
        // O corpo é descartado pelo Kestrel (o TestServer não o faz).
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
