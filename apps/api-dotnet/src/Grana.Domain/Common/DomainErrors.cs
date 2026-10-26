namespace Grana.Domain.Common;

/// <summary>
/// Erros de domínio — o domínio fala em "não encontrado", "regra violada"…; a
/// camada HTTP traduz para status. O NOME da classe vai para o campo <c>error</c>
/// do envelope, por isso os nomes são os mesmos da API Node (shared/domain/errors.ts).
/// </summary>
public abstract class DomainError : Exception
{
    protected DomainError(string message, IReadOnlyList<(string Path, string Message)>? details = null)
        : base(message)
    {
        Details = details;
    }

    protected DomainError()
    {
    }

    protected DomainError(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    /// <summary>VALIDATION_ERROR, NOT_FOUND, CONFLICT, BUSINESS_RULE, UNAUTHORIZED, FORBIDDEN, TOO_MANY_ATTEMPTS.</summary>
    public abstract string Code { get; }

    public IReadOnlyList<(string Path, string Message)>? Details { get; }
}

public sealed class ValidationError(string message, IReadOnlyList<(string Path, string Message)>? details = null)
    : DomainError(message, details)
{
    public override string Code => "VALIDATION_ERROR";
}

/// <summary>Mensagem sempre no masculino: "{Recurso} não encontrado." (RN-013 ⚠️).</summary>
public sealed class NotFoundError(string resource) : DomainError($"{resource} não encontrado.")
{
    public override string Code => "NOT_FOUND";
}

public sealed class ConflictError(string message) : DomainError(message)
{
    public override string Code => "CONFLICT";
}

public sealed class BusinessRuleError(string message) : DomainError(message)
{
    public override string Code => "BUSINESS_RULE";
}

public sealed class UnauthorizedError(string message = "Credenciais inválidas.") : DomainError(message)
{
    public override string Code => "UNAUTHORIZED";
}

public sealed class ForbiddenError(string message = "Você não tem permissão para esta ação.") : DomainError(message)
{
    public override string Code => "FORBIDDEN";
}

public sealed class TooManyAttemptsError(string message = "Muitas tentativas. Tente novamente mais tarde.") : DomainError(message)
{
    public override string Code => "TOO_MANY_ATTEMPTS";
}
