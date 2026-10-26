using Grana.Application.Common;
using Grana.Application.Finance;
using Grana.Application.Health;
using Grana.Infrastructure.Database;
using Grana.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;

namespace Grana.Infrastructure;

public static class DependencyInjection
{
    /// <summary>Banco (com os enums do Postgres), repositórios, relógio e gerador de ids.</summary>
    public static IServiceCollection AddGranaInfrastructure(this IServiceCollection services, string databaseUrl)
    {
        var dataSource = GranaDbContext.CreateDataSource(DatabaseUrl.ToConnectionString(databaseUrl));
        services.AddSingleton(dataSource);
        services.AddDbContext<GranaDbContext>(options => GranaDbContext.Configure(options, dataSource));
        services.AddSingleton<IDatabaseHealth, PostgresHealth>();
        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<ICategoryRepository, EfCategoryRepository>();
        services.AddScoped<IIncomeRepository, EfIncomeRepository>();
        services.AddScoped<IUserSettingsRepository, EfUserSettingsRepository>();
        services.AddScoped<ITransactionRepository, EfTransactionRepository>();
        services.AddScoped<IDebtRepository, EfDebtRepository>();
        services.AddScoped<IGoalRepository, EfGoalRepository>();
        services.AddScoped<IBillRepository, EfBillRepository>();
        return services;
    }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow
    {
        get
        {
            var now = DateTime.UtcNow;
            return new DateTime(now.Ticks - (now.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Utc);
        }
    }
}

public sealed class GuidIdGenerator : IIdGenerator
{
    public string NewId() => Guid.NewGuid().ToString("D");
}
