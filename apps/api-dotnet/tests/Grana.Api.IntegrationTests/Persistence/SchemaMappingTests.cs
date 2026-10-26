using Grana.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Grana.Api.IntegrationTests.Persistence;

/// <summary>
/// T-009 (R-10, R-11): o mapeamento EF Core lê e grava as tabelas criadas pelas
/// migrations do PRISMA exatamente como o Node — sem nenhuma migration do EF.
/// </summary>
public sealed class SchemaMappingTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine").Build();
    private NpgsqlDataSource _dataSource = null!;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();
        _dataSource = GranaDbContext.CreateDataSource(_postgres.GetConnectionString());

        // Mesmas migrations que a API Node aplica em produção (prisma migrate deploy).
        await using var raw = NpgsqlDataSource.Create(_postgres.GetConnectionString());
        foreach (var migration in Directory.GetDirectories(Path.Combine(RepoRoot(), "apps", "api", "prisma", "migrations")).Order(StringComparer.Ordinal))
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

    private async Task ExecuteAsync(string sql)
    {
        await using var command = _dataSource.CreateCommand(sql);
        await command.ExecuteNonQueryAsync();
    }

    private async Task<string?> ScalarAsync(string sql)
    {
        await using var command = _dataSource.CreateCommand(sql);
        return (await command.ExecuteScalarAsync())?.ToString();
    }

    private static readonly DateTime Instant = new(2026, 10, 20, 13, 5, 9, 123, DateTimeKind.Utc);

    [Fact]
    public async Task Le_uma_linha_de_cada_tabela_gravada_como_o_Prisma_grava()
    {
        // Como o Prisma grava: ids UUID em texto, timestamps UTC sem fuso, enums nativos.
        await ExecuteAsync("""
            INSERT INTO "users" ("id","name","email","passwordHash","role","status","mustChangePassword","failedLoginAttempts","lockedUntil","lastLoginAt","createdAt","updatedAt")
              VALUES ('u1','Ana','ana@grana.app','$argon2id$x','ADMIN','PENDING',true,3,'2026-10-20 13:05:09.123',NULL,'2026-10-20 13:05:09.123','2026-10-20 13:05:09.123');
            INSERT INTO "refresh_tokens" ("id","tokenHash","userId","expiresAt","revokedAt","replacedBy","userAgent","ip","createdAt")
              VALUES ('r1','abc','u1','2026-10-27 13:05:09.123',NULL,'r2','paridade/1.0','10.0.0.1','2026-10-20 13:05:09.123');
            INSERT INTO "audit_logs" ("id","action","targetType","targetId","actorId","actorEmail","ip","metadata","createdAt")
              VALUES ('a1','user.updated','User','u1','u1','ana@grana.app',NULL,'{"changes":{"name":"Ana"}}','2026-10-20 13:05:09.123');
            INSERT INTO "user_settings" ("userId","roundCents","openingBalanceCents","openingDate","dailyBudgetCents","updatedAt")
              VALUES ('u1',true,-12345,'2026-10-01',NULL,'2026-10-20 13:05:09.123');
            INSERT INTO "categories" ("id","userId","name","color","kind","isSystem","archivedAt","createdAt","updatedAt")
              VALUES ('c1','u1','Mercado','oklch(0.62 0.10 145)','EXPENSE',true,NULL,'2026-10-20 13:05:09.123','2026-10-20 13:05:09.123');
            INSERT INTO "transactions" ("id","userId","categoryId","type","amountCents","occurredOn","note","billId","createdAt","updatedAt")
              VALUES ('t1','u1','c1','EXPENSE',1250,'2026-03-03','',NULL,'2026-10-20 13:05:09.123','2026-10-20 13:05:09.123');
            INSERT INTO "bills" ("id","userId","categoryId","name","amountCents","dueDay","active","startMonth","totalInstallments","createdAt","updatedAt")
              VALUES ('b1','u1','c1','Aluguel',120000,31,true,'2026-10-01',12,'2026-10-20 13:05:09.123','2026-10-20 13:05:09.123');
            INSERT INTO "bill_payments" ("id","billId","userId","referenceMonth","amountCents","paidAt","status")
              VALUES ('p1','b1','u1','2026-10-01',121000,'2026-10-20 13:05:09.123','WAIVED');
            INSERT INTO "incomes" ("id","userId","name","amountCents","receiptDay","active","createdAt","updatedAt")
              VALUES ('i1','u1','Salário',500000,5,false,'2026-10-20 13:05:09.123','2026-10-20 13:05:09.123');
            INSERT INTO "debts" ("id","userId","name","installmentCents","paidInstallments","totalInstallments","createdAt","updatedAt")
              VALUES ('d1','u1','Sofá',25000,2,10,'2026-10-20 13:05:09.123','2026-10-20 13:05:09.123');
            INSERT INTO "goals" ("id","userId","name","targetCents","savedCents","featured","createdAt","updatedAt")
              VALUES ('g1','u1','Viagem',100000,2500,true,'2026-10-20 13:05:09.123','2026-10-20 13:05:09.123');
            INSERT INTO "goal_deposits" ("id","goalId","amountCents","createdAt") VALUES ('gd1','g1',2500,'2026-10-20 13:05:09.123');
            INSERT INTO "cards" ("id","userId","name","closingDay","dueDay","limitCents","active","createdAt","updatedAt")
              VALUES ('k1','u1','Visa',3,10,NULL,true,'2026-10-20 13:05:09.123','2026-10-20 13:05:09.123');
            INSERT INTO "card_purchases" ("id","userId","cardId","categoryId","amountCents","installments","purchasedOn","note","createdAt")
              VALUES ('cp1','u1','k1','c1',30001,3,'2026-06-20',NULL,'2026-10-20 13:05:09.123');
            """);

        await using var db = NewContext();
        var user = await db.Users.SingleAsync();
        Assert.Equal((UserRoleDb.ADMIN, UserStatusDb.PENDING, true, 3), (user.Role, user.Status, user.MustChangePassword, user.FailedLoginAttempts));
        Assert.Equal(Instant, user.CreatedAt);
        Assert.Equal(DateTimeKind.Utc, user.CreatedAt.Kind);
        Assert.Equal(Instant, user.LockedUntil);
        Assert.Null(user.LastLoginAt);

        var token = await db.RefreshTokens.SingleAsync();
        Assert.Equal(("abc", "r2", "paridade/1.0"), (token.TokenHash, token.ReplacedBy, token.UserAgent));

        var audit = await db.AuditLogs.SingleAsync();
        Assert.Equal("Ana", audit.Metadata!.RootElement.GetProperty("changes").GetProperty("name").GetString());

        var settings = await db.UserSettings.SingleAsync();
        Assert.Equal((true, true, -12345, new DateOnly(2026, 10, 1), (int?)null),
            (settings.RoundCents, settings.OverspendAlerts, settings.OpeningBalanceCents, settings.OpeningDate, settings.DailyBudgetCents));

        var transaction = await db.Transactions.Include(t => t.Category).SingleAsync();
        Assert.Equal((EntryTypeDb.EXPENSE, 1250, new DateOnly(2026, 3, 3), ""), (transaction.Type, transaction.AmountCents, transaction.OccurredOn, transaction.Note));
        Assert.Equal(CategoryKindDb.EXPENSE, transaction.Category!.Kind);

        var bill = await db.Bills.SingleAsync();
        Assert.Equal((31, new DateOnly(2026, 10, 1), (int?)12), (bill.DueDay, bill.StartMonth, bill.TotalInstallments));
        var payment = await db.BillPayments.SingleAsync();
        Assert.Equal((BillPaymentStatusDb.WAIVED, 121000, new DateOnly(2026, 10, 1)), (payment.Status, payment.AmountCents, payment.ReferenceMonth));

        Assert.False((await db.Incomes.SingleAsync()).Active);
        Assert.Equal(2, (await db.Debts.SingleAsync()).PaidInstallments);
        var goal = await db.Goals.Include(g => g.Deposits).SingleAsync();
        Assert.Equal(2500, goal.Deposits.Single().AmountCents);
        Assert.Null((await db.Cards.SingleAsync()).LimitCents);
        var purchase = await db.CardPurchases.SingleAsync();
        Assert.Equal((3, new DateOnly(2026, 6, 20), (string?)null), (purchase.Installments, purchase.PurchasedOn, purchase.Note));
    }

    [Fact]
    public async Task Grava_no_mesmo_formato_do_Node()
    {
        var withTicks = Instant.AddTicks(4_567); // 0,4567 ms a mais: o banco deve guardar .123, como o JS
        await using (var db = NewContext())
        {
            db.Users.Add(new UserRow
            {
                Id = "u2",
                Name = "Bia",
                Email = "bia@grana.app",
                PasswordHash = "$argon2id$y",
                Role = UserRoleDb.USER,
                Status = UserStatusDb.ACTIVE,
                CreatedAt = withTicks,
                UpdatedAt = withTicks,
            });
            db.Categories.Add(new CategoryRow
            {
                Id = "c2", UserId = "u2", Name = "Salário", Color = "#fff", Kind = CategoryKindDb.INCOME,
                CreatedAt = withTicks, UpdatedAt = withTicks,
            });
            db.Transactions.Add(new TransactionRow
            {
                Id = "t2", UserId = "u2", CategoryId = "c2", Type = EntryTypeDb.INCOME, AmountCents = 2_147_483_647,
                OccurredOn = new DateOnly(2026, 10, 20), CreatedAt = withTicks, UpdatedAt = withTicks,
            });
            await db.SaveChangesAsync();
        }

        Assert.Equal("2026-10-20 13:05:09.123", await ScalarAsync("""SELECT to_char("createdAt",'YYYY-MM-DD HH24:MI:SS.MS') FROM "users" WHERE id='u2'"""));
        Assert.Equal("USER|ACTIVE", await ScalarAsync("""SELECT "role"::text || '|' || "status"::text FROM "users" WHERE id='u2'"""));
        Assert.Equal("INCOME|INCOME", await ScalarAsync("""SELECT c."kind"::text || '|' || t."type"::text FROM "transactions" t JOIN "categories" c ON c.id = t."categoryId" """));
        Assert.Equal("2026-10-20", await ScalarAsync("""SELECT to_char("occurredOn",'YYYY-MM-DD') FROM "transactions" """));
        // O .NET grava todas as colunas explicitamente (como o Prisma faz no create).
        Assert.Equal("false|0", await ScalarAsync("""SELECT "mustChangePassword"::text || '|' || "failedLoginAttempts" FROM "users" WHERE id='u2'"""));
    }

    private static string RepoRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "apps", "api", "prisma", "migrations")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new InvalidOperationException("Raiz do repositório não encontrada.");
    }
}
