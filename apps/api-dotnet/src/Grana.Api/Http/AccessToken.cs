using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Grana.Application.Common;
using Grana.Domain.Common;

namespace Grana.Api.Http;

/// <summary>
/// Verificação do access token como o <c>request.jwtVerify()</c> do <c>@fastify/jwt</c>
/// (fast-jwt) faz na API Node (R-02): <c>Authorization: Bearer &lt;token&gt;</c> (esquema
/// sem diferenciar maiúsculas), HS256/384/512 com o segredo compartilhado, <c>exp</c> e
/// <c>nbf</c> sem tolerância e <c>iss</c>, quando presente, igual a <c>grana-api</c>.
/// Qualquer falha vira o mesmo 401 "Sessão inválida ou expirada.".
/// </summary>
public sealed class AccessToken(string secret, TimeProvider time)
{
    public const string Issuer = "grana-api";

    private readonly byte[] _key = Encoding.UTF8.GetBytes(secret);

    public Actor Authenticate(string? authorization) =>
        TryVerify(authorization) ?? throw new UnauthorizedError("Sessão inválida ou expirada.");

    public Actor? TryVerify(string? authorization)
    {
        if (string.IsNullOrEmpty(authorization)) return null;
        var parts = authorization.Split(' ');
        if (parts.Length != 2 || !string.Equals(parts[0], "Bearer", StringComparison.OrdinalIgnoreCase)) return null;

        var segments = parts[1].Split('.');
        if (segments.Length != 3) return null;

        try
        {
            using var header = JsonDocument.Parse(Base64UrlDecode(segments[0]));
            if (header.RootElement.ValueKind != JsonValueKind.Object ||
                !header.RootElement.TryGetProperty("alg", out var alg) ||
                alg.ValueKind != JsonValueKind.String)
            {
                return null;
            }

            var expected = Sign(alg.GetString()!, Encoding.ASCII.GetBytes($"{segments[0]}.{segments[1]}"));
            if (expected is null || !CryptographicOperations.FixedTimeEquals(expected, Base64UrlDecode(segments[2]))) return null;

            using var payload = JsonDocument.Parse(Base64UrlDecode(segments[1]));
            return ReadClaims(payload.RootElement);
        }
        catch (Exception exception) when (exception is JsonException or FormatException)
        {
            return null;
        }
    }

    private byte[]? Sign(string algorithm, byte[] input) => algorithm switch
    {
        "HS256" => HMACSHA256.HashData(_key, input),
        "HS384" => HMACSHA384.HashData(_key, input),
        "HS512" => HMACSHA512.HashData(_key, input),
        _ => null,
    };

    private Actor? ReadClaims(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object) return null;
        var now = time.GetUtcNow().ToUnixTimeMilliseconds();

        // fast-jwt: exp válido enquanto agora <= exp·1000; nbf, a partir de nbf·1000.
        if (payload.TryGetProperty("exp", out var exp) && (exp.ValueKind != JsonValueKind.Number || now > exp.GetDouble() * 1000)) return null;
        if (payload.TryGetProperty("nbf", out var nbf) && (nbf.ValueKind != JsonValueKind.Number || now < nbf.GetDouble() * 1000)) return null;
        if (payload.TryGetProperty("iss", out var iss) && !(iss.ValueKind == JsonValueKind.String && iss.GetString() == Issuer)) return null;

        // Sem `sub` o Node seguiria com `userId` indefinido e o Prisma ignoraria o filtro. O
        // sistema nunca emite um token assim; aqui ele é recusado (diferença intencional).
        if (!payload.TryGetProperty("sub", out var sub) || sub.ValueKind != JsonValueKind.String) return null;

        return new Actor(sub.GetString()!, Text(payload, "email"), Text(payload, "role"));
    }

    private static string Text(JsonElement payload, string claim) =>
        payload.TryGetProperty(claim, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()! : string.Empty;

    private static byte[] Base64UrlDecode(string value)
    {
        var base64 = value.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + ((4 - (base64.Length % 4)) % 4), '=');
        return Convert.FromBase64String(base64);
    }
}
