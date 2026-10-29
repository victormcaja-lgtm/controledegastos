using Grana.Application.Common;
using Grana.Domain.Common;
using Grana.Domain.Identity;

namespace Grana.Application.Identity;

/// <summary>
/// Login, autocadastro, sessão e perfil — <c>authenticate-user</c>, <c>signup</c>,
/// <c>refresh-session</c> e <c>session.usecases.ts</c> (RN-030–046), na mesma ordem de checagens.
/// </summary>
public sealed class AuthUseCases(
    IUserRepository users,
    IRefreshTokenRepository refreshTokens,
    IPasswordHasher hasher,
    ITokenService tokens,
    IAuditLogger audit,
    IUserWorkspaceProvisioner provisioner,
    IClock clock,
    IIdGenerator ids)
{
    private const string WrongCredentials = "E-mail ou senha incorretos.";

    /// <summary>
    /// E-mail inexistente gasta o mesmo tempo de um hash e devolve a MESMA mensagem; bloqueio
    /// antes da senha; status DEPOIS da senha, para não revelar contas suspensas (RN-032–036).
    /// </summary>
    public async Task<SessionResult> LoginAsync(string email, string password, RequestContext request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var user = await users.FindByEmailAsync(email, cancellationToken).ConfigureAwait(false);
        if (user is null)
        {
            hasher.BurnTime(password);
            await audit.RecordAsync(
                new AuditEntry("auth.login.failed", "User", ActorEmail: email, Ip: request.Ip, MetadataJson: """{"reason":"unknown_email"}"""),
                cancellationToken).ConfigureAwait(false);
            throw new UnauthorizedError(WrongCredentials);
        }

        var now = clock.UtcNow;
        if (user.IsLocked(now))
        {
            var minutes = (int)Math.Ceiling(user.LockRemainingSeconds(now) / 60.0);
            throw new TooManyAttemptsError($"Conta temporariamente bloqueada por excesso de tentativas. Tente em {minutes} min.");
        }

        if (!hasher.Verify(user.PasswordHash, password))
        {
            user.RegisterFailedLogin(clock.UtcNow);
            await users.SaveAsync(user, cancellationToken).ConfigureAwait(false);
            await audit.RecordAsync(
                new AuditEntry("auth.login.failed", "User", user.Id, ActorEmail: user.Email.Value, Ip: request.Ip, MetadataJson: """{"reason":"bad_password"}"""),
                cancellationToken).ConfigureAwait(false);
            throw new UnauthorizedError(WrongCredentials);
        }

        if (!user.IsActive)
        {
            throw new UnauthorizedError(user.Status == UserStatus.Pending
                ? "Sua conta ainda não foi aprovada pelo administrador."
                : "Esta conta está suspensa. Fale com o administrador.");
        }

        user.RegisterSuccessfulLogin(clock.UtcNow);
        await users.SaveAsync(user, cancellationToken).ConfigureAwait(false);
        var (accessToken, expiresIn) = tokens.SignAccessToken(user.Id, user.Email.Value, user.Role);
        var refresh = tokens.CreateRefreshToken();
        await refreshTokens.IssueAsync(user.Id, refresh.TokenHash, refresh.ExpiresAt, request.Ip, request.UserAgent, cancellationToken).ConfigureAwait(false);
        await audit.RecordAsync(
            new AuditEntry("auth.login.success", "User", user.Id, user.Id, user.Email.Value, request.Ip), cancellationToken).ConfigureAwait(false);
        return new SessionResult(accessToken, expiresIn, AuthenticatedUserDto.From(user), refresh.Token, refresh.ExpiresAt);
    }

    /// <summary>Autocadastro: a conta nasce PENDING, sem troca obrigatória de senha (RN-050).</summary>
    public async Task SignupAsync(string name, string email, string password, RequestContext request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var address = EmailAddress.Create(email);
        if (await users.ExistsByEmailAsync(address.Value, null, cancellationToken).ConfigureAwait(false))
        {
            throw new ConflictError("Já existe uma conta com este e-mail.");
        }

        var user = User.Create(ids.NewId(), name, address, hasher.Hash(password), UserRole.User, UserStatus.Pending, mustChangePassword: false, clock.UtcNow);
        await users.AddAsync(user, cancellationToken).ConfigureAwait(false);
        await provisioner.ProvisionAsync(user.Id, withDefaultCategories: true, cancellationToken).ConfigureAwait(false);
        await audit.RecordAsync(
            new AuditEntry("user.signup_requested", "User", user.Id, null, user.Email.Value, request.Ip), cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Rotação com detecção de reuso (RN-039, RN-040): token revogado reapresentado derruba
    /// TODAS as sessões do usuário. O novo é emitido antes de revogar o antigo, que aponta para ele.
    /// </summary>
    public async Task<SessionResult> RefreshAsync(string refreshToken, RequestContext request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var stored = await refreshTokens.FindByHashAsync(tokens.HashRefreshToken(refreshToken), cancellationToken).ConfigureAwait(false)
            ?? throw new UnauthorizedError("Sessão inválida. Faça login novamente.");
        if (stored.RevokedAt is not null)
        {
            await refreshTokens.RevokeAllForUserAsync(stored.UserId, cancellationToken).ConfigureAwait(false);
            throw new UnauthorizedError("Sessão comprometida. Faça login novamente.");
        }

        if (stored.ExpiresAt <= clock.UtcNow) throw new UnauthorizedError("Sessão expirada. Faça login novamente.");

        var user = await users.FindByIdAsync(stored.UserId, cancellationToken).ConfigureAwait(false);
        if (user is null || !user.IsActive)
        {
            await refreshTokens.RevokeAllForUserAsync(stored.UserId, cancellationToken).ConfigureAwait(false);
            throw new UnauthorizedError("Sessão inválida. Faça login novamente.");
        }

        var next = tokens.CreateRefreshToken();
        var issued = await refreshTokens.IssueAsync(user.Id, next.TokenHash, next.ExpiresAt, request.Ip, request.UserAgent, cancellationToken).ConfigureAwait(false);
        await refreshTokens.RevokeAsync(stored.Id, issued.Id, cancellationToken).ConfigureAwait(false);
        var (accessToken, expiresIn) = tokens.SignAccessToken(user.Id, user.Email.Value, user.Role);
        return new SessionResult(accessToken, expiresIn, AuthenticatedUserDto.From(user), next.Token, next.ExpiresAt);
    }

    /// <summary>Revoga a sessão do cookie, se houver uma válida. Sempre responde 204.</summary>
    public async Task LogoutAsync(string? refreshToken, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(refreshToken)) return;
        var stored = await refreshTokens.FindByHashAsync(tokens.HashRefreshToken(refreshToken), cancellationToken).ConfigureAwait(false);
        if (stored is { RevokedAt: null }) await refreshTokens.RevokeAsync(stored.Id, null, cancellationToken).ConfigureAwait(false);
    }

    public async Task<AuthenticatedUserDto> ProfileAsync(Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var user = await users.FindByIdAsync(actor.UserId, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Usuário");
        return AuthenticatedUserDto.From(user);
    }

    /// <summary>PATCH /me: só o nome; responde o <c>UserDTO</c> (RN-041).</summary>
    public async Task<UserDto> UpdateProfileAsync(Actor actor, string name, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var user = await users.FindByIdAsync(actor.UserId, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Usuário");
        user.Rename(name, clock.UtcNow);
        user.Touch(clock.UtcNow);
        await users.SaveAsync(user, cancellationToken).ConfigureAwait(false);
        return UserDto.From(user);
    }

    /// <summary>Trocar a senha tira a troca obrigatória e derruba TODAS as sessões (RN-042).</summary>
    public async Task ChangePasswordAsync(Actor actor, string currentPassword, string newPassword, RequestContext request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(request);
        var user = await users.FindByIdAsync(actor.UserId, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Usuário");
        if (!hasher.Verify(user.PasswordHash, currentPassword)) throw new UnauthorizedError("A senha atual está incorreta.");

        user.ChangePassword(hasher.Hash(newPassword), mustChangePassword: false, clock.UtcNow);
        await users.SaveAsync(user, cancellationToken).ConfigureAwait(false);
        await refreshTokens.RevokeAllForUserAsync(user.Id, cancellationToken).ConfigureAwait(false);
        await audit.RecordAsync(
            new AuditEntry("auth.password.changed", "User", user.Id, actor.UserId, actor.Email, request.Ip), cancellationToken).ConfigureAwait(false);
    }

}
