using Grana.Api.Validation;
using Grana.Application.Common;
using Grana.Domain.Common;

namespace Grana.Api.Http;

/// <summary>Entrada já lida, validada e (se a rota pede) autenticada de uma rota nativa.</summary>
public sealed record NativeRequest(
    Actor Actor, JsObject Params, JsObject Body, JsObject Query, IServiceProvider Services, CancellationToken CancellationToken)
{
    /// <summary>A requisição crua: cookies, IP do cliente, navegador, cabeçalhos de resposta.</summary>
    public HttpContext Http { get; init; } = null!;
}

/// <summary>Schemas da rota, como em <c>route.get(path, { schema: { params, body, querystring } })</c>.</summary>
public sealed record RouteSchemas(ZodSchema? Params = null, ZodSchema? Body = null, ZodSchema? Query = null);

/// <summary>Quem pode chamar a rota (o <c>preHandler</c> do Fastify).</summary>
public enum RouteAccess
{
    /// <summary>Sem token (login, cadastro, refresh, logout).</summary>
    Public,

    /// <summary><c>app.authenticate</c>.</summary>
    Authenticated,

    /// <summary><c>app.requireAdmin</c>: token válido E perfil ADMIN no TOKEN (⚠️ RN-044).</summary>
    Admin,
}

/// <summary>
/// Rotas atendidas pelo .NET com o ciclo de vida de uma rota do Fastify:
/// (rate limit e CORS no <see cref="NativeEdgeMiddleware"/>) → leitura do corpo →
/// validação de params, corpo e query, nessa ordem, parando na primeira parte que
/// falhar → autenticação (o <c>preHandler</c>) → handler. A validação vem ANTES da
/// autenticação: sem token e com corpo inválido, a resposta é 400 (RF-01.6).
/// </summary>
public static class NativeRoute
{
    private static readonly JsObject Empty = new([]);
    private static readonly Actor Anonymous = new(string.Empty, string.Empty, string.Empty);

    public static RouteHandlerBuilder MapAuthenticated(
        this IEndpointRouteBuilder routes, string method, string pattern, RouteSchemas schemas, Func<NativeRequest, Task<IResult>> handler) =>
        routes.MapNative(method, pattern, RouteAccess.Authenticated, schemas, handler);

    public static RouteHandlerBuilder MapNative(
        this IEndpointRouteBuilder routes,
        string method,
        string pattern,
        RouteAccess access,
        RouteSchemas schemas,
        Func<NativeRequest, Task<IResult>> handler)
    {
        ArgumentNullException.ThrowIfNull(routes);
        ArgumentNullException.ThrowIfNull(schemas);
        ArgumentNullException.ThrowIfNull(handler);

        // GET também atende HEAD, como o exposeHeadRoutes do Fastify.
        string[] methods = method == HttpMethods.Get ? [HttpMethods.Get, HttpMethods.Head] : [method];
        return routes.MapMethods(pattern, methods, async (HttpContext context, AccessToken tokens) =>
            {
                var cancellationToken = context.RequestAborted;
                var body = await RequestBody.ReadAsync(context.Request, cancellationToken).ConfigureAwait(false);
                var routeParams = Validate(schemas.Params, ParamsOf(context));
                var validBody = Validate(schemas.Body, body);
                var query = Validate(schemas.Query, QueryOf(context));
                var actor = access == RouteAccess.Public ? Anonymous : tokens.Authenticate(context.Request.Headers.Authorization.ToString());
                if (access == RouteAccess.Admin && actor.Role != "ADMIN") throw new ForbiddenError("Esta área é exclusiva de administradores.");
                return await handler(new NativeRequest(actor, routeParams, validBody, query, context.RequestServices, cancellationToken) { Http = context })
                    .ConfigureAwait(false);
            })
            .WithMetadata(new NativeEndpointMetadata());
    }

    private static JsObject Validate(ZodSchema? schema, JsValue input)
    {
        if (schema is null) return Empty;
        var result = schema.Validate(input);
        if (!result.Success) throw HttpError.Validation([.. result.Issues.Select(issue => (issue.Path, issue.Message))]);
        return (JsObject)result.Data;
    }

    private static JsObject ParamsOf(HttpContext context) =>
        new([.. context.Request.RouteValues.Select(pair => new KeyValuePair<string, JsValue>(pair.Key, new JsString(pair.Value?.ToString() ?? string.Empty)))]);

    /// <summary>Querystring como o Fastify a entrega: chave repetida vira lista.</summary>
    private static JsObject QueryOf(HttpContext context) =>
        new([.. context.Request.Query.Select(pair => new KeyValuePair<string, JsValue>(
            pair.Key,
            pair.Value.Count == 1
                ? new JsString(pair.Value[0] ?? string.Empty)
                : new JsArray([.. pair.Value.Select(value => (JsValue)new JsString(value ?? string.Empty))])))]);
}
