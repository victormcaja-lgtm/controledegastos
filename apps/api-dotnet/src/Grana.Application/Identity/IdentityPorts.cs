using Grana.Domain.Identity;

namespace Grana.Application.Identity;

public sealed record ListUsersFilter(long Page, long PerPage, string? Search, UserRole? Role, UserStatus? Status);

public interface IUserRepository
{
    Task<User?> FindByIdAsync(string id, CancellationToken cancellationToken);

    Task<User?> FindByEmailAsync(string email, CancellationToken cancellationToken);

    Task<bool> ExistsByEmailAsync(string email, string? exceptUserId, CancellationToken cancellationToken);

    /// <summary>
    /// Ordem <c>createdAt desc</c>; ⚠️ a busca é <c>ILIKE '%…%'</c> sem escape no nome OU no
    /// e-mail, como o <c>contains</c> do Prisma.
    /// </summary>
    Task<(IReadOnlyList<User> Items, long Total)> ListAsync(ListUsersFilter filter, CancellationToken cancellationToken);

    Task<long> CountActiveAdminsAsync(string? exceptUserId, CancellationToken cancellationToken);

    Task AddAsync(User user, CancellationToken cancellationToken);

    /// <summary>Grava o agregado inteiro; o <c>updatedAt</c> vem do próprio usuário.</summary>
    Task SaveAsync(User user, CancellationToken cancellationToken);

    /// <summary>Todo o dado do usuário cai junto (ON DELETE CASCADE).</summary>
    Task DeleteAsync(string id, CancellationToken cancellationToken);
}

public sealed record RefreshTokenRecord(string Id, string UserId, DateTime ExpiresAt, DateTime? RevokedAt);

public interface IRefreshTokenRepository
{
    Task<RefreshTokenRecord> IssueAsync(string userId, string tokenHash, DateTime expiresAt, string? ip, string? userAgent, CancellationToken cancellationToken);

    Task<RefreshTokenRecord?> FindByHashAsync(string tokenHash, CancellationToken cancellationToken);

    Task RevokeAsync(string id, string? replacedBy, CancellationToken cancellationToken);

    Task RevokeAllForUserAsync(string userId, CancellationToken cancellationToken);
}

/// <summary>Argon2id em formato PHC (<c>m=19456,t=2,p=1</c>), compatível com os hashes do Node (R-01).</summary>
public interface IPasswordHasher
{
    string Hash(string plainText);

    /// <summary>Hash ilegível ou senha errada: <c>false</c>, nunca exceção.</summary>
    bool Verify(string hash, string plainText);

    /// <summary>Gasta o mesmo tempo de uma verificação real (e-mail inexistente, anti-enumeração).</summary>
    void BurnTime(string plainText);
}

public sealed record IssuedRefreshToken(string Token, string TokenHash, DateTime ExpiresAt);

public interface ITokenService
{
    /// <summary>Access token HS256 sem <c>iss</c> (RN-036) e o tempo de vida em segundos.</summary>
    (string Token, long ExpiresIn) SignAccessToken(string userId, string email, UserRole role);

    /// <summary>Refresh opaco de 512 bits (base64url) e o SHA-256 hex que vai para o banco.</summary>
    IssuedRefreshToken CreateRefreshToken();

    string HashRefreshToken(string token);
}

public sealed record AuditEntry(
    string Action, string TargetType, string? TargetId = null, string? ActorId = null, string? ActorEmail = null, string? Ip = null, string? MetadataJson = null);

/// <summary>Trilha de auditoria. Falha ao gravar NÃO derruba a requisição (é só registrada).</summary>
public interface IAuditLogger
{
    Task RecordAsync(AuditEntry entry, CancellationToken cancellationToken);
}

/// <summary>Prepara o espaço financeiro de um usuário novo: ajustes e, se pedido, as 11 categorias padrão.</summary>
public interface IUserWorkspaceProvisioner
{
    Task ProvisionAsync(string userId, bool withDefaultCategories, CancellationToken cancellationToken);
}
