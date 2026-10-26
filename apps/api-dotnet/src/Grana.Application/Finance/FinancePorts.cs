using Grana.Domain.Finance;

namespace Grana.Application.Finance;

/// <summary>
/// Repositórios do módulo financeiro. Regra de ouro herdada do Node: TODA consulta
/// recebe o <c>userId</c> — o isolamento entre usuários está na assinatura (RN-021).
/// </summary>
public interface ICategoryRepository
{
    /// <summary>Ordem do banco: <c>kind asc, name asc</c> pela collation (RN-070, R-06).</summary>
    Task<IReadOnlyList<Category>> ListAsync(string userId, bool includeArchived, CancellationToken cancellationToken);

    Task<Category?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken);

    /// <summary>
    /// Categoria do mesmo tipo cujo nome casa com <paramref name="name"/> sem diferenciar
    /// maiúsculas — inclusive arquivadas (RN-072). ⚠️ Como no Prisma, é um <c>ILIKE</c>
    /// SEM escape: <c>_</c> e <c>%</c> no nome novo funcionam como curinga.
    /// </summary>
    Task<Category?> FindByNameAsync(string userId, string name, CategoryKind kind, CancellationToken cancellationToken);

    /// <summary>Total do usuário, com as arquivadas (posição da cor na paleta).</summary>
    Task<int> CountAsync(string userId, CancellationToken cancellationToken);

    /// <summary>Lançamentos + contas fixas + compras no cartão que usam a categoria.</summary>
    Task<int> CountUsagesAsync(string userId, string id, CancellationToken cancellationToken);

    Task AddAsync(Category category, DateTime nowUtc, CancellationToken cancellationToken);

    Task UpdateAsync(Category category, DateTime nowUtc, CancellationToken cancellationToken);

    Task DeleteAsync(string userId, string id, CancellationToken cancellationToken);
}

public interface IIncomeRepository
{
    /// <summary>Ordem do banco: <c>active desc, receiptDay asc</c> (RN-105).</summary>
    Task<IReadOnlyList<Income>> ListAsync(string userId, CancellationToken cancellationToken);

    Task<Income?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken);

    Task AddAsync(Income income, DateTime nowUtc, CancellationToken cancellationToken);

    Task UpdateAsync(Income income, DateTime nowUtc, CancellationToken cancellationToken);

    Task DeleteAsync(string userId, string id, CancellationToken cancellationToken);
}

public interface IUserSettingsRepository
{
    /// <summary><c>null</c> quando o usuário ainda não tem linha gravada.</summary>
    Task<UserSettings?> FindAsync(string userId, CancellationToken cancellationToken);

    /// <summary>Upsert: cria a linha se não existir (RN-150).</summary>
    Task SaveAsync(UserSettings settings, DateTime nowUtc, CancellationToken cancellationToken);
}
