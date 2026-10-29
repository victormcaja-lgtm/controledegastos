using Grana.Application.Common;
using Grana.Application.Finance;
using Grana.Application.Health;
using Grana.Application.Identity;
using Grana.Infrastructure.Database;
using Grana.Infrastructure.Identity;
using Grana.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;

namespace Grana.Infrastructure;

public static class DependencyInjection
{
    /// <summary>Banco (com os enums do Postgres), repositórios, relógio e gerador de ids.</summary>
    public static IServiceCollection AddGranaInfrastructure(this IServiceCollection services, string databaseUrl, TokenOptions? tokens = null)
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
        services.AddScoped<ICardRepository, EfCardRepository>();
        services.AddScoped<IUserRepository, EfUserRepository>();
        services.AddScoped<IRefreshTokenRepository, EfRefreshTokenRepository>();
        services.AddSingleton<IPasswordHasher, Argon2PasswordHasher>();
        services.AddSingleton<IAuditLogger, AuditLogger>();
        services.AddSingleton<IUserWorkspaceProvisioner, WorkspaceProvisioner>();
        if (tokens is not null)
        {
            services.AddSingleton<ITokenService>(provider => new JwtTokenService(
                tokens.Secret, tokens.AccessTokenTtl, tokens.RefreshTokenTtlDays, provider.GetService<TimeProvider>() ?? TimeProvider.System));
        }

        return services;
    }
}

/// <summary>Segredo e vidas dos tokens — as mesmas variáveis do Node (<c>JWT_ACCESS_SECRET</c>, <c>ACCESS_TOKEN_TTL</c>, <c>REFRESH_TOKEN_TTL_DAYS</c>).</summary>
public sealed record TokenOptions(string Secret, string AccessTokenTtl, int RefreshTokenTtlDays);

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
