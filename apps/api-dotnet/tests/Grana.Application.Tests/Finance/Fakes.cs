using Grana.Application.Common;
using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Tests.Finance;

internal sealed class FixedClock(DateTime now) : IClock
{
    public DateTime UtcNow { get; set; } = now;
}

internal sealed class SequentialIds : IIdGenerator
{
    private int _next;

    public string NewId() => $"id-{++_next}";
}

/// <summary>Repositório em memória. O nome repetido compara sem diferenciar maiúsculas (o ILIKE sem curinga).</summary>
internal sealed class InMemoryCategories : ICategoryRepository
{
    public List<Category> Items { get; } = [];

    public Dictionary<string, int> Usages { get; } = [];

    public List<(string Id, DateTime Now)> Updates { get; } = [];

    public Task<IReadOnlyList<Category>> ListAsync(string userId, bool includeArchived, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Category>>(
            [.. Items.Where(c => c.UserId == userId && (includeArchived || !c.IsArchived))]);

    public Task<Category?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken) =>
        Task.FromResult(Items.FirstOrDefault(c => c.UserId == userId && c.Id == id));

    public Task<Category?> FindByNameAsync(string userId, string name, CategoryKind kind, CancellationToken cancellationToken) =>
        Task.FromResult(Items.FirstOrDefault(c =>
            c.UserId == userId && c.Kind == kind && string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase)));

    public Task<int> CountAsync(string userId, CancellationToken cancellationToken) =>
        Task.FromResult(Items.Count(c => c.UserId == userId));

    public Task<int> CountUsagesAsync(string userId, string id, CancellationToken cancellationToken) =>
        Task.FromResult(Usages.GetValueOrDefault(id));

    public Task AddAsync(Category category, DateTime nowUtc, CancellationToken cancellationToken)
    {
        Items.Add(category);
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Category category, DateTime nowUtc, CancellationToken cancellationToken)
    {
        Updates.Add((category.Id, nowUtc));
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken)
    {
        Items.RemoveAll(c => c.UserId == userId && c.Id == id);
        return Task.CompletedTask;
    }
}

internal sealed class InMemoryIncomes : IIncomeRepository
{
    public List<Income> Items { get; } = [];

    public int UpdateCount { get; private set; }

    public Task<IReadOnlyList<Income>> ListAsync(string userId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Income>>([.. Items.Where(i => i.UserId == userId)]);

    public Task<IReadOnlyList<Income>> ListActiveAsync(string userId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Income>>([.. Items.Where(i => i.UserId == userId && i.Active).OrderBy(i => i.ReceiptDay)]);

    public Task<Income?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken) =>
        Task.FromResult(Items.FirstOrDefault(i => i.UserId == userId && i.Id == id));

    public Task AddAsync(Income income, DateTime nowUtc, CancellationToken cancellationToken)
    {
        Items.Add(income);
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Income income, DateTime nowUtc, CancellationToken cancellationToken)
    {
        UpdateCount++;
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken)
    {
        Items.RemoveAll(i => i.UserId == userId && i.Id == id);
        return Task.CompletedTask;
    }
}

internal sealed class InMemorySettings : IUserSettingsRepository
{
    public Dictionary<string, UserSettings> Rows { get; } = [];

    public Task<UserSettings?> FindAsync(string userId, CancellationToken cancellationToken) =>
        Task.FromResult(Rows.GetValueOrDefault(userId));

    public Task SaveAsync(UserSettings settings, DateTime nowUtc, CancellationToken cancellationToken)
    {
        Rows[settings.UserId] = settings;
        return Task.CompletedTask;
    }
}

internal sealed class InMemoryBills : IBillRepository
{
    public List<Bill> Items { get; } = [];

    public List<(string UserId, BillPayment Payment)> Payments { get; } = [];

    public Task<IReadOnlyList<Bill>> ListAllAsync(string userId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Bill>>([.. Items.Where(b => b.UserId == userId).OrderByDescending(b => b.Active).ThenBy(b => b.DueDay)]);

    public Task<IReadOnlyList<Bill>> ListActiveAsync(string userId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Bill>>([.. Items.Where(b => b.UserId == userId && b.Active).OrderBy(b => b.DueDay)]);

    public Task<Bill?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken) =>
        Task.FromResult(Items.FirstOrDefault(b => b.UserId == userId && b.Id == id));

    public Task AddAsync(Bill bill, DateTime nowUtc, CancellationToken cancellationToken)
    {
        Items.Add(bill);
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Bill bill, DateTime nowUtc, CancellationToken cancellationToken) => Task.CompletedTask;

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken)
    {
        Items.RemoveAll(b => b.UserId == userId && b.Id == id);
        Payments.RemoveAll(p => p.Payment.BillId == id);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<BillPayment>> PaymentsForMonthAsync(string userId, MonthRef month, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<BillPayment>>([.. Payments.Where(p => p.UserId == userId && p.Payment.Month == month).Select(p => p.Payment)]);

    public Task<IReadOnlyList<BillPayment>> PaymentsSinceAsync(string userId, MonthRef month, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<BillPayment>>([.. Payments.Where(p => p.UserId == userId && p.Payment.Month >= month).Select(p => p.Payment)]);

    public Task MarkPaidAsync(
        string userId, string billId, MonthRef month, int amountCents, BillPaymentStatus status, string newPaymentId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        Payments.RemoveAll(p => p.Payment.BillId == billId && p.Payment.Month == month);
        Payments.Add((userId, new BillPayment(billId, month, status, amountCents, nowUtc)));
        return Task.CompletedTask;
    }

    public Task MarkUnpaidAsync(string userId, string billId, MonthRef month, CancellationToken cancellationToken)
    {
        Payments.RemoveAll(p => p.UserId == userId && p.Payment.BillId == billId && p.Payment.Month == month);
        return Task.CompletedTask;
    }
}
