using Grana.Application.Common;
using Grana.Application.Identity;
using Grana.Api.IntegrationTests.Persistence;
using Grana.Domain.Common;
using Grana.Domain.Identity;
using Grana.Infrastructure;
using Grana.Infrastructure.Identity;
using Grana.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Grana.Api.IntegrationTests.Identity;

/// <summary>Repositórios, auditoria e provisionamento do Identity contra o schema do Prisma.</summary>
public sealed class IdentityRepositoriesTests : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 10, 29, 12, 0, 0, 0, DateTimeKind.Utc);

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine").Build();
    private NpgsqlDataSource _dataSource = null!;

    private sealed class FixedClock : IClock
    {
        public DateTime UtcNow { get; set; } = Now;
    }

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();
        _dataSource = GranaDbContext.CreateDataSource(_postgres.GetConnectionString());
        await using var raw = NpgsqlDataSource.Create(_postgres.GetConnectionString());
        foreach (var migration in Directory.GetDirectories(Path.Combine(SchemaMappingTests.RepoRoot(), "apps", "api", "prisma", "migrations")).Order(StringComparer.Ordinal))
        {
            await using var command = raw.CreateCommand(await File.ReadAllTextAsync(Path.Combine(migration, "migration.sql")));
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync()
    {
        await _dataSource.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    private GranaDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<GranaDbContext>();
        GranaDbContext.Configure(options, _dataSource);
        return new GranaDbContext(options.Options);
    }

    private async Task<string?> Scalar(string sql)
    {
        await using var command = _dataSource.CreateCommand(sql);
        return (await command.ExecuteScalarAsync())?.ToString();
    }

    private static User NewUser(string id, string email, UserRole role, UserStatus status, int minutes) =>
        User.Create(id, $"Pessoa {id}", EmailAddress.Create(email), "hash", role, status, mustChangePassword: false, Now.AddMinutes(minutes));

    [Fact]
    public async Task Usuarios_busca_filtros_ordem_admins_e_cascata()
    {
        await using (var db = NewContext())
        {
            var users = new EfUserRepository(db);
            await users.AddAsync(NewUser("u1", "ana@grana.app", UserRole.Admin, UserStatus.Active, 0), CancellationToken.None);
            await users.AddAsync(NewUser("u2", "bia_x@grana.app", UserRole.User, UserStatus.Pending, 1), CancellationToken.None);
            await users.AddAsync(NewUser("u3", "caio@grana.app", UserRole.Admin, UserStatus.Suspended, 2), CancellationToken.None);

            var ana = (await users.FindByEmailAsync("ANA@grana.app", CancellationToken.None))!;
            ana.RegisterFailedLogin(Now);
            ana.Touch(Now.AddHours(1));
            await users.SaveAsync(ana, CancellationToken.None);
        }

        await using (var db = NewContext())
        {
            var users = new EfUserRepository(db);
            var ana = (await users.FindByIdAsync("u1", CancellationToken.None))!;
            Assert.Equal((1, Now.AddHours(1), Now), (ana.FailedLoginAttempts, ana.UpdatedAt, ana.CreatedAt));
            Assert.Null(await users.FindByIdAsync("nada", CancellationToken.None));
            Assert.Null(await users.FindByEmailAsync("nada@grana.app", CancellationToken.None));
            Assert.True(await users.ExistsByEmailAsync("Ana@grana.app", null, CancellationToken.None));
            Assert.False(await users.ExistsByEmailAsync("ana@grana.app", "u1", CancellationToken.None));

            async Task<string> Ids(ListUsersFilter filter) => string.Join(',', (await users.ListAsync(filter, CancellationToken.None)).Items.Select(u => u.Id));
            Assert.Equal("u3,u2,u1", await Ids(new ListUsersFilter(1, 20, null, null, null)));
            Assert.Equal("u3,u1", await Ids(new ListUsersFilter(1, 20, null, UserRole.Admin, null)));
            Assert.Equal("u2", await Ids(new ListUsersFilter(1, 20, null, null, UserStatus.Pending)));
            Assert.Equal("u1", await Ids(new ListUsersFilter(1, 20, "ANA@", null, null)));
            Assert.Equal("u3,u2,u1", await Ids(new ListUsersFilter(1, 20, "PESSOA", null, null)));
            // ⚠️ `_` vira curinga, como no Prisma: "a_x" casa com "bia_x" e só com ele aqui.
            Assert.Equal("u2", await Ids(new ListUsersFilter(1, 20, "a_x", null, null)));
            Assert.Equal("u2", await Ids(new ListUsersFilter(2, 1, null, null, null)));
            Assert.Equal((0, 3L), ((await users.ListAsync(new ListUsersFilter(9_000_000_000_000, 100, null, null, null), CancellationToken.None)).Items.Count, 3L));

            Assert.Equal(1L, await users.CountActiveAdminsAsync(null, CancellationToken.None));
            Assert.Equal(0L, await users.CountActiveAdminsAsync("u1", CancellationToken.None));

            await db.Database.ExecuteSqlRawAsync("""INSERT INTO user_settings ("userId","updatedAt") VALUES ('u2', NOW())""");
            await users.DeleteAsync("u2", CancellationToken.None);
            Assert.Equal("0", await Scalar("""SELECT count(*) FROM user_settings WHERE "userId"='u2'"""));
        }

        await Scalar("""UPDATE users SET email='invalido' WHERE id='u3'""");
        await using (var db = NewContext())
        {
            // O Node valida o e-mail ao ler (Email.create no mapper): fora do padrão vira 422.
            await Assert.ThrowsAsync<ValidationError>(() => new EfUserRepository(db).FindByIdAsync("u3", CancellationToken.None));
        }
    }

    [Fact]
    public async Task Sessoes_emitir_achar_revogar_e_derrubar_todas()
    {
        await Scalar("""INSERT INTO users (id,name,email,"passwordHash","updatedAt") VALUES ('s1','S','s1@grana.app','h',NOW())""");
        var clock = new FixedClock();
        await using var db = NewContext();
        var sessions = new EfRefreshTokenRepository(db, clock, new GuidIdGenerator());
        var first = await sessions.IssueAsync("s1", "hash-1", Now.AddDays(7), new string('9', 80), new string('u', 300), CancellationToken.None);
        var second = await sessions.IssueAsync("s1", "hash-2", Now.AddDays(7), null, null, CancellationToken.None);

        Assert.Equal(first, await sessions.FindByHashAsync("hash-1", CancellationToken.None));
        Assert.Null(await sessions.FindByHashAsync("nada", CancellationToken.None));
        Assert.Equal("64|255", await Scalar("""SELECT length(ip) || '|' || length("userAgent") FROM refresh_tokens WHERE "tokenHash"='hash-1'"""));

        clock.UtcNow = Now.AddMinutes(5);
        await sessions.RevokeAsync(first.Id, second.Id, CancellationToken.None);
        var revoked = (await sessions.FindByHashAsync("hash-1", CancellationToken.None))!;
        Assert.Equal(Now.AddMinutes(5), revoked.RevokedAt);
        Assert.Equal(second.Id, await Scalar("""SELECT "replacedBy" FROM refresh_tokens WHERE "tokenHash"='hash-1'"""));

        await sessions.RevokeAllForUserAsync("s1", CancellationToken.None);
        Assert.NotNull((await sessions.FindByHashAsync("hash-2", CancellationToken.None))!.RevokedAt);
    }

    [Fact]
    public async Task Auditoria_grava_e_engole_falhas_provisionamento_e_idempotente()
    {
        await Scalar("""INSERT INTO users (id,name,email,"passwordHash","updatedAt") VALUES ('a1','A','a1@grana.app','h',NOW())""");
        var clock = new FixedClock();
        var audit = new AuditLogger(_dataSource, clock, new GuidIdGenerator(), NullLogger<AuditLogger>.Instance);
        await audit.RecordAsync(new AuditEntry("user.created", "User", "alvo", "a1", "a1@grana.app", new string('1', 70), """{"email":"x@y.zz","role":"USER"}"""), CancellationToken.None);
        await audit.RecordAsync(new AuditEntry("auth.login.failed", "User"), CancellationToken.None);
        // actorId que não existe viola a FK: a falha é engolida, como no Node.
        await audit.RecordAsync(new AuditEntry("x", "User", ActorId: "fantasma"), CancellationToken.None);

        Assert.Equal("2", await Scalar("SELECT count(*) FROM audit_logs"));
        Assert.Equal("USER|64", await Scalar("""SELECT metadata->>'role' || '|' || length(ip) FROM audit_logs WHERE action='user.created'"""));

        var provisioner = new WorkspaceProvisioner(_dataSource, clock, new GuidIdGenerator());
        await provisioner.ProvisionAsync("a1", withDefaultCategories: false, CancellationToken.None);
        Assert.Equal("1|0", await Scalar("""SELECT (SELECT count(*) FROM user_settings WHERE "userId"='a1') || '|' || (SELECT count(*) FROM categories WHERE "userId"='a1')"""));
        await provisioner.ProvisionAsync("a1", withDefaultCategories: true, CancellationToken.None);
        await provisioner.ProvisionAsync("a1", withDefaultCategories: true, CancellationToken.None);
        Assert.Equal("11|8|11", await Scalar("""SELECT count(*) || '|' || count(*) FILTER (WHERE kind='EXPENSE') || '|' || count(*) FILTER (WHERE "isSystem") FROM categories WHERE "userId"='a1'"""));
    }

    [Fact]
    public void Registra_os_servicos_do_Identity_so_com_segredo()
    {
        var withTokens = new Microsoft.Extensions.DependencyInjection.ServiceCollection()
            .AddGranaInfrastructure(_postgres.GetConnectionString(), new TokenOptions("segredo-de-teste-com-mais-de-32-caracteres!", "15m", 7));
        Assert.Contains(withTokens, service => service.ServiceType == typeof(ITokenService));
        var without = new Microsoft.Extensions.DependencyInjection.ServiceCollection().AddGranaInfrastructure(_postgres.GetConnectionString());
        Assert.DoesNotContain(without, service => service.ServiceType == typeof(ITokenService));
    }
}
