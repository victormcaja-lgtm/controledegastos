using System.Text.RegularExpressions;
using Grana.Api.Hosting;
using Grana.Domain.Common;

namespace Grana.Api.Http;

/// <summary>Marca um endpoint atendido pelo .NET (não repassado ao Node).</summary>
public sealed class NativeEndpointMetadata;

/// <summary>
/// Borda HTTP das rotas atendidas pelo .NET — reproduz o que o Fastify faz em
/// <c>app.ts</c>: helmet (cabeçalhos de segurança), cors e o tratador de erros.
/// Rotas repassadas ao Node não passam por aqui: o Node já faz tudo isso (plano.md §6.1).
/// </summary>
public sealed partial class NativeEdgeMiddleware(RequestDelegate next, GranaSettings settings, ILogger<NativeEdgeMiddleware> logger)
{
    // helmet 8 com as opções de app.ts (CSP só em produção; sem COEP).
    private const string ContentSecurityPolicy =
        "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';" +
        "img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';" +
        "style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests";

    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (context.GetEndpoint()?.Metadata.GetMetadata<NativeEndpointMetadata>() is null)
        {
            await next(context).ConfigureAwait(false);
            return;
        }

        _ = RequestId.Of(context);
        ApplySecurityHeaders(context.Response.Headers);

        try
        {
            ApplyCors(context);
            await next(context).ConfigureAwait(false);
        }
        catch (DomainError error)
        {
            await ErrorEnvelope.WriteDomainErrorAsync(context, error).ConfigureAwait(false);
        }
        catch (Exception exception) when (!context.Response.HasStarted)
        {
            LogUnhandled(logger, exception, RequestId.Of(context));
            await ErrorEnvelope.WriteUnexpectedAsync(context, exception, settings.IsProduction).ConfigureAwait(false);
        }
    }

    private void ApplySecurityHeaders(IHeaderDictionary headers)
    {
        if (settings.IsProduction) headers.ContentSecurityPolicy = ContentSecurityPolicy;
        headers["Cross-Origin-Opener-Policy"] = "same-origin";
        headers["Cross-Origin-Resource-Policy"] = "same-origin";
        headers["Origin-Agent-Cluster"] = "?1";
        headers["Referrer-Policy"] = "no-referrer";
        headers.StrictTransportSecurity = "max-age=31536000; includeSubDomains";
        headers.XContentTypeOptions = "nosniff";
        headers["X-DNS-Prefetch-Control"] = "off";
        headers["X-Download-Options"] = "noopen";
        headers.XFrameOptions = "SAMEORIGIN";
        headers["X-Permitted-Cross-Domain-Policies"] = "none";
        headers.XXSSProtection = "0";
    }

    /// <summary>
    /// @fastify/cors com a função de origem de app.ts. Origem fora da lista vira
    /// um erro comum → 500 genérico em produção (RN-161 ⚠️).
    /// </summary>
    private void ApplyCors(HttpContext context)
    {
        var headers = context.Response.Headers;
        headers.Vary = "Origin";
        headers.AccessControlAllowCredentials = "true";

        var origin = context.Request.Headers.Origin.ToString();
        if (origin.Length == 0) return;

        var normalized = origin.TrimEnd('/');
        var allowed = settings.CorsOrigins.Contains(normalized) ||
                      (!settings.IsProduction && VercelPreview().IsMatch(normalized));
        if (!allowed) throw new CorsRejectedException(origin);
        headers.AccessControlAllowOrigin = origin;
    }

    [GeneratedRegex(@"^https://[a-z0-9-]+\.vercel\.app\z")]
    private static partial Regex VercelPreview();

    [LoggerMessage(Level = LogLevel.Error, Message = "erro não tratado (requestId {RequestId})")]
    private static partial void LogUnhandled(ILogger logger, Exception exception, string requestId);
}

/// <summary>A mesma mensagem do Node: <c>Origem não autorizada: {origin}</c>.</summary>
public sealed class CorsRejectedException : Exception
{
    public CorsRejectedException(string origin)
        : base($"Origem não autorizada: {origin}")
    {
    }

    public CorsRejectedException()
    {
    }

    public CorsRejectedException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
