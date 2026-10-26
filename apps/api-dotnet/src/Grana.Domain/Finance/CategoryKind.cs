namespace Grana.Domain.Finance;

/// <summary>
/// Tipo de categoria. A ORDEM importa: a listagem ordena por <c>kind asc</c> na
/// ordem do enum do Postgres, despesas antes de entradas (RN-070).
/// </summary>
public enum CategoryKind
{
    Expense = 0,
    Income = 1,
}
