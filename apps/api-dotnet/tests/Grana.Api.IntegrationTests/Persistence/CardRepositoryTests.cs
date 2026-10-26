using Grana.Domain.Common;
using Grana.Domain.Finance;
using Grana.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Grana.Api.IntegrationTests.Persistence;

/// <summary>EfCardRepository contra o schema do Prisma: ordens, compras, isolamento e cascata.</summary>
public sealed class CardRepositoryTests : IAsyncLifetime
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
            INSERT INTO categories (id,"userId",name,color,kind,"updatedAt") VALUES ('mercado','u1','Mercado','verde','EXPENSE',NOW());
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

    [Fact]
    public async Task Cartoes_compras_ordens_e_cascata()
    {
        await using (var db = NewContext())
        {
            var repository = new EfCardRepository(db);
            var visa = Card.Create("visa", "u1", "Visa", 31, 10, 500000);
            var elo = Card.Create("elo", "u1", "Elo", 1, 8, null);
            await repository.AddAsync(elo, Now.AddSeconds(1), CancellationToken.None);
            await repository.AddAsync(visa, Now, CancellationToken.None);
            await repository.AddAsync(Card.Create("alheio", "u2", "X", 1, 1, null), Now, CancellationToken.None);
            visa.Update(default, default, default, default, Patch.Set(false));
            await repository.UpdateAsync(visa, Now, CancellationToken.None);

            await repository.AddPurchaseAsync(CardPurchase.Create("p1", elo, Market, 100, 1, new DateOnly(2026, 10, 1), null, Now), CancellationToken.None);
            await repository.AddPurchaseAsync(CardPurchase.Create("p2", elo, Market, 200, 2, new DateOnly(2026, 10, 1), "Feira", Now.AddSeconds(1)), CancellationToken.None);
            await repository.AddPurchaseAsync(CardPurchase.Create("p3", visa, Market, 300, 3, new DateOnly(2026, 10, 9), null, Now), CancellationToken.None);
        }

        await using (var db = NewContext())
        {
            var repository = new EfCardRepository(db);
            Assert.Equal(["elo", "visa"], (await repository.ListAsync("u1", CancellationToken.None)).Select(c => c.Id));
            Assert.False((await repository.FindByIdAsync("u1", "visa", CancellationToken.None))!.Active);
            Assert.Null(await repository.FindByIdAsync("u1", "alheio", CancellationToken.None));

            Assert.Equal(["p3", "p2", "p1"], (await repository.ListPurchasesAsync("u1", null, CancellationToken.None)).Select(p => p.Id));
            Assert.Equal(["p2", "p1"], (await repository.ListPurchasesAsync("u1", "elo", CancellationToken.None)).Select(p => p.Id));
            var feira = (await repository.FindPurchaseAsync("u1", "p2", CancellationToken.None))!;
            Assert.Equal(("Feira", 2, new CategoryRef("mercado", "Mercado", "verde", CategoryKind.Expense)), (feira.Note, feira.Installments, feira.Category));
            Assert.Null(await repository.FindPurchaseAsync("u2", "p2", CancellationToken.None));

            await repository.DeletePurchaseAsync("u2", "p1", CancellationToken.None);
            await repository.DeletePurchaseAsync("u1", "p1", CancellationToken.None);
            Assert.Null(await repository.FindPurchaseAsync("u1", "p1", CancellationToken.None));

            await repository.DeleteAsync("u1", "elo", CancellationToken.None);
            Assert.Null(await repository.FindPurchaseAsync("u1", "p2", CancellationToken.None));
            Assert.Single(await repository.ListAsync("u2", CancellationToken.None));
        }
    }
}
