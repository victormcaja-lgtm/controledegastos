using Grana.Application.Common;
using Grana.Application.Identity;
using Grana.Domain.Common;
using Grana.Domain.Identity;
using Grana.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Grana.Infrastructure.Identity;

/// <summary>Usuários — <c>PrismaUserRepository</c>. Toda leitura passa pelo <see cref="EmailAddress"/>, como o mapper do Node.</summary>
public sealed class EfUserRepository(GranaDbContext db) : IUserRepository
{
    public async Task<User?> FindByIdAsync(string id, CancellationToken cancellationToken)
    {
        var row = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, cancellationToken).ConfigureAwait(false);
        return row is null ? null : ToDomain(row);
    }

    public async Task<User?> FindByEmailAsync(string email, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(email);
        var lower = email.ToLowerInvariant();
        var row = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == lower, cancellationToken).ConfigureAwait(false);
        return row is null ? null : ToDomain(row);
    }

    public Task<bool> ExistsByEmailAsync(string email, string? exceptUserId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(email);
        var lower = email.ToLowerInvariant();
        return db.Users.AnyAsync(u => u.Email == lower && (exceptUserId == null || u.Id != exceptUserId), cancellationToken);
    }

    public async Task<(IReadOnlyList<User> Items, long Total)> ListAsync(ListUsersFilter filter, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filter);
        var query = db.Users.AsNoTracking().AsQueryable();
        if (filter.Role is { } role)
        {
            var roleDb = role == UserRole.Admin ? UserRoleDb.ADMIN : UserRoleDb.USER;
            query = query.Where(u => u.Role == roleDb);
        }

        if (filter.Status is { } status)
        {
            var statusDb = ToDb(status);
            query = query.Where(u => u.Status == statusDb);
        }

        if (!string.IsNullOrEmpty(filter.Search))
        {
            var pattern = $"%{filter.Search}%";
            query = query.Where(u => EF.Functions.ILike(u.Name, pattern) || EF.Functions.ILike(u.Email, pattern));
        }

        var total = await query.LongCountAsync(cancellationToken).ConfigureAwait(false);
        var offset = (filter.Page - 1) * filter.PerPage;
        if (offset > int.MaxValue) return ([], total);
        var rows = await query.OrderByDescending(u => u.CreatedAt).Skip((int)offset).Take((int)filter.PerPage)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return ([.. rows.Select(ToDomain)], total);
    }

    public Task<long> CountActiveAdminsAsync(string? exceptUserId, CancellationToken cancellationToken) =>
        db.Users.LongCountAsync(
            u => u.Role == UserRoleDb.ADMIN && u.Status == UserStatusDb.ACTIVE && (exceptUserId == null || u.Id != exceptUserId), cancellationToken);

    public async Task AddAsync(User user, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);
        var row = new UserRow { Id = user.Id, Name = user.Name, Email = user.Email.Value, PasswordHash = user.PasswordHash };
        Copy(user, row);
        row.CreatedAt = user.CreatedAt;
        db.Users.Add(row);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task SaveAsync(User user, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);
        var row = await db.Users.FirstAsync(u => u.Id == user.Id, cancellationToken).ConfigureAwait(false);
        Copy(user, row);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public Task DeleteAsync(string id, CancellationToken cancellationToken) =>
        db.Users.Where(u => u.Id == id).ExecuteDeleteAsync(cancellationToken);

    private static void Copy(User user, UserRow row)
    {
        row.Name = user.Name;
        row.Email = user.Email.Value;
        row.PasswordHash = user.PasswordHash;
        row.Role = user.Role == UserRole.Admin ? UserRoleDb.ADMIN : UserRoleDb.USER;
        row.Status = ToDb(user.Status);
        row.MustChangePassword = user.MustChangePassword;
        row.FailedLoginAttempts = user.FailedLoginAttempts;
        row.LockedUntil = user.LockedUntil;
        row.LastLoginAt = user.LastLoginAt;
        row.UpdatedAt = user.UpdatedAt;
    }

    private static User ToDomain(UserRow row) =>
        User.Restore(
            row.Id, row.Name, EmailAddress.Create(row.Email), row.PasswordHash,
            row.Role == UserRoleDb.ADMIN ? UserRole.Admin : UserRole.User,
            row.Status switch { UserStatusDb.ACTIVE => UserStatus.Active, UserStatusDb.SUSPENDED => UserStatus.Suspended, _ => UserStatus.Pending },
            row.MustChangePassword, row.FailedLoginAttempts, row.LockedUntil, row.LastLoginAt, row.CreatedAt, row.UpdatedAt);

    private static UserStatusDb ToDb(UserStatus status) => status switch
    {
        UserStatus.Active => UserStatusDb.ACTIVE,
        UserStatus.Suspended => UserStatusDb.SUSPENDED,
        _ => UserStatusDb.PENDING,
    };
}

/// <summary>Sessões — <c>PrismaRefreshTokenRepository</c>: só o hash do token fica no banco.</summary>
public sealed class EfRefreshTokenRepository(GranaDbContext db, IClock clock, IIdGenerator ids) : IRefreshTokenRepository
{
    public async Task<RefreshTokenRecord> IssueAsync(string userId, string tokenHash, DateTime expiresAt, string? ip, string? userAgent, CancellationToken cancellationToken)
    {
        var row = new RefreshTokenRow
        {
            Id = ids.NewId(),
            TokenHash = tokenHash,
            UserId = userId,
            ExpiresAt = expiresAt,
            Ip = JsText.Slice(ip, 64),
            UserAgent = JsText.Slice(userAgent, 255),
            CreatedAt = clock.UtcNow,
        };
        db.RefreshTokens.Add(row);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return new RefreshTokenRecord(row.Id, row.UserId, row.ExpiresAt, row.RevokedAt);
    }

    public async Task<RefreshTokenRecord?> FindByHashAsync(string tokenHash, CancellationToken cancellationToken)
    {
        var row = await db.RefreshTokens.AsNoTracking().FirstOrDefaultAsync(t => t.TokenHash == tokenHash, cancellationToken).ConfigureAwait(false);
        return row is null ? null : new RefreshTokenRecord(row.Id, row.UserId, row.ExpiresAt, row.RevokedAt);
    }

    public Task RevokeAsync(string id, string? replacedBy, CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        return db.RefreshTokens.Where(t => t.Id == id)
            .ExecuteUpdateAsync(set => set.SetProperty(t => t.RevokedAt, now).SetProperty(t => t.ReplacedBy, replacedBy), cancellationToken);
    }

    public Task RevokeAllForUserAsync(string userId, CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        return db.RefreshTokens.Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(t => t.RevokedAt, (DateTime?)now), cancellationToken);
    }
}
