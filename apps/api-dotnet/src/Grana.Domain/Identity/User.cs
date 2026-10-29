using Grana.Domain.Common;

namespace Grana.Domain.Identity;

public enum UserRole
{
    Admin,
    User,
}

public enum UserStatus
{
    Active,
    Suspended,
    Pending,
}

/// <summary>
/// Raiz do agregado de identidade — <c>user.entity.ts</c> (RN-030–062). As regras do ciclo
/// de vida da conta (bloqueio, status, "não pode na própria conta") moram aqui.
/// </summary>
public sealed class User
{
    /// <summary>Depois de 5 falhas seguidas a conta trava por 15 minutos (RN-033, RN-034).</summary>
    public const int MaxFailedAttempts = 5;

    public static readonly TimeSpan LockDuration = TimeSpan.FromMinutes(15);

    private User(string id)
    {
        Id = id;
    }

    public string Id { get; }

    public string Name { get; private set; } = string.Empty;

    public EmailAddress Email { get; private set; } = null!;

    public string PasswordHash { get; private set; } = string.Empty;

    public UserRole Role { get; private set; }

    public UserStatus Status { get; private set; }

    /// <summary>⚠️ Gravado e devolvido, mas a API não impõe a troca (RN-043).</summary>
    public bool MustChangePassword { get; private set; }

    public int FailedLoginAttempts { get; private set; }

    public DateTime? LockedUntil { get; private set; }

    public DateTime? LastLoginAt { get; private set; }

    public DateTime CreatedAt { get; private set; }

    public DateTime UpdatedAt { get; private set; }

    public bool IsAdmin => Role == UserRole.Admin;

    public bool IsActive => Status == UserStatus.Active;

    public static User Restore(
        string id, string name, EmailAddress email, string passwordHash, UserRole role, UserStatus status, bool mustChangePassword,
        int failedLoginAttempts, DateTime? lockedUntil, DateTime? lastLoginAt, DateTime createdAt, DateTime updatedAt) =>
        new(id)
        {
            Name = name,
            Email = email,
            PasswordHash = passwordHash,
            Role = role,
            Status = status,
            MustChangePassword = mustChangePassword,
            FailedLoginAttempts = failedLoginAttempts,
            LockedUntil = lockedUntil,
            LastLoginAt = lastLoginAt,
            CreatedAt = createdAt,
            UpdatedAt = updatedAt,
        };

    public static User Create(
        string id, string name, EmailAddress email, string passwordHash, UserRole role, UserStatus status, bool mustChangePassword, DateTime nowUtc) =>
        Restore(id, JsText.Trim(name), email, passwordHash, role, status, mustChangePassword, 0, null, null, nowUtc, nowUtc);

    public bool IsLocked(DateTime nowUtc) => LockedUntil is { } until && until > nowUtc;

    /// <summary>Segundos até destravar, arredondados para cima.</summary>
    public int LockRemainingSeconds(DateTime nowUtc) =>
        IsLocked(nowUtc) ? (int)Math.Ceiling((LockedUntil!.Value - nowUtc).TotalMilliseconds / 1000) : 0;

    /// <summary>Senha errada: na 5ª falha trava por 15 min e ZERA o contador (RN-034).</summary>
    public void RegisterFailedLogin(DateTime nowUtc)
    {
        FailedLoginAttempts += 1;
        if (FailedLoginAttempts >= MaxFailedAttempts)
        {
            LockedUntil = nowUtc + LockDuration;
            FailedLoginAttempts = 0;
        }

        UpdatedAt = nowUtc;
    }

    public void RegisterSuccessfulLogin(DateTime nowUtc)
    {
        FailedLoginAttempts = 0;
        LockedUntil = null;
        LastLoginAt = nowUtc;
        UpdatedAt = nowUtc;
    }

    public void Rename(string name, DateTime nowUtc)
    {
        ArgumentNullException.ThrowIfNull(name);
        var trimmed = JsText.Trim(name);
        if (trimmed.Length < 2) throw new BusinessRuleError("O nome precisa ter ao menos 2 caracteres.");
        Name = trimmed;
        UpdatedAt = nowUtc;
    }

    public void ChangeEmail(EmailAddress email, DateTime nowUtc)
    {
        Email = email;
        UpdatedAt = nowUtc;
    }

    /// <summary>Nova senha: zera falhas e bloqueio (RN-042, RN-059).</summary>
    public void ChangePassword(string passwordHash, bool mustChangePassword, DateTime nowUtc)
    {
        PasswordHash = passwordHash;
        MustChangePassword = mustChangePassword;
        FailedLoginAttempts = 0;
        LockedUntil = null;
        UpdatedAt = nowUtc;
    }

    public void ChangeRole(UserRole role, DateTime nowUtc)
    {
        Role = role;
        UpdatedAt = nowUtc;
    }

    public void Suspend(DateTime nowUtc)
    {
        Status = UserStatus.Suspended;
        UpdatedAt = nowUtc;
    }

    /// <summary>
    /// ⚠️ Qualquer mudança de status que não seja suspender ATIVA a conta — inclusive pedir
    /// "PENDING" (RN-057) — e zera falhas e bloqueio.
    /// </summary>
    public void Activate(DateTime nowUtc)
    {
        Status = UserStatus.Active;
        FailedLoginAttempts = 0;
        LockedUntil = null;
        UpdatedAt = nowUtc;
    }

    /// <summary>
    /// Um administrador não pode alterar nem apagar a própria conta. ⚠️ A frase sai com
    /// "da a" ("alterar o perfil da a própria conta"), como no Node (RN-054).
    /// </summary>
    public void AssertIsNotSelf(string actorId, string action)
    {
        if (Id == actorId) throw new ForbiddenError($"Você não pode {action} a própria conta.");
    }

    /// <summary>Marca a gravação (o <c>@updatedAt</c> do Prisma muda a cada <c>save</c>).</summary>
    public void Touch(DateTime nowUtc) => UpdatedAt = nowUtc;
}
