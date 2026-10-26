using Grana.Application.Common;
using Grana.Application.Finance;
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
