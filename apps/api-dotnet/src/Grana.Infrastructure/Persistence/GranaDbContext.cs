using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Npgsql;

namespace Grana.Infrastructure.Persistence;

/// <summary>
/// Mapeamento EXPLÍCITO do schema criado pelo Prisma (R-11): tabelas em
/// snake_case, colunas em camelCase entre aspas, enums nativos do Postgres,
/// <c>TIMESTAMP(3)</c> sem fuso guardando UTC e <c>DATE</c> como <c>DateOnly</c>.
/// Nenhuma migration do EF é gerada enquanto o Prisma for o dono do schema (R-10).
/// </summary>
public sealed class GranaDbContext(DbContextOptions<GranaDbContext> options) : DbContext(options)
{
    public DbSet<UserRow> Users => Set<UserRow>();
    public DbSet<RefreshTokenRow> RefreshTokens => Set<RefreshTokenRow>();
    public DbSet<AuditLogRow> AuditLogs => Set<AuditLogRow>();
    public DbSet<UserSettingsRow> UserSettings => Set<UserSettingsRow>();
    public DbSet<CategoryRow> Categories => Set<CategoryRow>();
    public DbSet<TransactionRow> Transactions => Set<TransactionRow>();
    public DbSet<BillRow> Bills => Set<BillRow>();
    public DbSet<BillPaymentRow> BillPayments => Set<BillPaymentRow>();
    public DbSet<IncomeRow> Incomes => Set<IncomeRow>();
    public DbSet<DebtRow> Debts => Set<DebtRow>();
    public DbSet<GoalRow> Goals => Set<GoalRow>();
    public DbSet<GoalDepositRow> GoalDeposits => Set<GoalDepositRow>();
    public DbSet<CardRow> Cards => Set<CardRow>();
    public DbSet<CardPurchaseRow> CardPurchases => Set<CardPurchaseRow>();

    /// <summary>Registra os enums nativos do Postgres no data source do Npgsql.</summary>
    public static NpgsqlDataSource CreateDataSource(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(connectionString);
        builder.MapEnum<UserRoleDb>("UserRole");
        builder.MapEnum<UserStatusDb>("UserStatus");
        builder.MapEnum<CategoryKindDb>("CategoryKind");
        builder.MapEnum<EntryTypeDb>("EntryType");
        builder.MapEnum<BillPaymentStatusDb>("BillPaymentStatus");
        return builder.Build();
    }

    public static void Configure(DbContextOptionsBuilder options, NpgsqlDataSource dataSource)
    {
        ArgumentNullException.ThrowIfNull(options);
        options.UseNpgsql(dataSource, npgsql =>
        {
            npgsql.MapEnum<UserRoleDb>("UserRole");
            npgsql.MapEnum<UserStatusDb>("UserStatus");
            npgsql.MapEnum<CategoryKindDb>("CategoryKind");
            npgsql.MapEnum<EntryTypeDb>("EntryType");
            npgsql.MapEnum<BillPaymentStatusDb>("BillPaymentStatus");
        });
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        ArgumentNullException.ThrowIfNull(configurationBuilder);
        // Colunas "timestamp without time zone" guardam UTC (é o que o Prisma grava).
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcTimestampConverter>().HaveColumnType("timestamp(3) without time zone");
        configurationBuilder.Properties<DateTime?>().HaveConversion<UtcTimestampConverter>().HaveColumnType("timestamp(3) without time zone");
        configurationBuilder.Properties<DateOnly>().HaveColumnType("date");
        configurationBuilder.Properties<DateOnly?>().HaveColumnType("date");
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);

        modelBuilder.Entity<UserRow>(user =>
        {
            Table(user, "users");
            user.Property(u => u.Name).HasMaxLength(80);
            user.Property(u => u.Email).HasMaxLength(160);
            user.Property(u => u.Role).HasColumnType("\"UserRole\"");
            user.Property(u => u.Status).HasColumnType("\"UserStatus\"");
        });

        modelBuilder.Entity<RefreshTokenRow>(token =>
        {
            Table(token, "refresh_tokens");
            token.Property(t => t.UserAgent).HasMaxLength(255);
            token.Property(t => t.Ip).HasMaxLength(64);
        });

        modelBuilder.Entity<AuditLogRow>(audit =>
        {
            Table(audit, "audit_logs");
            audit.Property(a => a.Metadata).HasColumnType("jsonb");
        });

        modelBuilder.Entity<UserSettingsRow>(settings =>
        {
            Table(settings, "user_settings", key: s => s.UserId);
        });

        modelBuilder.Entity<CategoryRow>(category =>
        {
            Table(category, "categories");
            category.Property(c => c.Kind).HasColumnType("\"CategoryKind\"");
        });

        modelBuilder.Entity<TransactionRow>(transaction =>
        {
            Table(transaction, "transactions");
            transaction.Property(t => t.Type).HasColumnType("\"EntryType\"");
            transaction.HasOne(t => t.Category).WithMany().HasForeignKey(t => t.CategoryId);
        });

        modelBuilder.Entity<BillRow>(bill =>
        {
            Table(bill, "bills");
            bill.HasOne(b => b.Category).WithMany().HasForeignKey(b => b.CategoryId);
        });

        modelBuilder.Entity<BillPaymentRow>(payment =>
        {
            Table(payment, "bill_payments");
            payment.Property(p => p.Status).HasColumnType("\"BillPaymentStatus\"");
        });

        modelBuilder.Entity<IncomeRow>(income => Table(income, "incomes"));
        modelBuilder.Entity<DebtRow>(debt => Table(debt, "debts"));

        modelBuilder.Entity<GoalRow>(goal =>
        {
            Table(goal, "goals");
            goal.HasMany(g => g.Deposits).WithOne().HasForeignKey(d => d.GoalId);
        });

        modelBuilder.Entity<GoalDepositRow>(deposit => Table(deposit, "goal_deposits"));
        modelBuilder.Entity<CardRow>(card => Table(card, "cards"));

        modelBuilder.Entity<CardPurchaseRow>(purchase =>
        {
            Table(purchase, "card_purchases");
            purchase.HasOne(p => p.Category).WithMany().HasForeignKey(p => p.CategoryId);
            purchase.HasOne<CardRow>().WithMany().HasForeignKey(p => p.CardId);
        });

        modelBuilder.Entity<BillPaymentRow>().HasOne<BillRow>().WithMany().HasForeignKey(p => p.BillId);

        // Chaves estrangeiras para users (as mesmas das migrations): o EF ordena os INSERTs por elas.
        OwnedByUser<RefreshTokenRow>(modelBuilder, r => r.UserId);
        OwnedByUser<UserSettingsRow>(modelBuilder, r => r.UserId);
        OwnedByUser<CategoryRow>(modelBuilder, r => r.UserId);
        OwnedByUser<TransactionRow>(modelBuilder, r => r.UserId);
        OwnedByUser<BillRow>(modelBuilder, r => r.UserId);
        OwnedByUser<BillPaymentRow>(modelBuilder, r => r.UserId);
        OwnedByUser<IncomeRow>(modelBuilder, r => r.UserId);
        OwnedByUser<DebtRow>(modelBuilder, r => r.UserId);
        OwnedByUser<GoalRow>(modelBuilder, r => r.UserId);
        OwnedByUser<CardRow>(modelBuilder, r => r.UserId);
        OwnedByUser<CardPurchaseRow>(modelBuilder, r => r.UserId);
        modelBuilder.Entity<AuditLogRow>().HasOne<UserRow>().WithMany().HasForeignKey(a => a.ActorId).IsRequired(false);
    }

    private static void OwnedByUser<T>(ModelBuilder modelBuilder, System.Linq.Expressions.Expression<Func<T, object?>> userId)
        where T : class =>
        modelBuilder.Entity<T>().HasOne<UserRow>().WithMany().HasForeignKey(userId);

    /// <summary>Tabela, chave e colunas em camelCase (o nome da propriedade com a 1ª letra minúscula).</summary>
    private static void Table<T>(EntityTypeBuilder<T> entity, string table, System.Linq.Expressions.Expression<Func<T, object?>>? key = null)
        where T : class
    {
        entity.ToTable(table);
        if (key is not null) entity.HasKey(key);
        else entity.HasKey("Id");
        foreach (var property in entity.Metadata.GetProperties())
        {
            property.SetColumnName(char.ToLowerInvariant(property.Name[0]) + property.Name[1..]);
        }
    }

    /// <summary>Lê como UTC; grava o instante UTC sem fuso (truncado em ms, como o JS).</summary>
    private sealed class UtcTimestampConverter() : ValueConverter<DateTime, DateTime>(
        value => DateTime.SpecifyKind(TruncateToMilliseconds(value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : value), DateTimeKind.Unspecified),
        value => DateTime.SpecifyKind(value, DateTimeKind.Utc))
    {
        private static DateTime TruncateToMilliseconds(DateTime value) =>
            new(value.Ticks - (value.Ticks % TimeSpan.TicksPerMillisecond), value.Kind);
    }
}
