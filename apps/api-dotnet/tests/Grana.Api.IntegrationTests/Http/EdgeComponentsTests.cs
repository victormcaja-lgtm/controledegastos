using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Grana.Api.Hosting;
using Grana.Api.Http;
using Grana.Api.Validation;
using Grana.Domain.Common;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing.Patterns;

namespace Grana.Api.IntegrationTests.Http;

/// <summary>
/// Peças da borda nativa do M1, com os valores caracterizados no Node
/// (@fastify/jwt + fast-jwt, @fastify/rate-limit, proxy-addr, content-type parsers).
/// </summary>
public class EdgeComponentsTests
{
    private const string Secret = "segredo-de-teste-com-mais-de-32-caracteres!";
    private static readonly DateTimeOffset Now = new(2026, 10, 26, 12, 0, 0, TimeSpan.Zero);

    private sealed class ManualTime(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static string B64(string value) => Convert.ToBase64String(Encoding.UTF8.GetBytes(value)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string Token(object payload, string alg = "HS256", string secret = Secret)
    {
        var header = B64(JsonSerializer.Serialize(new { alg, typ = "JWT" }));
        var body = B64(JsonSerializer.Serialize(payload));
        var key = Encoding.UTF8.GetBytes(secret);
        var input = Encoding.ASCII.GetBytes($"{header}.{body}");
        var signature = alg switch
        {
            "HS384" => HMACSHA384.HashData(key, input),
            "HS512" => HMACSHA512.HashData(key, input),
            _ => HMACSHA256.HashData(key, input),
        };
        return $"{header}.{body}.{Convert.ToBase64String(signature).TrimEnd('=').Replace('+', '-').Replace('/', '_')}";
    }

    private static readonly long Exp = Now.ToUnixTimeSeconds() + 900;

    /* ─────────────────────────── Access token ─────────────────────────── */

    [Theory]
    [InlineData("HS256")]
    [InlineData("HS384")]
    [InlineData("HS512")]
    public void Aceita_os_tres_HMAC_com_o_segredo_compartilhado(string alg)
    {
        var actor = new AccessToken(Secret, new ManualTime(Now)).TryVerify($"Bearer {Token(new { sub = "u1", email = "a@b.c", role = "USER", exp = Exp }, alg)}");
        Assert.Equal(("u1", "a@b.c", "USER"), (actor!.UserId, actor.Email, actor.Role));
    }

    [Fact]
    public void Esquema_Bearer_sem_diferenciar_maiusculas_e_iss_opcional_ou_grana_api()
    {
        var tokens = new AccessToken(Secret, new ManualTime(Now));
        Assert.NotNull(tokens.TryVerify($"bearer {Token(new { sub = "u1", exp = Exp })}"));
        Assert.NotNull(tokens.TryVerify($"BEARER {Token(new { sub = "u1", iss = "grana-api" })}"));
    }

    public static TheoryData<string?> Recusados => new()
    {
        null,
        string.Empty,
        $"Bearer {Token(new { sub = "u1", exp = Exp })} extra",
        $"Token {Token(new { sub = "u1", exp = Exp })}",
        $"Bearer  {Token(new { sub = "u1", exp = Exp })}",
        $"Bearer {Token(new { sub = "u1", exp = Exp }, secret: "outro-segredo-qualquer-com-mais-de-32-caracteres")}",
        $"Bearer {Token(new { sub = "u1", exp = Exp }, alg: "none")}",
        $"Bearer {Token(new { sub = "u1", exp = Now.ToUnixTimeSeconds() - 1 })}",
        $"Bearer {Token(new { sub = "u1", nbf = Now.ToUnixTimeSeconds() + 1 })}",
        $"Bearer {Token(new { sub = "u1", iss = "outra-api" })}",
        $"Bearer {Token(new { sub = "u1", exp = "amanhã" })}",
        $"Bearer {Token(new { email = "sem-sub@x.y" })}",
        $"Bearer {Token(new { sub = 42 })}",
        $"Bearer {Token("texto")}",
        "Bearer a.b",
        "Bearer !!!.@@@.###",
    };

    [Theory]
    [MemberData(nameof(Recusados))]
    public void Recusa_com_401_padrao(string? authorization)
    {
        var tokens = new AccessToken(Secret, new ManualTime(Now));
        Assert.Null(tokens.TryVerify(authorization));
        var error = Assert.Throws<UnauthorizedError>(() => tokens.Authenticate(authorization));
        Assert.Equal("Sessão inválida ou expirada.", error.Message);
    }

    [Fact]
    public void Exp_vale_ate_o_proprio_segundo()
    {
        var token = $"Bearer {Token(new { sub = "u1", exp = Now.ToUnixTimeSeconds() })}";
        Assert.NotNull(new AccessToken(Secret, new ManualTime(Now)).TryVerify(token));
        Assert.Null(new AccessToken(Secret, new ManualTime(Now.AddMilliseconds(1))).TryVerify(token));
    }

    /* ──────────────────────────── Rate limit ──────────────────────────── */

    [Fact]
    public void Janela_fixa_a_partir_da_primeira_requisicao()
    {
        var time = new ManualTime(Now);
        var limiter = new RateLimiter(2, TimeSpan.FromMinutes(1), time);

        Assert.Equal(new RateLimiter.Decision(true, 1, 60), limiter.Hit("ip"));
        time.Now = Now.AddSeconds(10.5);
        Assert.Equal(new RateLimiter.Decision(true, 0, 50), limiter.Hit("ip"));
        var blocked = limiter.Hit("ip");
        Assert.Equal(new RateLimiter.Decision(false, 0, 50), blocked);
        Assert.Equal("Muitas requisições. Tente de novo em 50s.", blocked.ToError().Message);
        Assert.Equal((429, "Error", "RATE_LIMITED"), (blocked.ToError().StatusCode, blocked.ToError().Error, blocked.ToError().Code));

        Assert.True(limiter.Hit("outro-ip").Allowed);
        time.Now = Now.AddMinutes(1);
        Assert.Equal(new RateLimiter.Decision(true, 1, 60), limiter.Hit("ip"));
    }

    [Fact]
    public void Cabecalhos_do_plugin_e_retry_after_so_no_429()
    {
        var allowed = new DefaultHttpContext().Response.Headers;
        new RateLimiter.Decision(true, 199, 60).WriteHeaders(allowed, 200);
        Assert.Equal(("200", "199", "60"), (allowed["x-ratelimit-limit"].ToString(), allowed["x-ratelimit-remaining"].ToString(), allowed["x-ratelimit-reset"].ToString()));
        Assert.False(allowed.ContainsKey("Retry-After"));

        var blocked = new DefaultHttpContext().Response.Headers;
        new RateLimiter.Decision(false, 0, 51).WriteHeaders(blocked, 200);
        Assert.Equal("51", blocked.RetryAfter.ToString());
    }

    [Fact]
    public void Limpa_contadores_vencidos_quando_a_tabela_cresce()
    {
        var time = new ManualTime(Now);
        var limiter = new RateLimiter(5, TimeSpan.FromMinutes(1), time);
        for (var index = 0; index <= 10_001; index++) limiter.Hit($"ip-{index}");
        time.Now = Now.AddMinutes(2);
        Assert.Equal(new RateLimiter.Decision(true, 4, 60), limiter.Hit("ip-1"));
    }

    [Theory]
    [InlineData("10.0.0.1", null, 1, "10.0.0.1")]
    [InlineData("10.0.0.1", "1.1.1.1", 1, "1.1.1.1")]
    [InlineData("10.0.0.1", "6.6.6.6, 1.1.1.1", 1, "1.1.1.1")]
    [InlineData("10.0.0.1", "6.6.6.6, 1.1.1.1", 2, "6.6.6.6")]
    [InlineData("10.0.0.1", "6.6.6.6, 1.1.1.1", 5, "6.6.6.6")]
    [InlineData("10.0.0.1", "6.6.6.6", 0, "10.0.0.1")]
    public void Ip_do_cliente_pula_os_saltos_confiaveis_pela_direita(string socket, string? forwarded, int hops, string expected) =>
        Assert.Equal(expected, ClientIp.Resolve(socket, forwarded, hops));

    /* ──────────────────────────── Corpo ──────────────────────────────── */

    private static HttpRequest Request(string method, string? contentType, string? body, bool chunked = false)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.ContentType = contentType;
        if (body is not null)
        {
            var bytes = Encoding.UTF8.GetBytes(body);
            context.Request.Body = new MemoryStream(bytes);
            if (chunked) context.Request.Headers.TransferEncoding = "chunked";
            else context.Request.ContentLength = bytes.Length;
        }

        return context.Request;
    }

    private static async Task<HttpError> BodyError(HttpRequest request) =>
        await Assert.ThrowsAsync<HttpError>(() => RequestBody.ReadAsync(request, CancellationToken.None));

    [Fact]
    public async Task Get_nao_tem_corpo_e_sem_content_type_nem_corpo_vira_null()
    {
        Assert.IsType<JsUndefined>(await RequestBody.ReadAsync(Request("GET", "application/json", "{x"), CancellationToken.None));
        Assert.IsType<JsNull>(await RequestBody.ReadAsync(Request("POST", null, null), CancellationToken.None));
    }

    [Fact]
    public async Task Json_texto_e_chave_repetida()
    {
        var json = (JsObject)await RequestBody.ReadAsync(Request("POST", "Application/JSON; charset=utf-8", """{"a":1,"b":2,"a":3}"""), CancellationToken.None);
        Assert.Equal(["a", "b"], json.Properties.Select(p => p.Key));
        Assert.Equal(new JsNumber(3), json["a"]);

        Assert.Equal(new JsString("oi"), await RequestBody.ReadAsync(Request("PATCH", "text/plain", "oi"), CancellationToken.None));
        Assert.IsType<JsObject>(await RequestBody.ReadAsync(Request("POST", "application/json", "{}", chunked: true), CancellationToken.None));
    }

    [Theory]
    [InlineData(null, "{}", 415, "FST_ERR_CTP_INVALID_MEDIA_TYPE")]
    [InlineData("application/xml", "<a/>", 415, "FST_ERR_CTP_INVALID_MEDIA_TYPE")]
    [InlineData("application/vnd.api+json", "{}", 415, "FST_ERR_CTP_INVALID_MEDIA_TYPE")]
    [InlineData("application/json", "", 400, "FST_ERR_CTP_EMPTY_JSON_BODY")]
    [InlineData("application/json", "{\"name\":", 400, "FST_ERR_CTP_INVALID_JSON_BODY")]
    [InlineData("application/json", "  ", 400, "FST_ERR_CTP_INVALID_JSON_BODY")]
    [InlineData("application/json", """{"a":[{"__proto__":{}}]}""", 400, "FST_ERR_CTP_INVALID_JSON_BODY")]
    [InlineData("application/json", """{"constructor":{"prototype":{}}}""", 400, "FST_ERR_CTP_INVALID_JSON_BODY")]
    public async Task Erros_do_parser_do_Fastify(string? contentType, string body, int status, string code)
    {
        var request = Request("POST", contentType, body);
        if (body.Length == 0) request.ContentLength = 0;
        var error = await BodyError(request);
        Assert.Equal((status, "FastifyError", code), (error.StatusCode, error.Error, error.Code));
    }

    [Fact]
    public async Task Constructor_sem_prototype_passa_e_corpo_acima_de_1MB_da_413()
    {
        Assert.IsType<JsObject>(await RequestBody.ReadAsync(Request("POST", "application/json", """{"constructor":{"x":1}}"""), CancellationToken.None));

        var big = $"{{\"a\":\"{new string('x', RequestBody.Limit)}\"}}";
        Assert.Equal(413, (await BodyError(Request("POST", "application/json", big))).StatusCode);
        Assert.Equal(413, (await BodyError(Request("POST", "application/json", big, chunked: true))).StatusCode);
    }

    /* ──────────────────────── Caminho exato ──────────────────────────── */

    [Theory]
    [InlineData("/api/settings", "/api/settings", true)]
    [InlineData("/api/settings", "/api/settings/", false)]
    [InlineData("/api/settings", "/API/settings", false)]
    [InlineData("/api/settings", "//api/settings", false)]
    [InlineData("/api/incomes/{id}", "/api/incomes/abc12345", true)]
    [InlineData("/api/incomes/{id}", "/api/Incomes/abc12345", false)]
    [InlineData("/api/incomes/{id}", "/api/incomes/", false)]
    [InlineData("/api/incomes/{id}", "/api/incomes/a/b", false)]
    public void Caminho_diferencia_maiusculas_e_barra_final_como_o_Fastify(string pattern, string path, bool expected) =>
        Assert.Equal(expected, ExactPathPolicy.Matches(RoutePatternFactory.Parse(pattern), path));

    /* ─────────────────────────── Configuração ────────────────────────── */

    private static GranaSettings Settings(params (string Name, string? Value)[] values)
    {
        var all = new Dictionary<string, string?> { ["DATABASE_URL"] = "postgresql://u:p@h/db" };
        foreach (var (name, value) in values) all[name] = value;
        return GranaSettings.FromEnvironment(name => all.GetValueOrDefault(name));
    }

    [Fact]
    public void Modulos_vem_das_variaveis_do_Strangler_com_padrao_node()
    {
        Assert.Empty(Settings().NativeModules);
        var settings = Settings(("Strangler__Modules__Incomes", "dotnet"), ("Strangler__Modules__Settings", "node"), ("JWT_ACCESS_SECRET", Secret));
        Assert.True(settings.IsNative("Incomes"));
        Assert.False(settings.IsNative("Settings"));
        Assert.Equal((200, 1), (settings.RateLimitMax, settings.TrustProxyHops));
    }

    [Fact]
    public void Configuracao_invalida_falha_no_boot()
    {
        Assert.Throws<InvalidOperationException>(() => Settings(("Strangler__Modules__Incomes", "java")));
        Assert.Throws<InvalidOperationException>(() => Settings(("Strangler__Modules__Incomes", "dotnet")));
        Assert.Throws<InvalidOperationException>(() => Settings(("Strangler__Modules__Incomes", "dotnet"), ("JWT_ACCESS_SECRET", "curto")));
        Assert.Throws<InvalidOperationException>(() => Settings(("RATE_LIMIT_MAX", "5")));
        Assert.Throws<InvalidOperationException>(() => Settings(("TRUST_PROXY_HOPS", "x")));
        Assert.Equal((50, 2), (Settings(("RATE_LIMIT_MAX", "50"), ("TRUST_PROXY_HOPS", "2")).RateLimitMax, Settings(("TRUST_PROXY_HOPS", "2")).TrustProxyHops));
    }

    /* ───────────────────── Leitura da saída validada ─────────────────── */

    [Fact]
    public void Leitura_tipada_distingue_ausente_de_null_e_estoura_fora_do_int32()
    {
        var data = new JsObject([
            new("name", new JsString("Ana")),
            new("note", JsNull.Instance),
            new("cents", new JsNumber(2_147_483_647)),
            new("huge", new JsNumber(3_000_000_000)),
            new("budget", JsNull.Instance),
            new("on", new JsBoolean(true)),
        ]);
        Assert.Equal(Patch.Set("Ana"), data.OptionalText("name"));
        Assert.False(data.OptionalText("missing").IsSet);
        Assert.Equal(Patch.Set<string?>(null), data.OptionalTextOrNull("note"));
        Assert.Equal(int.MaxValue, data.Int32Column("cents"));
        Assert.Throws<OverflowException>(() => data.Int32Column("huge"));
        Assert.Equal(Patch.Set<int?>(null), data.OptionalInt32ColumnOrNull("budget"));
        Assert.Equal(Patch.Set<int?>(int.MaxValue), data.OptionalInt32ColumnOrNull("cents"));
        Assert.Equal(Patch.Set(true), data.OptionalFlag("on"));
        Assert.False(data.OptionalInt32Column("missing").IsSet);
        Assert.Throws<InvalidOperationException>(() => data.Text("missing"));
    }
}
