using Grana.Domain.Common;
using Grana.Domain.Finance;
using Grana.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Grana.Api.IntegrationTests.Persistence;

/// <summary>Repositórios do M3 contra o schema do Prisma: ordem, extrato de 10, destaque e depósito.</summary>
public sealed class DebtGoalRepositoriesTests : IAsyncLifetime
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
            INSERT INTO categories (id,"userId",name,color,kind,"updatedAt") VALUES ('casa','u1','Casa','x','EXPENSE',NOW());
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

    [Fact]
    public async Task Dividas_por_ordem_de_criacao_e_crud()
    {
        await using (var db = NewContext())
        {
            var repository = new EfDebtRepository(db);
            await repository.AddAsync(Debt.Create("d2", "u1", "Segunda", 100, 0, 2), Now.AddSeconds(1), CancellationToken.None);
            await repository.AddAsync(Debt.Create("d1", "u1", "Primeira", 100, 0, 2), Now, CancellationToken.None);
            await repository.AddAsync(Debt.Create("d3", "u2", "Alheia", 100, 0, 2), Now, CancellationToken.None);
            var first = (await repository.FindByIdAsync("u1", "d1", CancellationToken.None))!;
            first.Update(Patch.Set("Paga"), default, Patch.Set(2), default);
            await repository.UpdateAsync(first, Now, CancellationToken.None);
        }

        await using (var db = NewContext())
        {
            var repository = new EfDebtRepository(db);
            Assert.Equal(["d1", "d2"], (await repository.ListAsync("u1", CancellationToken.None)).Select(d => d.Id));
            Assert.True((await repository.FindByIdAsync("u1", "d1", CancellationToken.None))!.Settled);
            Assert.Null(await repository.FindByIdAsync("u1", "d3", CancellationToken.None));
            await repository.DeleteAsync("u1", "d3", CancellationToken.None);
            await repository.DeleteAsync("u1", "d1", CancellationToken.None);
            Assert.Equal(["d2"], (await repository.ListAsync("u1", CancellationToken.None)).Select(d => d.Id));
            Assert.Single(await repository.ListAsync("u2", CancellationToken.None));
        }
    }

    [Fact]
    public async Task Metas_ordem_destaque_extrato_de_10_e_deposito_no_banco()
    {
        await using (var db = NewContext())
        {
            var repository = new EfGoalRepository(db);
            await repository.AddAsync(Goal.Create("g1", "u1", "Viagem", 100000, 0, featured: true), Now, CancellationToken.None);
            await repository.AddAsync(Goal.Create("g2", "u1", "Reserva", 5000, 0, featured: true), Now.AddSeconds(1), CancellationToken.None);
            await repository.AddAsync(Goal.Create("g3", "u2", "Alheia", 5000, 0, featured: true), Now, CancellationToken.None);
            await repository.ClearFeaturedAsync("u1", "g2", Now, CancellationToken.None);
            for (var index = 1; index <= 12; index++)
            {
                await repository.AddDepositAsync("u1", "g1", $"dep-{index:D2}", index * 100, Now.AddMinutes(index), CancellationToken.None);
            }
        }

        await using (var db = NewContext())
        {
            var repository = new EfGoalRepository(db);
            var goals = await repository.ListAsync("u1", CancellationToken.None);
            Assert.Equal([("g2", true), ("g1", false)], goals.Select(g => (g.Id, g.Featured)));
            Assert.True((await repository.FindByIdAsync("u2", "g3", CancellationToken.None))!.Featured);

            var trip = goals[1];
            Assert.Equal(7800, trip.SavedCents);
            Assert.Equal([1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300], trip.Deposits.Select(d => d.AmountCents));
            Assert.Equal(Now.AddMinutes(12), trip.Deposits[0].CreatedAt);

            trip.Update(Patch.Set("Praia"), default, Patch.Set(0), Patch.Set(true));
            await repository.UpdateAsync(trip, Now, CancellationToken.None);
            var edited = (await repository.FindByIdAsync("u1", "g1", CancellationToken.None))!;
            Assert.Equal(("Praia", 0, 10), (edited.Name, edited.SavedCents, edited.Deposits.Count));

            // Estouro do INTEGER na soma feita pelo banco: a transação inteira volta.
            await repository.UpdateAsync(Goal.Restore("g2", "u1", "Reserva", 5000, int.MaxValue, true, []), Now, CancellationToken.None);
            await Assert.ThrowsAnyAsync<PostgresException>(() => repository.AddDepositAsync("u1", "g2", "dep-x", 1, Now, CancellationToken.None));
        }

        await using (var db = NewContext())
        {
            var repository = new EfGoalRepository(db);
            Assert.Empty((await repository.FindByIdAsync("u1", "g2", CancellationToken.None))!.Deposits);
            await repository.DeleteAsync("u1", "g1", CancellationToken.None);
            Assert.Null(await repository.FindByIdAsync("u1", "g1", CancellationToken.None));
            Assert.Equal(0, await db.GoalDeposits.CountAsync(d => d.GoalId == "g1"));
        }
    }
}
