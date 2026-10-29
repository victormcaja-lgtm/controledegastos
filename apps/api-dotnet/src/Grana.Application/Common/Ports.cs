namespace Grana.Application.Common;

/// <summary>
/// Relógio da aplicação. O instante vem TRUNCADO ao milissegundo: é a precisão do
/// <c>Date</c> do JavaScript e das colunas <c>TIMESTAMP(3)</c>, então o que a API
/// devolve é exatamente o que fica gravado.
/// </summary>
public interface IClock
{
    DateTime UtcNow { get; }
}

/// <summary>Ids novos: UUID v4 em texto, como o <c>@default(uuid())</c> do Prisma.</summary>
public interface IIdGenerator
{
    string NewId();
}

/// <summary>Quem faz a requisição — o <c>sub</c> do access token (RN-021).</summary>
public sealed record Actor(string UserId, string Email, string Role);
