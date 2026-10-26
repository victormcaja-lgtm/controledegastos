using Grana.Domain.Common;
using Grana.Domain.Finance;
using Grana.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Grana.Api.IntegrationTests.Persistence;

/// <summary>EfBillRepository contra o schema do Prisma: ordens, baixas (upsert), cascata e conta da conversão.</summary>
public sealed class BillRepositoryTests : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 10, 26, 12, 0, 0, 0, DateTimeKind.Utc);
    private static readonly MonthRef October = MonthRef.Parse("2026-10");

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine").Build();
    private NpgsqlDataSource _dataSource = null!;

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

        await using var seed = raw.CreateCommand("""
            INSERT INTO users (id,name,email,"passwordHash","updatedAt") VALUES ('u1','Ana','ana@x.y','h',NOW()), ('u2','Bia','bia@x.y','h',NOW());
            INSERT INTO categories (id,"userId",name,color,kind,"updatedAt") VALUES ('casa','u1','Casa','x','EXPENSE',NOW()), ('luz','u1','Luz','z','EXPENSE',NOW()), ('alheia','u2','Casa','x','EXPENSE',NOW());
            """);
        await seed.ExecuteNonQueryAsync();
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

    private static readonly Category House = Category.Restore("casa", "u1", "Casa", "x", CategoryKind.Expense, false, null);

    [Fact]
    public async Task Ordens_edicao_baixas_e_exclusao_em_cascata()
    {
        await using (var db = NewContext())
        {
            var repository = new EfBillRepository(db);
            await repository.AddAsync(Bill.Create("b-inativa", "u1", House, "Academia", 9000, 1, null, October), Now, CancellationToken.None);
            await repository.AddAsync(Bill.Create("b-dia5", "u1", House, "Aluguel", 100000, 5, null, October), Now, CancellationToken.None);
            await repository.AddAsync(Bill.Create("b-dia1", "u1", House, "TV", 5000, 1, 3, October), Now, CancellationToken.None);
            await repository.AddAsync(Bill.Create("b-alheia", "u2", Category.Restore("alheia", "u2", "Casa", "x", CategoryKind.Expense, false, null), "X", 1, 1, null, October), Now, CancellationToken.None);

            var gym = (await repository.FindByIdAsync("u1", "b-inativa", CancellationToken.None))!;
            gym.ChangeCategory(Category.Restore("luz", "u1", "Luz", "z", CategoryKind.Expense, false, null));
            gym.Update(Patch.Set("Academia+"), default, default, Patch.Set(false), Patch.Set<int?>(2));
            await repository.UpdateAsync(gym, Now, CancellationToken.None);

            await repository.MarkPaidAsync("u1", "b-dia5", October, 100000, BillPaymentStatus.Paid, "p1", Now, CancellationToken.None);
            await repository.MarkPaidAsync("u1", "b-dia5", October, 101500, BillPaymentStatus.Paid, "p-ignorado", Now.AddHours(1), CancellationToken.None);
            await repository.MarkPaidAsync("u1", "b-dia1", MonthRef.Parse("2026-11"), 5000, BillPaymentStatus.Waived, "p2", Now, CancellationToken.None);
            await repository.MarkPaidAsync("u1", "b-dia1", MonthRef.Parse("2026-08"), 5000, BillPaymentStatus.Paid, "p3", Now, CancellationToken.None);
        }

        await using (var db = NewContext())
        {
            var repository = new EfBillRepository(db);
            Assert.Equal(["b-dia1", "b-dia5", "b-inativa"], (await repository.ListAllAsync("u1", CancellationToken.None)).Select(b => b.Id));
            Assert.Equal(["b-dia1", "b-dia5"], (await repository.ListActiveAsync("u1", CancellationToken.None)).Select(b => b.Id));
            var gym = (await repository.FindByIdAsync("u1", "b-inativa", CancellationToken.None))!;
            Assert.Equal(("Academia+", "luz", false, (int?)2, October), (gym.Name, gym.Category.Id, gym.Active, gym.TotalInstallments, gym.StartMonth));
            Assert.Null(await repository.FindByIdAsync("u1", "b-alheia", CancellationToken.None));

            var october = (await repository.PaymentsForMonthAsync("u1", October, CancellationToken.None)).Single();
            Assert.Equal(new BillPayment("b-dia5", October, BillPaymentStatus.Paid, 101500, Now.AddHours(1)), october);
            Assert.Equal(["2026-10", "2026-11"], (await repository.PaymentsSinceAsync("u1", October, CancellationToken.None)).Select(p => p.Month.Value).Order(StringComparer.Ordinal));
            Assert.Equal(BillPaymentStatus.Waived, (await repository.PaymentsForMonthAsync("u1", MonthRef.Parse("2026-11"), CancellationToken.None)).Single().Status);
            Assert.Equal("p1", (await db.BillPayments.SingleAsync(p => p.BillId == "b-dia5")).Id);

            await repository.MarkUnpaidAsync("u2", "b-dia5", October, CancellationToken.None);
            await repository.MarkUnpaidAsync("u1", "b-dia5", October, CancellationToken.None);
            Assert.Empty(await repository.PaymentsForMonthAsync("u1", October, CancellationToken.None));

            await repository.DeleteAsync("u2", "b-dia1", CancellationToken.None);
            await repository.DeleteAsync("u1", "b-dia1", CancellationToken.None);
            Assert.Equal(0, await db.BillPayments.CountAsync(p => p.BillId == "b-dia1"));
            Assert.NotNull(await repository.FindByIdAsync("u2", "b-alheia", CancellationToken.None));
        }
    }

    [Fact]
    public async Task Conta_criada_pela_conversao_e_lida_de_volta()
    {
        var bill = Bill.FromDebt("conv", Debt.Create("d", "u1", "Sofá", 25000, 4, 10), House, 15, October);
        await using (var db = NewContext())
        {
            await new EfBillRepository(db).AddAsync(bill, Now, CancellationToken.None);
        }

        await using (var db = NewContext())
        {
            var row = await db.Bills.AsNoTracking().Include(b => b.Category).SingleAsync(b => b.Id == "conv");
            Assert.Equal((new DateOnly(2026, 10, 1), (int?)6, true, Now), (row.StartMonth, row.TotalInstallments, row.Active, row.CreatedAt));
            var restored = EfBillRepository.ToDomain(row);
            Assert.Equal((bill.Name, bill.StartMonth, bill.Category), (restored.Name, restored.StartMonth, restored.Category));
            row.Category = null;
            Assert.Throws<InvalidOperationException>(() => EfBillRepository.ToDomain(row));
        }
    }
}
