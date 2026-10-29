using System.Text.Json;
using Grana.Application.Common;
using Grana.Domain.Common;
using Grana.Domain.Identity;

namespace Grana.Application.Identity;

public sealed record CreateUserCommand(string Name, string Email, string Password, UserRole Role, bool MustChangePassword, bool SeedDefaultCategories);

/// <summary>
/// Corpo de <c>PATCH /api/admin/users/:id</c>. <c>ChangesJson</c> é o corpo já validado, gravado
/// na auditoria como <c>{"changes": …}</c>.
/// </summary>
public sealed record UpdateUserCommand(Patch<string> Name, Patch<string> Email, Patch<UserRole> Role, Patch<UserStatus> Status, string ChangesJson);

/// <summary>Área administrativa — <c>manage-users.usecases.ts</c> (RN-050–062).</summary>
public sealed class AdminUserUseCases(
    IUserRepository users,
    IRefreshTokenRepository refreshTokens,
    IPasswordHasher hasher,
    IAuditLogger audit,
    IUserWorkspaceProvisioner provisioner,
    IClock clock,
    IIdGenerator ids)
{
    public async Task<UsersPageDto> ListAsync(ListUsersFilter filter, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filter);
        var (items, total) = await users.ListAsync(filter, cancellationToken).ConfigureAwait(false);
        return new UsersPageDto(
            [.. items.Select(UserDto.From)], total, filter.Page, filter.PerPage, Math.Max(1, (long)Math.Ceiling(total / (double)filter.PerPage)));
    }

    public async Task<UserDto> GetAsync(string id, CancellationToken cancellationToken) =>
        UserDto.From(await users.FindByIdAsync(id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Usuário"));

    public async Task<UserDto> CreateAsync(Actor actor, CreateUserCommand command, RequestContext request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(request);
        var email = EmailAddress.Create(command.Email);
        if (await users.ExistsByEmailAsync(email.Value, null, cancellationToken).ConfigureAwait(false))
        {
            throw new ConflictError("Já existe um usuário com este e-mail.");
        }

        var user = User.Create(ids.NewId(), command.Name, email, hasher.Hash(command.Password), command.Role, UserStatus.Active, command.MustChangePassword, clock.UtcNow);
        await users.AddAsync(user, cancellationToken).ConfigureAwait(false);
        await provisioner.ProvisionAsync(user.Id, command.SeedDefaultCategories, cancellationToken).ConfigureAwait(false);
        await audit.RecordAsync(
            new AuditEntry("user.created", "User", user.Id, actor.UserId, actor.Email, request.Ip,
                JsonSerializer.Serialize(new { email = user.Email.Value, role = UserDto.RoleName(user.Role) })),
            cancellationToken).ConfigureAwait(false);
        return UserDto.From(user);
    }

    /// <summary>
    /// E-mail (422/409), nome, perfil e status, nessa ordem. Mudar perfil ou status da própria
    /// conta → 403; nunca fica sem administrador ativo (422); suspender derruba as sessões.
    /// </summary>
    public async Task<UserDto> UpdateAsync(Actor actor, string id, UpdateUserCommand command, RequestContext request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(request);
        var user = await users.FindByIdAsync(id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Usuário");
        var now = clock.UtcNow;

        if (command.Email.IsSet)
        {
            var email = EmailAddress.Create(command.Email.Value);
            if (await users.ExistsByEmailAsync(email.Value, id, cancellationToken).ConfigureAwait(false))
            {
                throw new ConflictError("Já existe um usuário com este e-mail.");
            }

            user.ChangeEmail(email, now);
        }

        if (command.Name.IsSet) user.Rename(command.Name.Value, now);

        if (command.Role.IsSet && command.Role.Value != user.Role)
        {
            user.AssertIsNotSelf(actor.UserId, "alterar o perfil da");
            await AssertLastAdminIsPreservedAsync(user, command.Role.Value == UserRole.User, cancellationToken).ConfigureAwait(false);
            user.ChangeRole(command.Role.Value, now);
        }

        if (command.Status.IsSet && command.Status.Value != user.Status)
        {
            user.AssertIsNotSelf(actor.UserId, "alterar o status da");
            if (command.Status.Value == UserStatus.Suspended)
            {
                await AssertLastAdminIsPreservedAsync(user, losesAdmin: true, cancellationToken).ConfigureAwait(false);
                user.Suspend(now);
                // Suspender tem efeito imediato: derruba as sessões abertas.
                await refreshTokens.RevokeAllForUserAsync(user.Id, cancellationToken).ConfigureAwait(false);
            }
            else
            {
                user.Activate(now);
            }
        }

        user.Touch(now);
        await users.SaveAsync(user, cancellationToken).ConfigureAwait(false);
        await audit.RecordAsync(
            new AuditEntry("user.updated", "User", user.Id, actor.UserId, actor.Email, request.Ip, $$"""{"changes":{{command.ChangesJson}}}"""),
            cancellationToken).ConfigureAwait(false);
        return UserDto.From(user);
    }

    /// <summary>Senha nova pelo admin: derruba as sessões; a troca obrigatória vem do pedido (RN-059).</summary>
    public async Task ResetPasswordAsync(Actor actor, string id, string newPassword, bool mustChangePassword, RequestContext request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(request);
        var user = await users.FindByIdAsync(id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Usuário");
        user.ChangePassword(hasher.Hash(newPassword), mustChangePassword, clock.UtcNow);
        await users.SaveAsync(user, cancellationToken).ConfigureAwait(false);
        await refreshTokens.RevokeAllForUserAsync(user.Id, cancellationToken).ConfigureAwait(false);
        await audit.RecordAsync(new AuditEntry("user.password.reset", "User", user.Id, actor.UserId, actor.Email, request.Ip), cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Exclusão definitiva, com todo o dado financeiro em cascata (RN-061).</summary>
    public async Task DeleteAsync(Actor actor, string id, RequestContext request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(request);
        var user = await users.FindByIdAsync(id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Usuário");
        user.AssertIsNotSelf(actor.UserId, "excluir");
        if (user.IsAdmin && user.IsActive && await users.CountActiveAdminsAsync(user.Id, cancellationToken).ConfigureAwait(false) == 0)
        {
            throw new BusinessRuleError("Não é possível excluir o último administrador ativo.");
        }

        await users.DeleteAsync(user.Id, cancellationToken).ConfigureAwait(false);
        await audit.RecordAsync(
            new AuditEntry("user.deleted", "User", user.Id, actor.UserId, actor.Email, request.Ip, JsonSerializer.Serialize(new { email = user.Email.Value })),
            cancellationToken).ConfigureAwait(false);
    }

    private async Task AssertLastAdminIsPreservedAsync(User user, bool losesAdmin, CancellationToken cancellationToken)
    {
        if (!(user.IsAdmin && user.IsActive && losesAdmin)) return;
        if (await users.CountActiveAdminsAsync(user.Id, cancellationToken).ConfigureAwait(false) == 0)
        {
            throw new BusinessRuleError("Este é o último administrador ativo. Promova outro usuário antes de alterar este.");
        }
    }
}
