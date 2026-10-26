using Grana.Domain.Finance;
using Grana.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Grana.Api.IntegrationTests.Persistence;

/// <summary>
/// Repositórios do M1 contra o schema das migrations do Prisma: ordem pelo SQL,
/// ILIKE sem escape, contagem de uso, upsert dos ajustes e isolamento por usuário.
/// </summary>
public sealed class FinanceRepositoriesTests : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 10, 26, 12, 30, 15, 123, DateTimeKind.Utc);

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

        await ExecuteAsync("""
            INSERT INTO users (id,name,email,"passwordHash","updatedAt") VALUES
              ('u1','Ana','ana@x.y','h',NOW()), ('u2','Bia','bia@x.y','h',NOW());
            """);
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

    private async Task<List<string>> ColumnAsync(string sql)
    {
        await using var command = _dataSource.CreateCommand(sql);
        await using var reader = await command.ExecuteReaderAsync();
        var values = new List<string>();
        while (await reader.ReadAsync()) values.Add(reader.GetValue(0).ToString()!);
        return values;
    }

    [Fact]
    public async Task Categorias_ordem_do_banco_arquivadas_ILIKE_contagens_e_isolamento()
    {
        await using (var db = NewContext())
        {
            var repository = new EfCategoryRepository(db);
            var index = 0;
            foreach (var (name, kind) in new[] { ("banana", CategoryKind.Expense), ("Abacate", CategoryKind.Expense), ("Zeta", CategoryKind.Income), ("ágape", CategoryKind.Expense), ("Lazer", CategoryKind.Expense) })
            {
                await repository.AddAsync(Category.CreateCustom($"c{index}", "u1", name, kind, null, index), Now, CancellationToken.None);
                index++;
            }

            await repository.AddAsync(Category.CreateCustom("alheia", "u2", "Lazer", CategoryKind.Expense, null, 0), Now, CancellationToken.None);

            var lazer = (await repository.FindByIdAsync("u1", "c4", CancellationToken.None))!;
            lazer.SetArchived(true, Now);
            lazer.Rename("LAZER");
            await repository.UpdateAsync(lazer, Now.AddSeconds(1), CancellationToken.None);
        }

        await using (var db = NewContext())
        {
            var repository = new EfCategoryRepository(db);
            var expected = await ColumnAsync("""SELECT id FROM categories WHERE "userId"='u1' ORDER BY kind ASC, name ASC""");
            Assert.Equal(expected, (await repository.ListAsync("u1", includeArchived: true, CancellationToken.None)).Select(c => c.Id));
            Assert.Equal(expected.Where(id => id != "c4"), (await repository.ListAsync("u1", includeArchived: false, CancellationToken.None)).Select(c => c.Id));

            var archived = (await repository.FindByIdAsync("u1", "c4", CancellationToken.None))!;
            Assert.Equal(("LAZER", (DateTime?)Now), (archived.Name, archived.ArchivedAt));
            Assert.Null(await repository.FindByIdAsync("u2", "c4", CancellationToken.None));

            Assert.Equal("c1", (await repository.FindByNameAsync("u1", "ABACATE", CategoryKind.Expense, CancellationToken.None))?.Id);
            Assert.Equal("c4", (await repository.FindByNameAsync("u1", "lazer", CategoryKind.Expense, CancellationToken.None))?.Id);
            Assert.Null(await repository.FindByNameAsync("u1", "Abacate", CategoryKind.Income, CancellationToken.None));
            // ⚠️ Curingas do ILIKE, como no Prisma.
            Assert.Equal("c0", (await repository.FindByNameAsync("u1", "b%", CategoryKind.Expense, CancellationToken.None))?.Id);
            Assert.Equal("c0", (await repository.FindByNameAsync("u1", "ban_na", CategoryKind.Expense, CancellationToken.None))?.Id);

            Assert.Equal(5, await repository.CountAsync("u1", CancellationToken.None));
            Assert.Equal(1, await repository.CountAsync("u2", CancellationToken.None));
        }

        await ExecuteAsync("""
            INSERT INTO transactions (id,"userId","categoryId",type,"amountCents","occurredOn","updatedAt") VALUES ('t1','u1','c0','EXPENSE',100,'2026-10-01',NOW());
            INSERT INTO bills (id,"userId","categoryId",name,"amountCents","dueDay","startMonth","updatedAt") VALUES ('b1','u1','c0','Luz',100,5,'2026-10-01',NOW());
            INSERT INTO cards (id,"userId",name,"closingDay","dueDay","updatedAt") VALUES ('k1','u1','Visa',1,10,NOW());
            INSERT INTO card_purchases (id,"userId","cardId","categoryId","amountCents","purchasedOn") VALUES ('p1','u1','k1','c0',100,'2026-10-01'),('p2','u1','k1','c0',100,'2026-10-02');
            """);

        await using (var db = NewContext())
        {
            var repository = new EfCategoryRepository(db);
            Assert.Equal(4, await repository.CountUsagesAsync("u1", "c0", CancellationToken.None));
            Assert.Equal(0, await repository.CountUsagesAsync("u2", "c0", CancellationToken.None));

            await repository.DeleteAsync("u2", "c1", CancellationToken.None);
            await repository.DeleteAsync("u1", "c1", CancellationToken.None);
            Assert.Null(await repository.FindByIdAsync("u1", "c1", CancellationToken.None));
        }

        // createdAt na criação e updatedAt na edição, em UTC e com milissegundos (como o Prisma grava).
        Assert.Equal(["2026-10-26 12:30:15.123|2026-10-26 12:30:16.123"],
            await ColumnAsync("""SELECT to_char("createdAt",'YYYY-MM-DD HH24:MI:SS.MS') || '|' || to_char("updatedAt",'YYYY-MM-DD HH24:MI:SS.MS') FROM categories WHERE id='c4'"""));
    }

    [Fact]
    public async Task Entradas_ordem_ativas_primeiro_e_crud()
    {
        await using (var db = NewContext())
        {
            var repository = new EfIncomeRepository(db);
            await repository.AddAsync(Income.Create("i1", "u1", "Aluguel", 900, 20), Now, CancellationToken.None);
            await repository.AddAsync(Income.Create("i2", "u1", "Salário", 5000, 5), Now, CancellationToken.None);
            await repository.AddAsync(Income.Create("i3", "u1", "Freela", 300, 12), Now, CancellationToken.None);
            await repository.AddAsync(Income.Create("i4", "u2", "Bolsa", 100, 1), Now, CancellationToken.None);

            var salary = (await repository.FindByIdAsync("u1", "i2", CancellationToken.None))!;
            salary.Update(default, default, default, Grana.Domain.Common.Patch.Set(false));
            await repository.UpdateAsync(salary, Now, CancellationToken.None);
        }

        await using (var db = NewContext())
        {
            var repository = new EfIncomeRepository(db);
            Assert.Equal(["i3", "i1", "i2"], (await repository.ListAsync("u1", CancellationToken.None)).Select(i => i.Id));
            Assert.Equal(["i3", "i1"], (await repository.ListActiveAsync("u1", CancellationToken.None)).Select(i => i.Id));
            Assert.False((await repository.FindByIdAsync("u1", "i2", CancellationToken.None))!.Active);
            Assert.Null(await repository.FindByIdAsync("u1", "i4", CancellationToken.None));

            await repository.DeleteAsync("u1", "i4", CancellationToken.None);
            await repository.DeleteAsync("u1", "i1", CancellationToken.None);
            Assert.Equal(["i3", "i2"], (await repository.ListAsync("u1", CancellationToken.None)).Select(i => i.Id));
            Assert.Single(await repository.ListAsync("u2", CancellationToken.None));
        }
    }

    [Fact]
    public async Task Ajustes_upsert_cria_e_depois_atualiza_a_mesma_linha()
    {
        await using (var db = NewContext())
        {
            var repository = new EfUserSettingsRepository(db);
            Assert.Null(await repository.FindAsync("u1", CancellationToken.None));

            var settings = UserSettings.Defaults("u1");
            settings.Apply(new SettingsPatch { RoundCents = Grana.Domain.Common.Patch.Set(true), OpeningDate = Grana.Domain.Common.Patch.Set<string?>("2026-10-01") }, Now);
            await repository.SaveAsync(settings, Now, CancellationToken.None);
        }

        await using (var db = NewContext())
        {
            var repository = new EfUserSettingsRepository(db);
            var saved = (await repository.FindAsync("u1", CancellationToken.None))!;
            Assert.Equal((true, (DateOnly?)new DateOnly(2026, 10, 1), true), (saved.RoundCents, saved.OpeningDate, saved.OverspendAlerts));

            saved.Apply(new SettingsPatch { OpeningDate = Grana.Domain.Common.Patch.Set<string?>(null), DailyBudgetCents = Grana.Domain.Common.Patch.Set<int?>(4500) }, Now);
            await repository.SaveAsync(saved, Now, CancellationToken.None);
        }

        await using (var db = NewContext())
        {
            var saved = (await new EfUserSettingsRepository(db).FindAsync("u1", CancellationToken.None))!;
            Assert.Equal(((DateOnly?)null, (int?)4500, true), (saved.OpeningDate, saved.DailyBudgetCents, saved.RoundCents));
        }

        Assert.Equal(["1"], await ColumnAsync("""SELECT count(*) FROM user_settings WHERE "userId"='u1'"""));
    }
}
