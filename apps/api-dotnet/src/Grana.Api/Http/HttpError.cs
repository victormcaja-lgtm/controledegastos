namespace Grana.Api.Http;

/// <summary>
/// Erro da borda com status, <c>error</c> e <c>code</c> próprios — os do Fastify e
/// dos plugins (corpo inválido, validação do schema, rate limit). Vira o envelope
/// padrão no <see cref="NativeEdgeMiddleware"/>.
/// </summary>
public sealed class HttpError : Exception
{
    public HttpError(int statusCode, string error, string code, string message, IReadOnlyList<(string Path, string Message)>? details = null)
        : base(message)
    {
        StatusCode = statusCode;
        Error = error;
        Code = code;
        Details = details;
    }

    public HttpError()
        : this(500, "Error", "INTERNAL_ERROR", string.Empty)
    {
    }

    public HttpError(string message)
        : this(500, "Error", "INTERNAL_ERROR", message)
    {
    }

    public HttpError(string message, Exception innerException)
        : base(message, innerException)
    {
        StatusCode = 500;
        Error = "Error";
        Code = "INTERNAL_ERROR";
    }

    public int StatusCode { get; }

    public string Error { get; }

    public string Code { get; }

    public IReadOnlyList<(string Path, string Message)>? Details { get; }

    /// <summary>Erros do próprio Fastify (<c>FST_ERR_*</c>): <c>error</c> = "FastifyError" (RN-011).</summary>
    public static HttpError Fastify(int statusCode, string code, string message) => new(statusCode, "FastifyError", code, message);

    /// <summary>Schema da rota recusou a entrada → 400 com <c>details</c> (RN-008).</summary>
    public static HttpError Validation(IReadOnlyList<(string Path, string Message)> details) =>
        new(400, "Bad Request", "VALIDATION_ERROR", "Alguns campos precisam de atenção.", details);
}
