using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Grana.Api.IntegrationTests.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Grana.Api.IntegrationTests.Http;

/// <summary>
/// As variáveis de ambiente são do processo: as fábricas da API rodam em série.
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class SerialApi
{
    public const string Name = "api";
}

/// <summary>
/// Rotas do M1 dentro do processo, contra um Postgres com as migrations do Prisma:
/// ciclo validação → autenticação → handler, status de resposta e erros da borda.
/// O critério de paridade continua sendo a suíte tests/paridade contra a fachada.
/// </summary>
[Collection(SerialApi.Name)]
public sealed class NativeFinanceRoutesTests : IAsyncLifetime, IDisposable
{
    private const string Secret = "segredo-de-teste-com-mais-de-32-caracteres!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine").Build();
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();
        await using (var raw = NpgsqlDataSource.Create(_postgres.GetConnectionString()))
        {
            foreach (var migration in Directory.GetDirectories(Path.Combine(SchemaMappingTests.RepoRoot(), "apps", "api", "prisma", "migrations")).Order(StringComparer.Ordinal))
            {
                await using var command = raw.CreateCommand(await File.ReadAllTextAsync(Path.Combine(migration, "migration.sql")));
                await command.ExecuteNonQueryAsync();
            }

            await using var seed = raw.CreateCommand("""
                INSERT INTO users (id,name,email,"passwordHash","updatedAt") VALUES ('u1','Ana','ana@x.y','h',NOW()), ('u2','Bia','bia@x.y','h',NOW());
                INSERT INTO categories (id,"userId",name,color,kind,"isSystem","updatedAt") VALUES ('sys-mercado','u1','Mercado','oklch(0.62 0.10 145)','EXPENSE',true,NOW());
                """);
            await seed.ExecuteNonQueryAsync();
        }

        var builder = new NpgsqlConnectionStringBuilder(_postgres.GetConnectionString());
        Environment.SetEnvironmentVariable("NODE_ENV", "production");
        Environment.SetEnvironmentVariable("DATABASE_URL", $"postgresql://{builder.Username}:{builder.Password}@{builder.Host}:{builder.Port}/{builder.Database}");
        Environment.SetEnvironmentVariable("CORS_ORIGINS", "http://localhost:5173");
        Environment.SetEnvironmentVariable("NODE_UPSTREAM_URL", null);
        Environment.SetEnvironmentVariable("JWT_ACCESS_SECRET", Secret);
        Environment.SetEnvironmentVariable("RATE_LIMIT_MAX", "10");
        foreach (var module in new[] { "Settings", "Incomes", "Categories", "Transactions" }) Environment.SetEnvironmentVariable($"Strangler__Modules__{module}", "dotnet");

        _factory = new WebApplicationFactory<Program>();
        _client = _factory.CreateClient();

        foreach (var module in new[] { "Settings", "Incomes", "Categories", "Transactions" }) Environment.SetEnvironmentVariable($"Strangler__Modules__{module}", null);
        Environment.SetEnvironmentVariable("JWT_ACCESS_SECRET", null);
        Environment.SetEnvironmentVariable("RATE_LIMIT_MAX", null);
    }

    public async Task DisposeAsync()
    {
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private static string Token(string sub)
    {
        static string B64(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var header = B64(Encoding.UTF8.GetBytes("""{"alg":"HS256","typ":"JWT"}"""));
        var exp = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 900;
        var payload = B64(Encoding.UTF8.GetBytes($$"""{"sub":"{{sub}}","email":"x@y.z","role":"USER","exp":{{exp}}}"""));
        var signature = B64(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret), Encoding.ASCII.GetBytes($"{header}.{payload}")));
        return $"{header}.{payload}.{signature}";
    }

    private static int _ip;

    private async Task<(HttpStatusCode Status, JsonElement Body, HttpResponseMessage Response)> Send(
        HttpMethod method, string path, object? body = null, string? user = "u1", string? rawJson = null, string? ip = null)
    {
        using var request = new HttpRequestMessage(method, new Uri(path, UriKind.Relative));
        request.Headers.Add("x-forwarded-for", ip ?? $"10.0.{Interlocked.Increment(ref _ip) / 250}.{_ip % 250}");
        if (user is not null) request.Headers.Add("authorization", $"Bearer {Token(user)}");
        if (rawJson is not null) request.Content = new StringContent(rawJson, Encoding.UTF8, "application/json");
        else if (body is not null) request.Content = JsonContent.Create(body);
        var response = await _client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, text.Length > 0 ? JsonDocument.Parse(text).RootElement.Clone() : default, response);
    }

    [Fact]
    public async Task Ajustes_padroes_patch_e_erros()
    {
        var (status, body, response) = await Send(HttpMethod.Get, "/api/settings");
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("""{"overspendAlerts":true,"weeklySummary":true,"roundCents":false,"autoDarkMode":false,"showDailyAllowance":true,"openingBalanceCents":0,"openingDate":null,"dailyBudgetCents":null}""", body.GetRawText());
        Assert.Equal("10", response.Headers.GetValues("x-ratelimit-limit").Single());

        var patched = await Send(HttpMethod.Patch, "/api/settings", new { roundCents = true, openingDate = "2026-02-31", dailyBudgetCents = 0 });
        Assert.Equal(HttpStatusCode.OK, patched.Status);
        Assert.Equal(("2026-03-03", 0, true), (patched.Body.GetProperty("openingDate").GetString(), patched.Body.GetProperty("dailyBudgetCents").GetInt32(), patched.Body.GetProperty("roundCents").GetBoolean()));

        var future = await Send(HttpMethod.Patch, "/api/settings", new { openingDate = DateTime.UtcNow.AddDays(3).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture) });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "BusinessRuleError"), (future.Status, future.Body.GetProperty("error").GetString()));

        var empty = await Send(HttpMethod.Patch, "/api/settings", new { });
        Assert.Equal(HttpStatusCode.BadRequest, empty.Status);
        Assert.Equal("Nada para atualizar.", empty.Body.GetProperty("details")[0].GetProperty("message").GetString());

        var overflow = await Send(HttpMethod.Patch, "/api/settings", new { openingBalanceCents = 9_000_000_000 });
        Assert.Equal(HttpStatusCode.InternalServerError, overflow.Status);
        Assert.Equal("Algo deu errado do nosso lado. Tente novamente em instantes.", overflow.Body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Entradas_crud_404_e_validacao_antes_da_autenticacao()
    {
        var created = await Send(HttpMethod.Post, "/api/incomes", new { name = "  Salário ", amountCents = 500_000, receiptDay = 5, hacker = true });
        Assert.Equal(HttpStatusCode.Created, created.Status);
        var id = created.Body.GetProperty("id").GetString();
        Assert.Equal($$"""{"id":"{{id}}","name":"Salário","amountCents":500000,"receiptDay":5,"active":true}""", created.Body.GetRawText());

        var updated = await Send(HttpMethod.Patch, $"/api/incomes/{id}", new { active = false, receiptDay = 7 });
        Assert.Equal((false, 7), (updated.Body.GetProperty("active").GetBoolean(), updated.Body.GetProperty("receiptDay").GetInt32()));

        var list = await Send(HttpMethod.Get, "/api/incomes");
        Assert.Equal(id, list.Body[0].GetProperty("id").GetString());
        Assert.Equal(0, (await Send(HttpMethod.Get, "/api/incomes", user: "u2")).Body.GetArrayLength());

        var foreign = await Send(HttpMethod.Patch, $"/api/incomes/{id}", new { name = "Roubado" }, user: "u2");
        Assert.Equal((HttpStatusCode.NotFound, "Entrada não encontrado."), (foreign.Status, foreign.Body.GetProperty("message").GetString()));

        Assert.Equal(HttpStatusCode.NoContent, (await Send(HttpMethod.Delete, $"/api/incomes/{id}")).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(HttpMethod.Delete, $"/api/incomes/{id}")).Status);

        var invalidNoToken = await Send(HttpMethod.Post, "/api/incomes", new { }, user: null);
        Assert.Equal(HttpStatusCode.BadRequest, invalidNoToken.Status);
        var validNoToken = await Send(HttpMethod.Post, "/api/incomes", new { name = "Ok", amountCents = 1, receiptDay = 1 }, user: null);
        Assert.Equal((HttpStatusCode.Unauthorized, "Sessão inválida ou expirada."), (validNoToken.Status, validNoToken.Body.GetProperty("message").GetString()));

        var badId = await Send(HttpMethod.Delete, "/api/incomes/x");
        Assert.Equal("id", badId.Body.GetProperty("details")[0].GetProperty("path").GetString());

        var malformed = await Send(HttpMethod.Post, "/api/incomes", rawJson: """{"name":""");
        Assert.Equal(("FastifyError", "FST_ERR_CTP_INVALID_JSON_BODY"), (malformed.Body.GetProperty("error").GetString(), malformed.Body.GetProperty("code").GetString()));
    }

    [Fact]
    public async Task Categorias_cor_conflito_arquivo_e_exclusao()
    {
        var created = await Send(HttpMethod.Post, "/api/categories", new { name = "Pets" });
        Assert.Equal(HttpStatusCode.Created, created.Status);
        Assert.Equal(("oklch(0.62 0.10 300)", "EXPENSE", false), (created.Body.GetProperty("color").GetString(), created.Body.GetProperty("kind").GetString(), created.Body.GetProperty("isSystem").GetBoolean()));
        var id = created.Body.GetProperty("id").GetString();

        var clash = await Send(HttpMethod.Post, "/api/categories", new { name = "mercado" });
        Assert.Equal((HttpStatusCode.Conflict, "ConflictError"), (clash.Status, clash.Body.GetProperty("error").GetString()));
        Assert.Equal(HttpStatusCode.Created, (await Send(HttpMethod.Post, "/api/categories", new { name = "Mercado", kind = "INCOME", color = "#ABCDEF" })).Status);

        var archived = await Send(HttpMethod.Patch, $"/api/categories/{id}", new { archived = true, name = "PETS" });
        Assert.EndsWith("Z", archived.Body.GetProperty("archivedAt").GetString(), StringComparison.Ordinal);
        Assert.DoesNotContain("PETS", (await Send(HttpMethod.Get, "/api/categories")).Body.GetRawText(), StringComparison.Ordinal);
        Assert.Contains("PETS", (await Send(HttpMethod.Get, "/api/categories?includeArchived=false")).Body.GetRawText(), StringComparison.Ordinal);

        var system = await Send(HttpMethod.Delete, "/api/categories/sys-mercado");
        Assert.Equal("Categorias padrão não podem ser excluídas — apenas arquivadas.", system.Body.GetProperty("message").GetString());
        Assert.Equal(HttpStatusCode.NoContent, (await Send(HttpMethod.Delete, $"/api/categories/{id}")).Status);
    }

    [Fact]
    public async Task Lancamentos_crud_lista_e_regras_da_categoria()
    {
        var created = await Send(HttpMethod.Post, "/api/transactions", new { type = "EXPENSE", amountCents = 1250, categoryId = "sys-mercado", occurredOn = "2026-02-31", note = "  feira  " });
        Assert.Equal(HttpStatusCode.Created, created.Status);
        var id = created.Body.GetProperty("id").GetString();
        Assert.Equal(("2026-03-03", "feira", "Mercado"), (created.Body.GetProperty("occurredOn").GetString(), created.Body.GetProperty("note").GetString(), created.Body.GetProperty("category").GetProperty("name").GetString()));
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", created.Body.GetProperty("createdAt").GetString());

        var wrongType = await Send(HttpMethod.Post, "/api/transactions", new { type = "INCOME", amountCents = 1, categoryId = "sys-mercado", occurredOn = "2026-01-01" });
        Assert.Equal("Escolha uma categoria de entrada para um recebimento.", wrongType.Body.GetProperty("message").GetString());

        var list = await Send(HttpMethod.Get, "/api/transactions?month=2026-03&perPage=5");
        var day = list.Body.GetProperty("groups")[0];
        Assert.Equal(("03 de março", 1250, "1 lançamento · R$ 12,50 em gastos"), (
            day.GetProperty("label").GetString(), day.GetProperty("totalCents").GetInt32(), list.Body.GetProperty("summary").GetString()));
        Assert.Equal(["items", "groups", "page", "perPage", "total", "totalPages", "summary"], list.Body.EnumerateObject().Select(p => p.Name));

        var edited = await Send(HttpMethod.Patch, $"/api/transactions/{id}", new { note = (string?)null, amountCents = 99 });
        Assert.Equal((JsonValueKind.Null, 99), (edited.Body.GetProperty("note").ValueKind, edited.Body.GetProperty("amountCents").GetInt32()));
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Patch, $"/api/transactions/{id}", new { type = "INCOME" })).Status);

        Assert.Equal(HttpStatusCode.NoContent, (await Send(HttpMethod.Delete, $"/api/transactions/{id}")).Status);
        Assert.Equal("Lançamento não encontrado.", (await Send(HttpMethod.Delete, $"/api/transactions/{id}")).Body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Rate_limit_global_e_health_de_fora()
    {
        const string ip = "203.0.113.9";
        for (var index = 0; index < 10; index++) Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Get, "/api/settings", ip: ip)).Status);
        var (status, body, response) = await Send(HttpMethod.Get, "/api/settings", ip: ip);
        Assert.Equal(HttpStatusCode.TooManyRequests, status);
        Assert.Equal(("Error", "RATE_LIMITED"), (body.GetProperty("error").GetString(), body.GetProperty("code").GetString()));
        Assert.True(response.Headers.Contains("Retry-After"));
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Get, "/health", ip: ip)).Status);
    }

    [Fact]
    public async Task Caixa_alta_e_barra_final_nao_casam_com_a_rota_nativa()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Send(HttpMethod.Get, "/API/settings")).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(HttpMethod.Get, "/api/settings/")).Status);
    }
}
