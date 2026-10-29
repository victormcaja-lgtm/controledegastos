using System.Text.Json;
using NpgsqlTypes;

namespace Grana.Infrastructure.Persistence;

// Modelos de PERSISTÊNCIA — o formato das tabelas que o Prisma criou
// (apps/api/prisma/migrations). Não são entidades de domínio: os repositórios
// traduzem de um para o outro. Schema congelado durante a migração (R-10).
// Datas-hora: UTC. Datas puras: DateOnly. Ids: UUID v4 em texto, gerados pela aplicação.

#pragma warning disable CA1515 // tipos públicos usados pelos repositórios e testes
#pragma warning disable CA1720 // nomes dos rótulos são os do enum do Postgres

public enum UserRoleDb
{
    [PgName("ADMIN")] ADMIN,
    [PgName("USER")] USER,
}

public enum UserStatusDb
{
    [PgName("ACTIVE")] ACTIVE,
    [PgName("SUSPENDED")] SUSPENDED,
    [PgName("PENDING")] PENDING,
}

/// <summary>Enum <c>CategoryKind</c> do Postgres.</summary>
public enum CategoryKindDb
{
    [PgName("EXPENSE")] EXPENSE,
    [PgName("INCOME")] INCOME,
}

/// <summary>Enum <c>EntryType</c> do Postgres — mesmos rótulos, outro tipo no banco.</summary>
public enum EntryTypeDb
{
    [PgName("EXPENSE")] EXPENSE,
    [PgName("INCOME")] INCOME,
}

public enum BillPaymentStatusDb
{
    [PgName("PAID")] PAID,
    [PgName("WAIVED")] WAIVED,
}

#pragma warning restore CA1720

public sealed class UserRow
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string Email { get; set; }
    public required string PasswordHash { get; set; }
    public UserRoleDb Role { get; set; }
    public UserStatusDb Status { get; set; }
    public bool MustChangePassword { get; set; }
    public int FailedLoginAttempts { get; set; }
    public DateTime? LockedUntil { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class RefreshTokenRow
{
    public required string Id { get; set; }
    public required string TokenHash { get; set; }
    public required string UserId { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? ReplacedBy { get; set; }
    public string? UserAgent { get; set; }
    public string? Ip { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class AuditLogRow
{
    public required string Id { get; set; }
    public required string Action { get; set; }
    public required string TargetType { get; set; }
    public string? TargetId { get; set; }
    public string? ActorId { get; set; }
    public string? ActorEmail { get; set; }
    public string? Ip { get; set; }
    public JsonDocument? Metadata { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class UserSettingsRow
{
    public required string UserId { get; set; }
    public bool OverspendAlerts { get; set; } = true;
    public bool WeeklySummary { get; set; } = true;
    public bool RoundCents { get; set; }
    public bool AutoDarkMode { get; set; }
    public bool ShowDailyAllowance { get; set; } = true;
    public int OpeningBalanceCents { get; set; }
    public DateOnly? OpeningDate { get; set; }
    public int? DailyBudgetCents { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class CategoryRow
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string Name { get; set; }
    public required string Color { get; set; }
    public CategoryKindDb Kind { get; set; }
    public bool IsSystem { get; set; }
    public DateTime? ArchivedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class TransactionRow
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string CategoryId { get; set; }
    public CategoryRow? Category { get; set; }
    public EntryTypeDb Type { get; set; }
    public int AmountCents { get; set; }
    public DateOnly OccurredOn { get; set; }
    public string? Note { get; set; }
    public string? BillId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class BillRow
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string CategoryId { get; set; }
    public CategoryRow? Category { get; set; }
    public required string Name { get; set; }
    public int AmountCents { get; set; }
    public int DueDay { get; set; }
    public bool Active { get; set; } = true;
    public DateOnly StartMonth { get; set; }
    public int? TotalInstallments { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class BillPaymentRow
{
    public required string Id { get; set; }
    public required string BillId { get; set; }
    public required string UserId { get; set; }
    public DateOnly ReferenceMonth { get; set; }
    public int AmountCents { get; set; }
    public DateTime PaidAt { get; set; }
    public BillPaymentStatusDb Status { get; set; }
}

public sealed class IncomeRow
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string Name { get; set; }
    public int AmountCents { get; set; }
    public int ReceiptDay { get; set; }
    public bool Active { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class DebtRow
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string Name { get; set; }
    public int InstallmentCents { get; set; }
    public int PaidInstallments { get; set; }
    public int TotalInstallments { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class GoalRow
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string Name { get; set; }
    public int TargetCents { get; set; }
    public int SavedCents { get; set; }
    public bool Featured { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<GoalDepositRow> Deposits { get; } = [];
}

public sealed class GoalDepositRow
{
    public required string Id { get; set; }
    public required string GoalId { get; set; }
    public int AmountCents { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class CardRow
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string Name { get; set; }
    public int ClosingDay { get; set; }
    public int DueDay { get; set; }
    public int? LimitCents { get; set; }
    public bool Active { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class CardPurchaseRow
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string CardId { get; set; }
    public required string CategoryId { get; set; }
    public CategoryRow? Category { get; set; }
    public int AmountCents { get; set; }
    public int Installments { get; set; } = 1;
    public DateOnly PurchasedOn { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
}
