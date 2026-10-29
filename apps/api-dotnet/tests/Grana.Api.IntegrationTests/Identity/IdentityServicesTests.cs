using System.Text;
using Grana.Api.Endpoints;
using Grana.Api.Hosting;
using Grana.Domain.Identity;
using Grana.Infrastructure.Identity;

namespace Grana.Api.IntegrationTests.Identity;

/// <summary>Hash, tokens e cookies do Identity, conferidos contra o que a API Node produz (R-01, R-02).</summary>
public class IdentityServicesTests
{
    /// <summary>Gerado pelo <c>@node-rs/argon2</c> da API Node (tools/homologacao/gerar-hash.mjs).</summary>
    private const string NodeHash = "$argon2id$v=19$m=19456,t=2,p=1$ECLJgH0QVN9UbnA8UzAHlw$Vc91btd0AA8c1Z4lmgNWj6knfCN30pvhayK6whYNtYQ";

    private sealed class ManualTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    [Fact]
    public void Verifica_o_hash_gerado_pelo_Node_e_gera_no_mesmo_formato()
    {
        var hasher = new Argon2PasswordHasher();
        Assert.True(hasher.Verify(NodeHash, "SenhaDoNode123"));
        Assert.False(hasher.Verify(NodeHash, "senhadonode123"));
        Assert.False(hasher.Verify("não é um hash", "x"));

        var own = hasher.Hash("Árvore123");
        Assert.Matches(@"^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$", own);
        Assert.True(hasher.Verify(own, "Árvore123"));
        hasher.BurnTime("qualquer");
    }

    [Fact]
    public void Access_token_sem_iss_com_as_claims_na_ordem_do_Node()
    {
        var now = new DateTimeOffset(2026, 10, 29, 12, 0, 0, 750, TimeSpan.Zero);
        var service = new JwtTokenService("segredo-de-teste-com-mais-de-32-caracteres!", "15m", 7, new ManualTime(now));
        var (token, expiresIn) = service.SignAccessToken("u1", "ana@grana.app", UserRole.Admin);

        Assert.Equal(900, expiresIn);
        var parts = token.Split('.');
        Assert.Equal("""{"alg":"HS256","typ":"JWT"}""", Decode(parts[0]));
        var iat = now.ToUnixTimeSeconds();
        Assert.Equal($$"""{"sub":"u1","email":"ana@grana.app","role":"ADMIN","iat":{{iat}},"exp":{{iat + 900}}}""", Decode(parts[1]));

        var accepted = new Grana.Api.Http.AccessToken("segredo-de-teste-com-mais-de-32-caracteres!", new ManualTime(now)).TryVerify($"Bearer {token}");
        Assert.Equal(("u1", "ADMIN"), (accepted!.UserId, accepted.Role));
    }

    [Fact]
    public void Refresh_opaco_de_512_bits_e_hash_sha256_hex()
    {
        var now = new DateTimeOffset(2026, 10, 29, 12, 0, 0, 123, TimeSpan.Zero);
        var service = new JwtTokenService("segredo-de-teste-com-mais-de-32-caracteres!", "15m", 7, new ManualTime(now));
        var refresh = service.CreateRefreshToken();
        Assert.Equal(86, refresh.Token.Length);
        Assert.Matches("^[A-Za-z0-9_-]+$", refresh.Token);
        Assert.Equal(service.HashRefreshToken(refresh.Token), refresh.TokenHash);
        Assert.Equal("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", service.HashRefreshToken(string.Empty));
        Assert.Equal(now.UtcDateTime.AddDays(7), refresh.ExpiresAt);
    }

    [Theory]
    [InlineData("15m", 900_000)]
    [InlineData("1h", 3_600_000)]
    [InlineData("2 days", 172_800_000)]
    [InlineData("1.5h", 5_400_000)]
    [InlineData("900", 900)]
    [InlineData("30s", 30_000)]
    [InlineData("1y", 31_557_600_000)]
    public void TTL_no_formato_da_biblioteca_ms(string value, double expected) =>
        Assert.Equal(expected, JwtTokenService.ParseMs(value));

    [Fact]
    public void TTL_invalido_falha() =>
        Assert.Throws<InvalidOperationException>(() => JwtTokenService.ParseMs("quinze minutos"));

    [Fact]
    public void Cookies_no_formato_do_fastify_cookie()
    {
        var expires = new DateTime(2026, 11, 2, 20, 0, 45, DateTimeKind.Utc);
        var production = Settings("production", null);
        Assert.Equal(
            "grana_refresh_token=abc; Path=/api/auth; Expires=Mon, 02 Nov 2026 20:00:45 GMT; HttpOnly; Secure; SameSite=None",
            IdentityEndpoints.RefreshCookieHeader(production, "abc", expires));
        Assert.Equal(
            "grana_refresh_token=; Max-Age=0; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax",
            IdentityEndpoints.ClearRefreshCookieHeader(production));

        var development = Settings("development", "grana.app");
        Assert.Equal(
            "grana_refresh_token=abc; Domain=grana.app; Path=/api/auth; Expires=Mon, 02 Nov 2026 20:00:45 GMT; HttpOnly; SameSite=Lax",
            IdentityEndpoints.RefreshCookieHeader(development, "abc", expires));
        Assert.StartsWith("grana_refresh_token=; Max-Age=0; Domain=grana.app; Path=/api/auth;", IdentityEndpoints.ClearRefreshCookieHeader(development), StringComparison.Ordinal);
    }

    [Fact]
    public void Configuracao_do_Identity_com_os_padroes_do_Node()
    {
        var settings = GranaSettings.FromEnvironment(name => name == "DATABASE_URL" ? "postgresql://u:p@h/db" : null);
        Assert.Equal((8, "15m", 7, (string?)null), (settings.LoginRateLimitMax, settings.AccessTokenTtl, settings.RefreshTokenTtlDays, settings.CookieDomain));
        Assert.Throws<InvalidOperationException>(() => GranaSettings.FromEnvironment(name => name switch
        {
            "DATABASE_URL" => "postgresql://u:p@h/db",
            "REFRESH_TOKEN_TTL_DAYS" => "91",
            _ => null,
        }));
    }

    private static GranaSettings Settings(string environment, string? domain) =>
        GranaSettings.FromEnvironment(name => name switch
        {
            "DATABASE_URL" => "postgresql://u:p@h/db",
            "NODE_ENV" => environment,
            "COOKIE_DOMAIN" => domain,
            _ => null,
        });

    private static string Decode(string segment)
    {
        var base64 = segment.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + ((4 - (base64.Length % 4)) % 4), '=');
        return Encoding.UTF8.GetString(Convert.FromBase64String(base64));
    }

}
