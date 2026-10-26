using System.Text;
using System.Text.Json;
using Grana.Api.Validation;

namespace Grana.Api.Http;

/// <summary>
/// Leitura do corpo com as regras dos content-type parsers do Fastify (R-12):
/// <list type="bullet">
/// <item>sem <c>Content-Type</c> e sem corpo → <c>null</c>; sem <c>Content-Type</c> COM corpo → 415;</item>
/// <item><c>application/json</c> (com ou sem charset, sem diferenciar maiúsculas) → JSON; vazio → 400
/// <c>FST_ERR_CTP_EMPTY_JSON_BODY</c>; inválido, ou com <c>__proto__</c>/<c>constructor.prototype</c>
/// (secure-json-parse) → 400 <c>FST_ERR_CTP_INVALID_JSON_BODY</c>;</item>
/// <item><c>text/plain</c> → o texto; qualquer outro tipo → 415;</item>
/// <item>mais de 1 MB → 413 <c>FST_ERR_CTP_BODY_TOO_LARGE</c>.</item>
/// </list>
/// GET e HEAD não têm corpo.
/// </summary>
public static class RequestBody
{
    public const int Limit = 1_048_576;

    private static readonly JsonDocumentOptions JsonOptions = new() { MaxDepth = 1_000 };

    public static async Task<JsValue> ReadAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method)) return JsUndefined.Instance;

        var contentType = request.ContentType;
        var hasBody = request.Headers.TransferEncoding.Count > 0 || request.ContentLength is > 0;
        if (string.IsNullOrEmpty(contentType))
        {
            if (!hasBody) return JsNull.Instance;
            throw UnsupportedMediaType();
        }

        var essence = contentType.Split(';')[0].Trim().ToLowerInvariant();
        if (essence is not ("application/json" or "text/plain")) throw UnsupportedMediaType();

        var bytes = await ReadBytesAsync(request, cancellationToken).ConfigureAwait(false);
        if (essence == "text/plain") return new JsString(Encoding.UTF8.GetString(bytes));

        if (bytes.Length == 0)
        {
            throw HttpError.Fastify(400, "FST_ERR_CTP_EMPTY_JSON_BODY", "Body cannot be empty when content-type is set to 'application/json'");
        }

        try
        {
            using var document = JsonDocument.Parse(bytes, JsonOptions);
            if (HasForbiddenPrototype(document.RootElement)) throw InvalidJson();
            return JsValue.FromJson(document.RootElement);
        }
        catch (JsonException)
        {
            throw InvalidJson();
        }
    }

    private static async Task<byte[]> ReadBytesAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if (request.ContentLength > Limit) throw TooLarge();
        try
        {
            using var buffer = new MemoryStream();
            var chunk = new byte[16_384];
            int read;
            while ((read = await request.Body.ReadAsync(chunk, cancellationToken).ConfigureAwait(false)) > 0)
            {
                if (buffer.Length + read > Limit) throw TooLarge();
                buffer.Write(chunk, 0, read);
            }

            return buffer.ToArray();
        }
        catch (BadHttpRequestException exception) when (exception.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            throw TooLarge();
        }
    }

    /// <summary>
    /// secure-json-parse com <c>protoAction</c> e <c>constructorAction</c> = "error": recusa
    /// qualquer chave <c>__proto__</c> e qualquer <c>constructor</c> que seja objeto com <c>prototype</c>.
    /// </summary>
    private static bool HasForbiddenPrototype(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    if (property.Name == "__proto__") return true;
                    if (property.Name == "constructor" &&
                        property.Value.ValueKind == JsonValueKind.Object &&
                        property.Value.TryGetProperty("prototype", out _))
                    {
                        return true;
                    }

                    if (HasForbiddenPrototype(property.Value)) return true;
                }

                return false;
            case JsonValueKind.Array:
                return element.EnumerateArray().Any(HasForbiddenPrototype);
            default:
                return false;
        }
    }

    private static HttpError InvalidJson() =>
        HttpError.Fastify(400, "FST_ERR_CTP_INVALID_JSON_BODY", "Body is not valid JSON but content-type is set to 'application/json'");

    private static HttpError UnsupportedMediaType() =>
        HttpError.Fastify(415, "FST_ERR_CTP_INVALID_MEDIA_TYPE", "Unsupported Media Type");

    private static HttpError TooLarge() =>
        HttpError.Fastify(413, "FST_ERR_CTP_BODY_TOO_LARGE", "Request body is too large");
}
