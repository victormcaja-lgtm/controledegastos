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
