using Grana.Domain.Identity;

namespace Grana.Application.Identity;

/// <summary><c>AuthenticatedUser</c>: o usuário da sessão (login, refresh, GET /me).</summary>
public sealed record AuthenticatedUserDto(string Id, string Name, string Email, string Role, string Status, bool MustChangePassword, DateTime CreatedAt)
{
    public static AuthenticatedUserDto From(User user)
    {
        ArgumentNullException.ThrowIfNull(user);
        return new(user.Id, user.Name, user.Email.Value, UserDto.RoleName(user.Role), UserDto.StatusName(user.Status), user.MustChangePassword, user.CreatedAt);
    }
}

/// <summary><c>UserDTO</c>: nunca inclui hash de senha nem contadores internos.</summary>
public sealed record UserDto(
    string Id, string Name, string Email, string Role, string Status, bool MustChangePassword, DateTime? LastLoginAt, DateTime CreatedAt, DateTime UpdatedAt)
{
    public static UserDto From(User user)
    {
        ArgumentNullException.ThrowIfNull(user);
        return new(user.Id, user.Name, user.Email.Value, RoleName(user.Role), StatusName(user.Status), user.MustChangePassword, user.LastLoginAt, user.CreatedAt, user.UpdatedAt);
    }

    public static string RoleName(UserRole role) => role == UserRole.Admin ? "ADMIN" : "USER";

    public static string StatusName(UserStatus status) => status switch
    {
        UserStatus.Active => "ACTIVE",
        UserStatus.Suspended => "SUSPENDED",
        _ => "PENDING",
    };

    public static UserRole ParseRole(string role) => role == "ADMIN" ? UserRole.Admin : UserRole.User;

    public static UserStatus ParseStatus(string status) => status switch
    {
        "ACTIVE" => UserStatus.Active,
        "SUSPENDED" => UserStatus.Suspended,
        _ => UserStatus.Pending,
    };
}

/// <summary>Corpo de login/refresh e o que vai no cookie.</summary>
public sealed record SessionResult(string AccessToken, long ExpiresIn, AuthenticatedUserDto User, string RefreshToken, DateTime RefreshExpiresAt);

/// <summary>Quem age, com o IP e o navegador da requisição (auditoria e sessões).</summary>
public sealed record RequestContext(string? Ip, string? UserAgent);

public sealed record UsersPageDto(IReadOnlyList<UserDto> Items, long Total, long Page, long PerPage, long TotalPages);
