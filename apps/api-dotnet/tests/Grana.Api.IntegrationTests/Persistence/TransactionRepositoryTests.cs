using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;
using Grana.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Grana.Api.IntegrationTests.Persistence;

/// <summary>EfTransactionRepository contra o schema do Prisma: filtros, ILIKE, ordem e paginação.</summary>
public sealed class TransactionRepositoryTests : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 10, 26, 12, 0, 0, 0, DateTimeKind.Utc);

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
            INSERT INTO categories (id,"userId",name,color,kind,"updatedAt") VALUES
              ('mercado','u1','Mercado','verde','EXPENSE',NOW()), ('salario','u1','Salário','azul','INCOME',NOW()), ('alheia','u2','Mercado','verde','EXPENSE',NOW());
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

    private static readonly Category Market = Category.Restore("mercado", "u1", "Mercado", "verde", CategoryKind.Expense, false, null);
    private static readonly Category Salary = Category.Restore("salario", "u1", "Salário", "azul", CategoryKind.Income, false, null);

    private static TransactionFilter Filter(
        MonthRef? month = null, string? category = null, EntryType? type = null, string? search = null, long page = 1, long perPage = 20, string user = "u1") =>
        new(user, month, category, type, search, page, perPage);

    [Fact]
    public async Task Lancamentos_do_mes_e_media_dos_3_meses_fechados()
    {
        await using (var db = NewContext())
        {
            var repository = new EfTransactionRepository(db);
            var index = 0;
            async Task Add(Category category, EntryType type, int cents, string date) =>
                await repository.AddAsync(Transaction.Create($"m{index++}", "u1", category, type, cents, IsoDate.Parse(date), null, Now.AddSeconds(index)), CancellationToken.None);

            await Add(Market, EntryType.Expense, 100, "2026-06-30");
            await Add(Market, EntryType.Expense, 1000, "2026-07-01");
            await Add(Market, EntryType.Expense, 2000, "2026-08-15");
            await Add(Salary, EntryType.Income, 99999, "2026-08-16");
            await Add(Market, EntryType.Expense, 3001, "2026-09-30");
            await Add(Market, EntryType.Expense, 5000, "2026-10-01");
            await Add(Market, EntryType.Expense, 7000, "2026-10-01");
        }

        await using (var db = NewContext())
        {
            var repository = new EfTransactionRepository(db);
            Assert.Equal(["m6", "m5"], (await repository.ListForMonthAsync("u1", MonthRef.Parse("2026-10"), CancellationToken.None)).Select(t => t.Id));
            Assert.Empty(await repository.ListForMonthAsync("u2", MonthRef.Parse("2026-10"), CancellationToken.None));
            // Julho a setembro (fechados em relação a outubro): (1000 + 2000 + 3001) / 3 = 2000,33 → 2000.
            Assert.Equal(2000L, await repository.AverageMonthlyExpenseAsync("u1", 3, new DateTime(2026, 10, 26, 0, 0, 0, DateTimeKind.Utc), CancellationToken.None));
            // (1000 + 2000 + 3002) / 3 = 2000,67 → 2001 (Math.round).
            await repository.AddAsync(Transaction.Create("m7", "u1", Market, EntryType.Expense, 1, new DateOnly(2026, 9, 1), null, Now), CancellationToken.None);
            Assert.Equal(2001L, await repository.AverageMonthlyExpenseAsync("u1", 3, new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc), CancellationToken.None));
            Assert.Equal(0L, await repository.AverageMonthlyExpenseAsync("u2", 3, Now, CancellationToken.None));
        }
    }

    [Fact]
    public async Task Periodo_do_saldo_futuro_e_media_diaria()
    {
        await using (var db = NewContext())
        {
            var repository = new EfTransactionRepository(db);
            var index = 0;
            async Task Add(Category category, EntryType type, int cents, string date, string user = "u1") =>
                await repository.AddAsync(Transaction.Create($"d{index++}", user, category, type, cents, IsoDate.Parse(date), null, Now.AddSeconds(-index)), CancellationToken.None);

            await Add(Market, EntryType.Expense, 100, "2026-01-09");
            await Add(Market, EntryType.Expense, 7000, "2026-10-01");
            await Add(Market, EntryType.Expense, 1400, "2026-10-01");
            await Add(Salary, EntryType.Income, 50000, "2026-10-05");
            await Add(Market, EntryType.Expense, 300, "2026-10-14");
            await Add(Market, EntryType.Expense, 999, "2026-10-15");
        }

        await using (var db = NewContext())
        {
            var repository = new EfTransactionRepository(db);
            // Inclusive nas duas pontas, ordem occurredOn asc, createdAt asc.
            Assert.Equal(["d2", "d1", "d3", "d4", "d5"], (await repository.ListBetweenAsync("u1", new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 15), CancellationToken.None)).Select(t => t.Id));
            Assert.Empty(await repository.ListBetweenAsync("u2", new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), CancellationToken.None));

            var before = new DateOnly(2026, 10, 15);
            // Despesas de 17/07 a 14/10 (o dia 15 fica de fora): 7000 + 1400 + 300; 1º lançamento em 01/10, 14 dias → 8700 / 14 = 621,4 → 621.
            Assert.Equal(621L, await repository.AverageDailyExpenseAsync("u1", before, 90, CancellationToken.None));
            // Começou há menos de 7 dias: divide por 7 (ninguém tem a média diluída nem inflada demais).
            Assert.Equal(43L, await repository.AverageDailyExpenseAsync("u1", new DateOnly(2026, 10, 15), 1, CancellationToken.None));
            Assert.Equal(0L, await repository.AverageDailyExpenseAsync("u2", before, 90, CancellationToken.None));
            // De 02/10 a 30/12: 300 + 999; 1º lançamento em 14/10, 78 dias → 1299 / 78 = 16,65 → 17.
            Assert.Equal(17L, await repository.AverageDailyExpenseAsync("u1", new DateOnly(2026, 12, 31), 90, CancellationToken.None));
        }
    }

    [Fact]
    public async Task Filtros_ordem_paginacao_e_isolamento()
    {
        await using (var db = NewContext())
        {
            var repository = new EfTransactionRepository(db);
            var seconds = 0;
            async Task Add(string id, Category category, EntryType type, int cents, string date, string? note) =>
                await repository.AddAsync(Transaction.Create(id, "u1", category, type, cents, IsoDate.Parse(date), note, Now.AddSeconds(seconds++)), CancellationToken.None);

            await Add("t1", Market, EntryType.Expense, 1000, "2025-03-05", "Feira da Semana");
            await Add("t2", Market, EntryType.Expense, 2000, "2025-03-05", "cinema 100%");
            await Add("t3", Salary, EntryType.Income, 500000, "2025-03-05", null);
            await Add("t4", Market, EntryType.Expense, 3000, "2025-03-20", "");
            await Add("t5", Market, EntryType.Expense, 4000, "2025-04-01", "feira_extra");
        }

        await using (var db = NewContext())
        {
            var repository = new EfTransactionRepository(db);
            async Task<string> Ids(TransactionFilter filter) =>
                string.Join(',', (await repository.ListAsync(filter, CancellationToken.None)).Items.Select(t => t.Id));

            Assert.Equal("t5,t4,t3,t2,t1", await Ids(Filter()));
            Assert.Equal("t4,t3,t2,t1", await Ids(Filter(MonthRef.Parse("2025-03"))));
            Assert.Equal("t3", await Ids(Filter(type: EntryType.Income)));
            Assert.Equal("t5,t4,t2,t1", await Ids(Filter(category: "mercado")));
            Assert.Equal("t5,t1", await Ids(Filter(search: "FEIRA")));
            // ⚠️ Curingas do ILIKE, como no Prisma: "_" casa com qualquer letra.
            Assert.Equal("t5", await Ids(Filter(search: "a_e")));
            Assert.Equal("t5,t4,t2,t1", await Ids(Filter(search: "%")));
            Assert.Equal(string.Empty, await Ids(Filter(user: "u2")));

            var page = await repository.ListAsync(Filter(MonthRef.Parse("2025-03"), page: 2, perPage: 2), CancellationToken.None);
            Assert.Equal(("t2,t1", 4L), (string.Join(',', page.Items.Select(t => t.Id)), page.Total));

            var far = await repository.ListAsync(Filter(page: 9_007_199_254_740_991), CancellationToken.None);
            Assert.Equal((0, 5L), (far.Items.Count, far.Total));

            var found = (await repository.FindByIdAsync("u1", "t2", CancellationToken.None))!;
            Assert.Equal(new CategoryRef("mercado", "Mercado", "verde", CategoryKind.Expense), found.Category);
            Assert.Null(await repository.FindByIdAsync("u2", "t2", CancellationToken.None));

            found.ChangeCategory(Category.Restore("mercado", "u1", "Mercado", "verde", CategoryKind.Expense, false, null));
            found.ChangeNote(null);
            found.ChangeAmount(1);
            await repository.UpdateAsync(found, Now.AddHours(1), CancellationToken.None);
            await repository.DeleteAsync("u2", "t1", CancellationToken.None);
            await repository.DeleteAsync("u1", "t3", CancellationToken.None);
        }

        await using (var db = NewContext())
        {
            var repository = new EfTransactionRepository(db);
            var updated = (await repository.FindByIdAsync("u1", "t2", CancellationToken.None))!;
            Assert.Equal((1, (string?)null), (updated.AmountCents, updated.Note));
            Assert.NotNull(await repository.FindByIdAsync("u1", "t1", CancellationToken.None));
            Assert.Null(await repository.FindByIdAsync("u1", "t3", CancellationToken.None));
        }
    }
}
