using System.Text.Json;
using Grana.Api.Json;
using Grana.Domain.Common;

namespace Grana.Api.Http;

/// <summary>
/// Envelope único de erro, igual ao da API Node (error-handler.ts):
/// <c>{statusCode, error, code, message, details?, requestId}</c>.
/// </summary>
public static class ErrorEnvelope
{
    private static readonly JsonSerializerOptions Options = GranaJson.CreateOptions();

    private static readonly Dictionary<string, int> StatusByCode = new()
    {
        ["VALIDATION_ERROR"] = 422,
        ["NOT_FOUND"] = 404,
        ["CONFLICT"] = 409,
        ["BUSINESS_RULE"] = 422,
        ["UNAUTHORIZED"] = 401,
        ["FORBIDDEN"] = 403,
        ["TOO_MANY_ATTEMPTS"] = 429,
    };

    public const string GenericMessage = "Algo deu errado do nosso lado. Tente novamente em instantes.";

    public static Task WriteAsync(
        HttpContext context,
        int statusCode,
        string error,
        string code,
        string message,
        IReadOnlyList<(string Path, string Message)>? details = null)
    {
        ArgumentNullException.ThrowIfNull(context);
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = Options.Encoder }))
        {
            writer.WriteStartObject();
            writer.WriteNumber("statusCode", statusCode);
            writer.WriteString("error", error);
            writer.WriteString("code", code);
            writer.WriteString("message", message);
            if (details is not null)
            {
                writer.WriteStartArray("details");
                foreach (var (path, detailMessage) in details)
                {
                    writer.WriteStartObject();
                    writer.WriteString("path", path);
                    writer.WriteString("message", detailMessage);
                    writer.WriteEndObject();
                }

                writer.WriteEndArray();
            }

            writer.WriteString("requestId", RequestId.Of(context));
            writer.WriteEndObject();
        }

        return context.Response.Body.WriteAsync(stream.ToArray(), context.RequestAborted).AsTask();
    }

    /// <summary>Formato padrão do Fastify, sem <c>code</c> nem <c>requestId</c> (erro fora do tratador de app.ts).</summary>
    public static Task WriteBareAsync(HttpContext context, int statusCode, string error, string message)
    {
        ArgumentNullException.ThrowIfNull(context);
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = Options.Encoder }))
        {
            writer.WriteStartObject();
            writer.WriteNumber("statusCode", statusCode);
            writer.WriteString("error", error);
            writer.WriteString("message", message);
            writer.WriteEndObject();
        }

        return context.Response.Body.WriteAsync(stream.ToArray(), context.RequestAborted).AsTask();
    }

    /// <summary>Erro de domínio → status pelo código; <c>error</c> = nome da classe.</summary>
    public static Task WriteDomainErrorAsync(HttpContext context, DomainError error)
    {
        ArgumentNullException.ThrowIfNull(error);
        var status = StatusByCode.GetValueOrDefault(error.Code, 400);
        return WriteAsync(context, status, error.GetType().Name, error.Code, error.Message, error.Details);
    }

    /// <summary>Erro inesperado → 500; em produção, sem vazar a mensagem interna.</summary>
    public static Task WriteUnexpectedAsync(HttpContext context, Exception exception, bool isProduction)
    {
        ArgumentNullException.ThrowIfNull(exception);
        return WriteAsync(context, 500, "Internal Server Error", "INTERNAL_ERROR", isProduction ? GenericMessage : exception.Message);
    }
}

/// <summary><c>requestId</c>: o <c>X-Request-Id</c> recebido ou um UUID novo (RN-014).</summary>
public static class RequestId
{
    private const string Key = "grana.requestId";

    public static string Of(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (context.Items.TryGetValue(Key, out var existing) && existing is string id) return id;
        var header = context.Request.Headers["x-request-id"].ToString();
        id = header.Length > 0 ? header : Guid.NewGuid().ToString("D");
        context.Items[Key] = id;
        return id;
    }
}
