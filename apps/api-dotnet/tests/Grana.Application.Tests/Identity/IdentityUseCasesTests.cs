using Grana.Application.Common;
using Grana.Application.Identity;
using Grana.Application.Tests.Finance;
using Grana.Domain.Common;
using Grana.Domain.Identity;

namespace Grana.Application.Tests.Identity;

/// <summary>Sessão e administração — authenticate-user, signup, refresh-session, session e manage-users (RN-030–062).</summary>
public class IdentityUseCasesTests
{
    private static readonly DateTime Now = new(2026, 10, 29, 12, 0, 0, DateTimeKind.Utc);
    private static readonly RequestContext Request = new("10.0.0.1", "teste/1.0");

    private readonly InMemoryUsers _users = new();
    private readonly InMemorySessions _sessions = new();
    private readonly FakeHasher _hasher = new();
    private readonly InMemoryAudit _audit = new();
    private readonly FakeProvisioner _provisioner = new();
    private readonly FixedClock _clock = new(Now);
    private readonly AuthUseCases _auth;
    private readonly AdminUserUseCases _admin;

    public IdentityUseCasesTests()
    {
        var ids = new SequentialIds();
        var tokens = new FakeTokens(_clock);
        _auth = new AuthUseCases(_users, _sessions, _hasher, tokens, _audit, _provisioner, _clock, ids);
        _admin = new AdminUserUseCases(_users, _sessions, _hasher, _audit, _provisioner, _clock, ids);
    }

    private User Add(string id, string email, UserRole role = UserRole.User, UserStatus status = UserStatus.Active, string password = "senha")
    {
        var user = User.Create(id, $"Pessoa {id}", EmailAddress.Create(email), $"hash:{password}", role, status, mustChangePassword: false, Now);
        _users.Items[id] = user;
        return user;
    }

    private static Actor ActorOf(string id) => new(id, $"{id}@grana.app", "ADMIN");

    [Fact]
    public async Task Login_inexistente_gasta_tempo_e_audita_sem_revelar()
    {
        var error = await Assert.ThrowsAsync<UnauthorizedError>(() => _auth.LoginAsync("ninguem@grana.app", "x", Request, CancellationToken.None));
        Assert.Equal("E-mail ou senha incorretos.", error.Message);
        Assert.Equal(1, _hasher.Burned);
        Assert.Equal(("auth.login.failed", null, "ninguem@grana.app", """{"reason":"unknown_email"}"""), (_audit.Entries[0].Action, _audit.Entries[0].TargetId, _audit.Entries[0].ActorEmail, _audit.Entries[0].MetadataJson));
    }

    [Fact]
    public async Task Login_senha_errada_bloqueio_status_e_sucesso()
    {
        var user = Add("u1", "ana@grana.app");
        for (var attempt = 0; attempt < 5; attempt++)
        {
            await Assert.ThrowsAsync<UnauthorizedError>(() => _auth.LoginAsync("ana@grana.app", "errada", Request, CancellationToken.None));
        }

        Assert.Equal("""{"reason":"bad_password"}""", _audit.Entries[^1].MetadataJson);
        _clock.UtcNow = Now.AddMinutes(1);
        var locked = await Assert.ThrowsAsync<TooManyAttemptsError>(() => _auth.LoginAsync("ana@grana.app", "senha", Request, CancellationToken.None));
        Assert.Equal("Conta temporariamente bloqueada por excesso de tentativas. Tente em 14 min.", locked.Message);

        _clock.UtcNow = Now.AddMinutes(16);
        var session = await _auth.LoginAsync("ana@grana.app", "senha", Request, CancellationToken.None);
        Assert.Equal(("token:u1", 900L, "u1", "ACTIVE", "rt-1"), (session.AccessToken, session.ExpiresIn, session.User.Id, session.User.Status, session.RefreshToken));
        Assert.Equal(("u1", "10.0.0.1", "teste/1.0"), (_sessions.Items[0].UserId, _sessions.Items[0].Ip, _sessions.Items[0].UserAgent));
        Assert.Equal(Now.AddMinutes(16), user.LastLoginAt);
        Assert.Equal("auth.login.success", _audit.Entries[^1].Action);

        Add("u2", "pendente@grana.app", status: UserStatus.Pending);
        Add("u3", "suspensa@grana.app", status: UserStatus.Suspended);
        Assert.Equal("Sua conta ainda não foi aprovada pelo administrador.",
            (await Assert.ThrowsAsync<UnauthorizedError>(() => _auth.LoginAsync("pendente@grana.app", "senha", Request, CancellationToken.None))).Message);
        Assert.Equal("Esta conta está suspensa. Fale com o administrador.",
            (await Assert.ThrowsAsync<UnauthorizedError>(() => _auth.LoginAsync("suspensa@grana.app", "senha", Request, CancellationToken.None))).Message);
    }

    [Fact]
    public async Task Cadastro_nasce_pendente_provisionado_e_auditado()
    {
        await _auth.SignupAsync("  Nova Pessoa ", "NOVA@grana.app", "SenhaForte123", Request, CancellationToken.None);
        var user = _users.Items.Values.Single();
        Assert.Equal(("Nova Pessoa", "nova@grana.app", UserStatus.Pending, false, "hash:SenhaForte123"), (user.Name, user.Email.Value, user.Status, user.MustChangePassword, user.PasswordHash));
        Assert.Equal([(user.Id, true)], _provisioner.Calls);
        Assert.Equal(("user.signup_requested", null), (_audit.Entries[0].Action, _audit.Entries[0].ActorId));
        Assert.Equal("Já existe uma conta com este e-mail.",
            (await Assert.ThrowsAsync<ConflictError>(() => _auth.SignupAsync("Outra", "nova@grana.app", "x", Request, CancellationToken.None))).Message);
    }

    [Fact]
    public async Task Refresh_rotaciona_detecta_reuso_expira_e_derruba_inativo()
    {
        Add("u1", "ana@grana.app");
        Assert.Equal("Sessão inválida. Faça login novamente.",
            (await Assert.ThrowsAsync<UnauthorizedError>(() => _auth.RefreshAsync("nada", Request, CancellationToken.None))).Message);

        var first = await _auth.LoginAsync("ana@grana.app", "senha", Request, CancellationToken.None);
        var second = await _auth.RefreshAsync(first.RefreshToken, Request, CancellationToken.None);
        Assert.Equal(("rt-2", "s-2"), (second.RefreshToken, _sessions.Items[0].ReplacedBy));

        Assert.Equal("Sessão comprometida. Faça login novamente.",
            (await Assert.ThrowsAsync<UnauthorizedError>(() => _auth.RefreshAsync(first.RefreshToken, Request, CancellationToken.None))).Message);
        Assert.All(_sessions.Items, session => Assert.NotNull(session.RevokedAt));

        var third = await _auth.LoginAsync("ana@grana.app", "senha", Request, CancellationToken.None);
        _clock.UtcNow = Now.AddDays(8);
        Assert.Equal("Sessão expirada. Faça login novamente.",
            (await Assert.ThrowsAsync<UnauthorizedError>(() => _auth.RefreshAsync(third.RefreshToken, Request, CancellationToken.None))).Message);

        _clock.UtcNow = Now;
        var fourth = await _auth.LoginAsync("ana@grana.app", "senha", Request, CancellationToken.None);
        _users.Items["u1"].Suspend(Now);
        await Assert.ThrowsAsync<UnauthorizedError>(() => _auth.RefreshAsync(fourth.RefreshToken, Request, CancellationToken.None));
        Assert.All(_sessions.Items, session => Assert.NotNull(session.RevokedAt));
    }

    [Fact]
    public async Task Logout_perfil_renomear_e_trocar_senha()
    {
        Add("u1", "ana@grana.app");
        var session = await _auth.LoginAsync("ana@grana.app", "senha", Request, CancellationToken.None);
        await _auth.LogoutAsync(null, CancellationToken.None);
        await _auth.LogoutAsync("desconhecido", CancellationToken.None);
        await _auth.LogoutAsync(session.RefreshToken, CancellationToken.None);
        Assert.NotNull(_sessions.Items[0].RevokedAt);
        Assert.Null(_sessions.Items[0].ReplacedBy);

        var actor = new Actor("u1", "ana@grana.app", "USER");
        Assert.Equal("Pessoa u1", (await _auth.ProfileAsync(actor, CancellationToken.None)).Name);
        Assert.Equal("Ana B", (await _auth.UpdateProfileAsync(actor, " Ana B ", CancellationToken.None)).Name);

        Assert.Equal("A senha atual está incorreta.",
            (await Assert.ThrowsAsync<UnauthorizedError>(() => _auth.ChangePasswordAsync(actor, "errada", "Nova12345678", Request, CancellationToken.None))).Message);
        await _auth.LoginAsync("ana@grana.app", "senha", Request, CancellationToken.None);
        await _auth.ChangePasswordAsync(actor, "senha", "Nova12345678", Request, CancellationToken.None);
        Assert.Equal("hash:Nova12345678", _users.Items["u1"].PasswordHash);
        Assert.All(_sessions.Items, s => Assert.NotNull(s.RevokedAt));
        Assert.Equal("auth.password.changed", _audit.Entries[^1].Action);

        var ghost = new Actor("sumiu", "x@y.zz", "USER");
        Assert.Equal("Usuário não encontrado.", (await Assert.ThrowsAsync<NotFoundError>(() => _auth.ProfileAsync(ghost, CancellationToken.None))).Message);
        await Assert.ThrowsAsync<NotFoundError>(() => _auth.UpdateProfileAsync(ghost, "Nome", CancellationToken.None));
        await Assert.ThrowsAsync<NotFoundError>(() => _auth.ChangePasswordAsync(ghost, "a", "b", Request, CancellationToken.None));
    }

    [Fact]
    public async Task Admin_lista_detalha_cria_e_redefine_senha()
    {
        Add("admin", "admin@grana.app", UserRole.Admin);
        var created = await _admin.CreateAsync(ActorOf("admin"), new CreateUserCommand("Bia", "BIA@grana.app", "Senha12345", UserRole.User, true, false), Request, CancellationToken.None);
        Assert.Equal(("bia@grana.app", "USER", "ACTIVE", true), (created.Email, created.Role, created.Status, created.MustChangePassword));
        Assert.Equal([(created.Id, false)], _provisioner.Calls);
        Assert.Equal("""{"email":"bia@grana.app","role":"USER"}""", _audit.Entries[^1].MetadataJson);
        await Assert.ThrowsAsync<ConflictError>(() =>
            _admin.CreateAsync(ActorOf("admin"), new CreateUserCommand("X", "bia@grana.app", "x", UserRole.User, true, true), Request, CancellationToken.None));

        var page = await _admin.ListAsync(new ListUsersFilter(1, 1, null, null, null), CancellationToken.None);
        Assert.Equal((2L, 2L, 1), (page.Total, page.TotalPages, page.Items.Count));
        Assert.Equal("bia@grana.app", (await _admin.GetAsync(created.Id, CancellationToken.None)).Email);
        await Assert.ThrowsAsync<NotFoundError>(() => _admin.GetAsync("nada", CancellationToken.None));

        await _admin.ResetPasswordAsync(ActorOf("admin"), created.Id, "Outra12345", mustChangePassword: false, Request, CancellationToken.None);
        Assert.Equal(("hash:Outra12345", false), (_users.Items[created.Id].PasswordHash, _users.Items[created.Id].MustChangePassword));
        await Assert.ThrowsAsync<NotFoundError>(() => _admin.ResetPasswordAsync(ActorOf("admin"), "nada", "x", true, Request, CancellationToken.None));
    }

    [Fact]
    public async Task Admin_edita_com_as_protecoes_e_exclui()
    {
        Add("admin", "admin@grana.app", UserRole.Admin);
        Add("u1", "ana@grana.app");
        var admin = ActorOf("admin");
        UpdateUserCommand Command(Patch<string> name = default, Patch<string> email = default, Patch<UserRole> role = default, Patch<UserStatus> status = default) =>
            new(name, email, role, status, """{"x":1}""");

        Assert.Equal("Já existe um usuário com este e-mail.",
            (await Assert.ThrowsAsync<ConflictError>(() => _admin.UpdateAsync(admin, "u1", Command(email: Patch.Set("ADMIN@grana.app")), Request, CancellationToken.None))).Message);
        Assert.Equal("Você não pode alterar o perfil da a própria conta.",
            (await Assert.ThrowsAsync<ForbiddenError>(() => _admin.UpdateAsync(admin, "admin", Command(role: Patch.Set(UserRole.User)), Request, CancellationToken.None))).Message);
        Assert.Equal("Você não pode alterar o status da a própria conta.",
            (await Assert.ThrowsAsync<ForbiddenError>(() => _admin.UpdateAsync(admin, "admin", Command(status: Patch.Set(UserStatus.Suspended)), Request, CancellationToken.None))).Message);

        var updated = await _admin.UpdateAsync(admin, "u1", Command(Patch.Set("Ana Nova"), Patch.Set("nova@grana.app"), Patch.Set(UserRole.Admin)), Request, CancellationToken.None);
        Assert.Equal(("Ana Nova", "nova@grana.app", "ADMIN"), (updated.Name, updated.Email, updated.Role));
        Assert.Equal("""{"changes":{"x":1}}""", _audit.Entries[^1].MetadataJson);

        // Dois admins ativos: suspender um é permitido e derruba as sessões dele.
        _sessions.Items.Add(new FakeSession("s-x", "u1", Now.AddDays(1), "h", null, null));
        var suspended = await _admin.UpdateAsync(admin, "u1", Command(status: Patch.Set(UserStatus.Suspended)), Request, CancellationToken.None);
        Assert.Equal("SUSPENDED", suspended.Status);
        Assert.NotNull(_sessions.Items.Single().RevokedAt);

        // Agora "admin" é o único ativo: rebaixar ou excluir outro admin ativo seria perder o último.
        Add("a2", "a2@grana.app", UserRole.Admin);
        _users.Items["admin"].Suspend(Now);
        Assert.Equal("Este é o último administrador ativo. Promova outro usuário antes de alterar este.",
            (await Assert.ThrowsAsync<BusinessRuleError>(() => _admin.UpdateAsync(ActorOf("u1"), "a2", Command(role: Patch.Set(UserRole.User)), Request, CancellationToken.None))).Message);
        await Assert.ThrowsAsync<BusinessRuleError>(() => _admin.UpdateAsync(ActorOf("u1"), "a2", Command(status: Patch.Set(UserStatus.Suspended)), Request, CancellationToken.None));
        Assert.Equal("Não é possível excluir o último administrador ativo.",
            (await Assert.ThrowsAsync<BusinessRuleError>(() => _admin.DeleteAsync(ActorOf("u1"), "a2", Request, CancellationToken.None))).Message);

        // ⚠️ Pedir PENDING ativa a conta (RN-057).
        Assert.Equal("ACTIVE", (await _admin.UpdateAsync(ActorOf("a2"), "u1", Command(status: Patch.Set(UserStatus.Pending)), Request, CancellationToken.None)).Status);

        Assert.Equal("Você não pode excluir a própria conta.",
            (await Assert.ThrowsAsync<ForbiddenError>(() => _admin.DeleteAsync(ActorOf("u1"), "u1", Request, CancellationToken.None))).Message);
        await _admin.DeleteAsync(ActorOf("a2"), "u1", Request, CancellationToken.None);
        Assert.False(_users.Items.ContainsKey("u1"));
        Assert.Equal("""{"email":"nova@grana.app"}""", _audit.Entries[^1].MetadataJson);
        await Assert.ThrowsAsync<NotFoundError>(() => _admin.DeleteAsync(admin, "u1", Request, CancellationToken.None));
        await Assert.ThrowsAsync<NotFoundError>(() => _admin.UpdateAsync(admin, "u1", Command(Patch.Set("x")), Request, CancellationToken.None));
    }
}

internal sealed class InMemoryUsers : IUserRepository
{
    public Dictionary<string, User> Items { get; } = [];

    public Task<User?> FindByIdAsync(string id, CancellationToken cancellationToken) => Task.FromResult(Items.GetValueOrDefault(id));

    public Task<User?> FindByEmailAsync(string email, CancellationToken cancellationToken) =>
        Task.FromResult(Items.Values.FirstOrDefault(u => string.Equals(u.Email.Value, email, StringComparison.OrdinalIgnoreCase)));

    public Task<bool> ExistsByEmailAsync(string email, string? exceptUserId, CancellationToken cancellationToken) =>
        Task.FromResult(Items.Values.Any(u => string.Equals(u.Email.Value, email, StringComparison.OrdinalIgnoreCase) && u.Id != exceptUserId));

    public Task<(IReadOnlyList<User> Items, long Total)> ListAsync(ListUsersFilter filter, CancellationToken cancellationToken)
    {
        var all = Items.Values.ToList();
        return Task.FromResult<(IReadOnlyList<User>, long)>(([.. all.Skip((int)((filter.Page - 1) * filter.PerPage)).Take((int)filter.PerPage)], all.Count));
    }

    public Task<long> CountActiveAdminsAsync(string? exceptUserId, CancellationToken cancellationToken) =>
        Task.FromResult((long)Items.Values.Count(u => u.IsAdmin && u.IsActive && u.Id != exceptUserId));

    public Task AddAsync(User user, CancellationToken cancellationToken)
    {
        Items[user.Id] = user;
        return Task.CompletedTask;
    }

    public Task SaveAsync(User user, CancellationToken cancellationToken) => Task.CompletedTask;

    public Task DeleteAsync(string id, CancellationToken cancellationToken)
    {
        Items.Remove(id);
        return Task.CompletedTask;
    }
}

internal sealed record FakeSession(string Id, string UserId, DateTime ExpiresAt, string Hash, string? Ip, string? UserAgent)
{
    public DateTime? RevokedAt { get; set; }

    public string? ReplacedBy { get; set; }
}

internal sealed class InMemorySessions : IRefreshTokenRepository
{
    public List<FakeSession> Items { get; } = [];

    public Task<RefreshTokenRecord> IssueAsync(string userId, string tokenHash, DateTime expiresAt, string? ip, string? userAgent, CancellationToken cancellationToken)
    {
        var session = new FakeSession($"s-{Items.Count + 1}", userId, expiresAt, tokenHash, ip, userAgent);
        Items.Add(session);
        return Task.FromResult(new RefreshTokenRecord(session.Id, userId, expiresAt, null));
    }

    public Task<RefreshTokenRecord?> FindByHashAsync(string tokenHash, CancellationToken cancellationToken) =>
        Task.FromResult(Items.FirstOrDefault(s => s.Hash == tokenHash) is { } s ? new RefreshTokenRecord(s.Id, s.UserId, s.ExpiresAt, s.RevokedAt) : null);

    public Task RevokeAsync(string id, string? replacedBy, CancellationToken cancellationToken)
    {
        var session = Items.Single(s => s.Id == id);
        session.RevokedAt = DateTime.UtcNow;
        session.ReplacedBy = replacedBy;
        return Task.CompletedTask;
    }

    public Task RevokeAllForUserAsync(string userId, CancellationToken cancellationToken)
    {
        foreach (var session in Items.Where(s => s.UserId == userId && s.RevokedAt is null)) session.RevokedAt = DateTime.UtcNow;
        return Task.CompletedTask;
    }
}

internal sealed class FakeHasher : IPasswordHasher
{
    public int Burned { get; private set; }

    public string Hash(string plainText) => $"hash:{plainText}";

    public bool Verify(string hash, string plainText) => hash == $"hash:{plainText}";

    public void BurnTime(string plainText) => Burned++;
}

internal sealed class FakeTokens(IClock clock) : ITokenService
{
    private int _next;

    public (string Token, long ExpiresIn) SignAccessToken(string userId, string email, UserRole role) => ($"token:{userId}", 900);

    public IssuedRefreshToken CreateRefreshToken()
    {
        var token = $"rt-{++_next}";
        return new IssuedRefreshToken(token, HashRefreshToken(token), clock.UtcNow.AddDays(7));
    }

    public string HashRefreshToken(string token) => $"h-{token}";
}

internal sealed class InMemoryAudit : IAuditLogger
{
    public List<AuditEntry> Entries { get; } = [];

    public Task RecordAsync(AuditEntry entry, CancellationToken cancellationToken)
    {
        Entries.Add(entry);
        return Task.CompletedTask;
    }
}

internal sealed class FakeProvisioner : IUserWorkspaceProvisioner
{
    public List<(string UserId, bool WithDefaults)> Calls { get; } = [];

    public Task ProvisionAsync(string userId, bool withDefaultCategories, CancellationToken cancellationToken)
    {
        Calls.Add((userId, withDefaultCategories));
        return Task.CompletedTask;
    }
}
