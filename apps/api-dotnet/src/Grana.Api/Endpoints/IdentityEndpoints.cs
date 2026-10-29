using System.Globalization;
using Grana.Api.Hosting;
using Grana.Api.Http;
using Grana.Api.Validation;
using Grana.Application.Identity;
using Grana.Domain.Common;

namespace Grana.Api.Endpoints;

/// <summary>
/// Rotas do Identity — <c>auth.routes.ts</c> e <c>users.routes.ts</c> (RN-030–062), atendidas
/// pelo .NET com <c>Strangler__Modules__Identity=dotnet</c>.
/// </summary>
public static class IdentityEndpoints
{
    public const string RefreshCookie = "grana_refresh_token";

    private static readonly TimeSpan FifteenMinutes = TimeSpan.FromMinutes(15);

    public static void MapIdentity(this IEndpointRouteBuilder routes, GranaSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        MapAuth(routes, settings);
        MapAdminUsers(routes);
    }

    private static void MapAuth(IEndpointRouteBuilder routes, GranaSettings settings)
    {
        routes.MapNative("POST", "/api/auth/login", RouteAccess.Public, new RouteSchemas(Body: RequestSchemas.LoginRequest), async request =>
        {
            var result = await Use<AuthUseCases>(request)
                .LoginAsync(request.Body.Text("email"), request.Body.Text("password"), ContextOf(request, settings), request.CancellationToken).ConfigureAwait(false);
            SetRefreshCookie(request.Http, settings, result.RefreshToken, result.RefreshExpiresAt);
            return Results.Json(new { accessToken = result.AccessToken, expiresIn = result.ExpiresIn, user = result.User });
        }).WithMetadata(new RouteRateLimitMetadata("login", settings.LoginRateLimitMax, FifteenMinutes));

        routes.MapNative("POST", "/api/auth/signup", RouteAccess.Public, new RouteSchemas(Body: RequestSchemas.SignupRequest), async request =>
        {
            await Use<AuthUseCases>(request).SignupAsync(
                request.Body.Text("name"), request.Body.Text("email"), request.Body.Text("password"), ContextOf(request, settings), request.CancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        }).WithMetadata(new RouteRateLimitMetadata("signup", 5, FifteenMinutes));

        routes.MapNative("POST", "/api/auth/refresh", RouteAccess.Public, new RouteSchemas(), async request =>
        {
            var result = await Use<AuthUseCases>(request)
                .RefreshAsync(request.Http.Request.Cookies[RefreshCookie] ?? string.Empty, ContextOf(request, settings), request.CancellationToken).ConfigureAwait(false);
            SetRefreshCookie(request.Http, settings, result.RefreshToken, result.RefreshExpiresAt);
            return Results.Json(new { accessToken = result.AccessToken, expiresIn = result.ExpiresIn, user = result.User });
        });

        routes.MapNative("POST", "/api/auth/logout", RouteAccess.Public, new RouteSchemas(), async request =>
        {
            await Use<AuthUseCases>(request).LogoutAsync(request.Http.Request.Cookies[RefreshCookie], request.CancellationToken).ConfigureAwait(false);
            ClearRefreshCookie(request.Http, settings);
            return Results.NoContent();
        });

        routes.MapAuthenticated("GET", "/api/auth/me", new RouteSchemas(), async request =>
            Results.Json(await Use<AuthUseCases>(request).ProfileAsync(request.Actor, request.CancellationToken).ConfigureAwait(false)));

        routes.MapAuthenticated("PATCH", "/api/auth/me", new RouteSchemas(Body: RequestSchemas.UpdateProfileRequest), async request =>
            Results.Json(await Use<AuthUseCases>(request).UpdateProfileAsync(request.Actor, request.Body.Text("name"), request.CancellationToken).ConfigureAwait(false)));

        routes.MapAuthenticated("POST", "/api/auth/me/password", new RouteSchemas(Body: RequestSchemas.ChangePasswordRequest), async request =>
        {
            await Use<AuthUseCases>(request).ChangePasswordAsync(
                request.Actor, request.Body.Text("currentPassword"), request.Body.Text("newPassword"), ContextOf(request, settings), request.CancellationToken).ConfigureAwait(false);
            ClearRefreshCookie(request.Http, settings);
            return Results.NoContent();
        }).WithMetadata(new RouteRateLimitMetadata("password", 5, FifteenMinutes));
    }

    private static void MapAdminUsers(IEndpointRouteBuilder routes)
    {
        routes.MapNative("GET", "/api/admin/users", RouteAccess.Admin, new RouteSchemas(Query: RequestSchemas.ListUsersQuery), async request =>
        {
            var query = request.Query;
            var role = query.TextOrNull("role");
            var status = query.TextOrNull("status");
            var filter = new ListUsersFilter(
                query.SafeInteger("page"),
                query.SafeInteger("perPage"),
                query.TextOrNull("search"),
                role is null ? null : UserDto.ParseRole(role),
                status is null ? null : UserDto.ParseStatus(status));
            return Results.Json(await Use<AdminUserUseCases>(request).ListAsync(filter, request.CancellationToken).ConfigureAwait(false));
        });

        routes.MapNative("GET", "/api/admin/users/{id}", RouteAccess.Admin, new RouteSchemas(RequestSchemas.IdParams), async request =>
            Results.Json(await Use<AdminUserUseCases>(request).GetAsync(request.Params.Text("id"), request.CancellationToken).ConfigureAwait(false)));

        routes.MapNative("POST", "/api/admin/users", RouteAccess.Admin, new RouteSchemas(Body: RequestSchemas.CreateUserRequest), async request =>
        {
            var body = request.Body;
            var command = new CreateUserCommand(
                body.Text("name"), body.Text("email"), body.Text("password"), UserDto.ParseRole(body.Text("role")), body.Flag("mustChangePassword"), body.Flag("seedDefaultCategories"));
            var created = await Use<AdminUserUseCases>(request).CreateAsync(request.Actor, command, ContextOf(request), request.CancellationToken).ConfigureAwait(false);
            return Results.Json(created, statusCode: StatusCodes.Status201Created);
        });

        routes.MapNative("PATCH", "/api/admin/users/{id}", RouteAccess.Admin, new RouteSchemas(RequestSchemas.IdParams, RequestSchemas.UpdateUserRequest), async request =>
        {
            var body = request.Body;
            var role = body.OptionalText("role");
            var status = body.OptionalText("status");
            var command = new UpdateUserCommand(
                body.OptionalText("name"),
                body.OptionalText("email"),
                role.IsSet ? Patch.Set(UserDto.ParseRole(role.Value)) : default,
                status.IsSet ? Patch.Set(UserDto.ParseStatus(status.Value)) : default,
                JsRuntime.ToJsonText(body));
            return Results.Json(await Use<AdminUserUseCases>(request)
                .UpdateAsync(request.Actor, request.Params.Text("id"), command, ContextOf(request), request.CancellationToken).ConfigureAwait(false));
        });

        routes.MapNative("POST", "/api/admin/users/{id}/password", RouteAccess.Admin, new RouteSchemas(RequestSchemas.IdParams, RequestSchemas.ResetUserPasswordRequest), async request =>
        {
            await Use<AdminUserUseCases>(request).ResetPasswordAsync(
                request.Actor, request.Params.Text("id"), request.Body.Text("newPassword"), request.Body.Flag("mustChangePassword"), ContextOf(request), request.CancellationToken)
                .ConfigureAwait(false);
            return Results.NoContent();
        });

        routes.MapNative("DELETE", "/api/admin/users/{id}", RouteAccess.Admin, new RouteSchemas(RequestSchemas.IdParams), async request =>
        {
            await Use<AdminUserUseCases>(request).DeleteAsync(request.Actor, request.Params.Text("id"), ContextOf(request), request.CancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }

    /// <summary>IP do cliente (o mesmo do rate limit) e o <c>User-Agent</c>.</summary>
    private static RequestContext ContextOf(NativeRequest request, GranaSettings? settings = null)
    {
        var hops = (settings ?? request.Services.GetRequiredService<GranaSettings>()).TrustProxyHops;
        var userAgent = request.Http.Request.Headers.UserAgent.ToString();
        return new RequestContext(ClientIp.Of(request.Http, hops), userAgent.Length > 0 ? userAgent : null);
    }

    /// <summary>
    /// <c>reply.setCookie</c> do Node: httpOnly, só em <c>/api/auth</c>; em produção
    /// <c>Secure; SameSite=None</c> (front e API em domínios diferentes), senão <c>SameSite=Lax</c>.
    /// </summary>
    public static string RefreshCookieHeader(GranaSettings settings, string token, DateTime expiresAt)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var domain = settings.CookieDomain is { } value ? $"; Domain={value}" : string.Empty;
        var expires = expiresAt.ToString("R", CultureInfo.InvariantCulture);
        var security = settings.IsProduction ? "; Secure; SameSite=None" : "; SameSite=Lax";
        return $"{RefreshCookie}={token}{domain}; Path=/api/auth; Expires={expires}; HttpOnly{security}";
    }

    /// <summary><c>reply.clearCookie</c> do Node: vazio, <c>Max-Age=0</c>, data de 1970 e <c>SameSite=Lax</c>.</summary>
    public static string ClearRefreshCookieHeader(GranaSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var domain = settings.CookieDomain is { } value ? $"; Domain={value}" : string.Empty;
        return $"{RefreshCookie}=; Max-Age=0{domain}; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
    }

    private static void SetRefreshCookie(HttpContext context, GranaSettings settings, string token, DateTime expiresAt) =>
        context.Response.Headers.Append("Set-Cookie", RefreshCookieHeader(settings, token, expiresAt));

    private static void ClearRefreshCookie(HttpContext context, GranaSettings settings) =>
        context.Response.Headers.Append("Set-Cookie", ClearRefreshCookieHeader(settings));

    private static T Use<T>(NativeRequest request)
        where T : notnull => request.Services.GetRequiredService<T>();

}
