using Microsoft.AspNetCore.Http.Features;

namespace Grana.Api.Http;

/// <summary>Marca o endpoint de último recurso, que só existe sem o Node atrás (T-091).</summary>
public sealed class NativeFallbackMetadata;

/// <summary>
/// O que o Fastify responde fora das rotas quando não há mais Node para repassar (T-091):
/// o preflight do @fastify/cors (<c>OPTIONS *</c>) e o 404 de <c>setNotFoundHandler</c>
/// (RN-012), os dois fora do rate limit.
/// </summary>
public static class NativeFallback
{
    public static void MapNativeFallback(this IEndpointRouteBuilder routes) =>
        routes.MapFallback("{**path}", (HttpContext context) =>
            {
                var request = context.Request;
                if (HttpMethods.IsOptions(request.Method)) return Preflight(context);

                // O Fastify mostra a url crua, com a query como veio.
                var url = context.Features.Get<IHttpRequestFeature>()?.RawTarget is { Length: > 0 } raw ? raw : $"{request.PathBase}{request.Path}{request.QueryString}";
                throw new HttpError(404, "Not Found", "ROUTE_NOT_FOUND", $"Rota {request.Method} {url} não existe.");
            })
            .WithMetadata(new NativeEndpointMetadata(), new NoRateLimitMetadata(), new NativeFallbackMetadata());

    private static IResult Preflight(HttpContext context)
    {
        var request = context.Request;
        // A origem já foi conferida pela borda; sem ela ou sem o método pedido, o plugin recusa.
        if (request.Headers.Origin.Count == 0 || request.Headers.AccessControlRequestMethod.Count == 0)
        {
            return Results.Text("Invalid Preflight Request", "text/plain", statusCode: 400);
        }

        var headers = context.Response.Headers;
        headers.Vary = "Origin, Access-Control-Request-Headers";
        headers.AccessControlAllowMethods = "GET, POST, PATCH, PUT, DELETE, OPTIONS";
        if (request.Headers.AccessControlRequestHeaders.ToString() is { Length: > 0 } requested) headers.AccessControlAllowHeaders = requested;
        headers.AccessControlMaxAge = "86400";
        return Results.StatusCode(204);
    }
}
