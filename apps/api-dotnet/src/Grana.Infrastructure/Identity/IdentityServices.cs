using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using Grana.Application.Common;
using Grana.Application.Identity;
using Grana.Domain.Finance;
using Grana.Domain.Identity;
using Isopoh.Cryptography.Argon2;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Grana.Infrastructure.Identity;

/// <summary>
/// Argon2id com os parâmetros da API Node (OWASP: 19 MiB, t=2, p=1; sal de 16 bytes, hash de
/// 32), em formato PHC. Verifica os hashes do <c>@node-rs/argon2</c> e é verificado por ele (R-01).
/// </summary>
public sealed class Argon2PasswordHasher : IPasswordHasher
{
    /// <summary>O mesmo hash "de mentira" do Node, para gastar tempo com e-mail inexistente.</summary>
    private const string DummyHash = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Ep7q6R+2pWmSbb6h1PXeYLR2hjqXbOa1s3sWzTZDcYg";

    public string Hash(string plainText)
    {
        ArgumentNullException.ThrowIfNull(plainText);
        var config = new Argon2Config
        {
            Type = Argon2Type.HybridAddressing,
            Version = Argon2Version.Nineteen,
            TimeCost = 2,
            MemoryCost = 19_456,
            Lanes = 1,
            Threads = 1,
            HashLength = 32,
            Password = Encoding.UTF8.GetBytes(plainText),
            Salt = RandomNumberGenerator.GetBytes(16),
        };
        return Argon2.Hash(config);
    }

    public bool Verify(string hash, string plainText)
    {
        try
        {
            return Argon2.Verify(hash, plainText);
        }
#pragma warning disable CA1031 // hash ilegível conta como senha errada, como o `catch { return false }` do Node
        catch (Exception)
#pragma warning restore CA1031
        {
            return false;
        }
    }

    public void BurnTime(string plainText) => _ = Verify(DummyHash, plainText);
}

/// <summary>
/// Tokens — <c>JwtTokenService</c>: access token HS256 SEM <c>iss</c> (a opção da chamada
/// substitui a padrão no Node, RN-036), com o TTL no formato da biblioteca <c>ms</c> ("15m");
/// refresh opaco de 512 bits em base64url, guardado como SHA-256 hex.
/// </summary>
public sealed partial class JwtTokenService(string secret, string accessTokenTtl, int refreshTokenTtlDays, TimeProvider time) : ITokenService
{
    private static readonly JsonWriterOptions WriterOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private readonly byte[] _key = Encoding.UTF8.GetBytes(secret);
    private readonly double _ttlMilliseconds = ParseMs(accessTokenTtl);

    public (string Token, long ExpiresIn) SignAccessToken(string userId, string email, UserRole role)
    {
        var nowMs = time.GetUtcNow().ToUnixTimeMilliseconds();
        var iat = (long)Math.Floor(nowMs / 1000.0);
        var exp = (long)Math.Floor((nowMs + _ttlMilliseconds) / 1000);

        var header = Base64Url(Encoding.UTF8.GetBytes("""{"alg":"HS256","typ":"JWT"}"""));
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            writer.WriteString("sub", userId);
            writer.WriteString("email", email);
            writer.WriteString("role", role == UserRole.Admin ? "ADMIN" : "USER");
            writer.WriteNumber("iat", iat);
            writer.WriteNumber("exp", exp);
            writer.WriteEndObject();
        }

        var payload = Base64Url(buffer.ToArray());
        var signature = Base64Url(HMACSHA256.HashData(_key, Encoding.ASCII.GetBytes($"{header}.{payload}")));
        return ($"{header}.{payload}.{signature}", exp - iat);
    }

    public IssuedRefreshToken CreateRefreshToken()
    {
        var token = Base64Url(RandomNumberGenerator.GetBytes(64));
        var expiresAt = time.GetUtcNow().UtcDateTime.AddDays(refreshTokenTtlDays);
        return new IssuedRefreshToken(token, HashRefreshToken(token), new DateTime(expiresAt.Ticks - (expiresAt.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Utc));
    }

    public string HashRefreshToken(string token)
    {
        ArgumentNullException.ThrowIfNull(token);
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    }

    /// <summary>
    /// A biblioteca <c>ms</c> (usada pelo fast-jwt): número com unidade opcional; sem unidade,
    /// MILISSEGUNDOS ("900" = 0,9 s). Unidades: ms, s, m, h, d, w, y (ano = 365,25 dias).
    /// </summary>
    public static double ParseMs(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        var match = MsPattern().Match(value);
        if (value.Length > 100 || !match.Success) throw new InvalidOperationException($"ACCESS_TOKEN_TTL inválido: \"{value}\".");
        var amount = double.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        var unit = match.Groups[2].Value.ToLowerInvariant();
        const double Second = 1000, Minute = Second * 60, Hour = Minute * 60, Day = Hour * 24;
        return amount * unit switch
        {
            "years" or "year" or "yrs" or "yr" or "y" => Day * 365.25,
            "weeks" or "week" or "w" => Day * 7,
            "days" or "day" or "d" => Day,
            "hours" or "hour" or "hrs" or "hr" or "h" => Hour,
            "minutes" or "minute" or "mins" or "min" or "m" => Minute,
            "seconds" or "second" or "secs" or "sec" or "s" => Second,
            _ => 1,
        };
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    [GeneratedRegex(@"^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?\z", RegexOptions.IgnoreCase)]
    private static partial Regex MsPattern();
}

/// <summary>
/// Auditoria — <c>PrismaAuditLogger</c>: grava por fora do contexto do EF e engole a falha
/// (só registra no log), para a trilha nunca derrubar a requisição.
/// </summary>
public sealed partial class AuditLogger(NpgsqlDataSource dataSource, IClock clock, IIdGenerator ids, ILogger<AuditLogger> logger) : IAuditLogger
{
    public async Task RecordAsync(AuditEntry entry, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(entry);
        try
        {
            await using var command = dataSource.CreateCommand("""
                INSERT INTO "audit_logs" ("id","action","targetType","targetId","actorId","actorEmail","ip","metadata","createdAt")
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
                """);
            command.Parameters.Add(new NpgsqlParameter { Value = ids.NewId() });
            command.Parameters.Add(new NpgsqlParameter { Value = entry.Action });
            command.Parameters.Add(new NpgsqlParameter { Value = entry.TargetType });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)entry.TargetId ?? DBNull.Value });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)entry.ActorId ?? DBNull.Value });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)entry.ActorEmail ?? DBNull.Value });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)Domain.Common.JsText.Slice(entry.Ip, 64) ?? DBNull.Value });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)entry.MetadataJson ?? DBNull.Value, NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Text });
            command.Parameters.Add(new NpgsqlParameter { Value = DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Unspecified), NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Timestamp });
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
#pragma warning disable CA1031 // a trilha de auditoria nunca derruba a requisição (como no Node)
        catch (Exception exception)
#pragma warning restore CA1031
        {
            LogFailure(logger, exception, entry.Action);
        }
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "falha ao gravar a auditoria {Action}")]
    private static partial void LogFailure(ILogger logger, Exception exception, string action);
}

/// <summary>
/// Espaço financeiro de um usuário novo — <c>PrismaWorkspaceProvisioner</c>: ajustes (se não
/// existirem) e, se pedido, as 11 categorias padrão marcadas como do sistema, numa transação.
/// </summary>
public sealed class WorkspaceProvisioner(NpgsqlDataSource dataSource, IClock clock, IIdGenerator ids) : IUserWorkspaceProvisioner
{
    public async Task ProvisionAsync(string userId, bool withDefaultCategories, CancellationToken cancellationToken)
    {
        var now = DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Unspecified);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);

        await using (var settings = new NpgsqlCommand("""INSERT INTO "user_settings" ("userId","updatedAt") VALUES ($1,$2) ON CONFLICT ("userId") DO NOTHING""", connection, transaction))
        {
            settings.Parameters.Add(new NpgsqlParameter { Value = userId });
            settings.Parameters.Add(new NpgsqlParameter { Value = now, NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Timestamp });
            await settings.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        if (withDefaultCategories)
        {
            foreach (var (name, color, kind) in CategoryPalette.Defaults)
            {
                await using var category = new NpgsqlCommand("""
                    INSERT INTO "categories" ("id","userId","name","color","kind","isSystem","createdAt","updatedAt")
                    VALUES ($1,$2,$3,$4,$5::"CategoryKind",true,$6,$6) ON CONFLICT DO NOTHING
                    """, connection, transaction);
                category.Parameters.Add(new NpgsqlParameter { Value = ids.NewId() });
                category.Parameters.Add(new NpgsqlParameter { Value = userId });
                category.Parameters.Add(new NpgsqlParameter { Value = name });
                category.Parameters.Add(new NpgsqlParameter { Value = color });
                category.Parameters.Add(new NpgsqlParameter { Value = kind == CategoryKind.Income ? "INCOME" : "EXPENSE" });
                category.Parameters.Add(new NpgsqlParameter { Value = now, NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Timestamp });
                await category.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }
        }

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }
}
