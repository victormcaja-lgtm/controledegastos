using Grana.Api.Http;
using Grana.Api.Validation;
using Grana.Application.Finance;
using Grana.Domain.Finance;

namespace Grana.Api.Endpoints;

/// <summary>
/// Rotas do M1 — <c>finance.routes.ts</c>: ajustes, entradas fixas e categorias.
/// Cada grupo só é mapeado com o módulo em <c>dotnet</c>; em <c>node</c>, as
/// mesmas URLs caem no repasse ao Node.
/// </summary>
public static class FinanceEndpoints
{
    public static void MapSettings(this IEndpointRouteBuilder routes)
    {
        routes.MapAuthenticated("GET", "/api/settings", new RouteSchemas(), async request =>
            Results.Json(await Use<SettingsUseCases>(request).GetAsync(request.Actor, request.CancellationToken).ConfigureAwait(false)));

        routes.MapAuthenticated("PATCH", "/api/settings", new RouteSchemas(Body: RequestSchemas.UpdateSettingsRequest), async request =>
        {
            var body = request.Body;
            var patch = new SettingsPatch
            {
                OverspendAlerts = body.OptionalFlag("overspendAlerts"),
                WeeklySummary = body.OptionalFlag("weeklySummary"),
                RoundCents = body.OptionalFlag("roundCents"),
                AutoDarkMode = body.OptionalFlag("autoDarkMode"),
                ShowDailyAllowance = body.OptionalFlag("showDailyAllowance"),
                OpeningBalanceCents = body.OptionalInt32Column("openingBalanceCents"),
                OpeningDate = body.OptionalTextOrNull("openingDate"),
                DailyBudgetCents = body.OptionalInt32ColumnOrNull("dailyBudgetCents"),
            };
            return Results.Json(await Use<SettingsUseCases>(request).UpdateAsync(request.Actor, patch, request.CancellationToken).ConfigureAwait(false));
        });
    }

    public static void MapIncomes(this IEndpointRouteBuilder routes)
    {
        routes.MapAuthenticated("GET", "/api/incomes", new RouteSchemas(), async request =>
            Results.Json(await Use<IncomeUseCases>(request).ListAsync(request.Actor, request.CancellationToken).ConfigureAwait(false)));

        routes.MapAuthenticated("POST", "/api/incomes", new RouteSchemas(Body: RequestSchemas.CreateIncomeRequest), async request =>
        {
            var body = request.Body;
            var command = new CreateIncomeCommand(body.Text("name"), body.Int32Column("amountCents"), body.Int32Column("receiptDay"));
            var created = await Use<IncomeUseCases>(request).CreateAsync(request.Actor, command, request.CancellationToken).ConfigureAwait(false);
            return Results.Json(created, statusCode: StatusCodes.Status201Created);
        });

        routes.MapAuthenticated("PATCH", "/api/incomes/{id}", new RouteSchemas(RequestSchemas.IdParams, RequestSchemas.UpdateIncomeRequest), async request =>
        {
            var body = request.Body;
            var command = new UpdateIncomeCommand(
                body.OptionalText("name"),
                body.OptionalInt32Column("amountCents"),
                body.OptionalInt32Column("receiptDay"),
                body.OptionalFlag("active"));
            return Results.Json(await Use<IncomeUseCases>(request)
                .UpdateAsync(request.Actor, request.Params.Text("id"), command, request.CancellationToken).ConfigureAwait(false));
        });

        routes.MapAuthenticated("DELETE", "/api/incomes/{id}", new RouteSchemas(RequestSchemas.IdParams), async request =>
        {
            await Use<IncomeUseCases>(request).DeleteAsync(request.Actor, request.Params.Text("id"), request.CancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }

    public static void MapCategories(this IEndpointRouteBuilder routes)
    {
        routes.MapAuthenticated("GET", "/api/categories", new RouteSchemas(Query: RequestSchemas.CategoriesQuery), async request =>
            Results.Json(await Use<CategoryUseCases>(request)
                .ListAsync(request.Actor, request.Query.Flag("includeArchived"), request.CancellationToken).ConfigureAwait(false)));

        routes.MapAuthenticated("POST", "/api/categories", new RouteSchemas(Body: RequestSchemas.CreateCategoryRequest), async request =>
        {
            var body = request.Body;
            var command = new CreateCategoryCommand(
                body.Text("name"),
                body.TextOrNull("color"),
                body.Text("kind") == "INCOME" ? CategoryKind.Income : CategoryKind.Expense);
            var created = await Use<CategoryUseCases>(request).CreateAsync(request.Actor, command, request.CancellationToken).ConfigureAwait(false);
            return Results.Json(created, statusCode: StatusCodes.Status201Created);
        });

        routes.MapAuthenticated("PATCH", "/api/categories/{id}", new RouteSchemas(RequestSchemas.IdParams, RequestSchemas.UpdateCategoryRequest), async request =>
        {
            var body = request.Body;
            var command = new UpdateCategoryCommand(body.OptionalText("name"), body.OptionalText("color"), body.OptionalFlag("archived"));
            return Results.Json(await Use<CategoryUseCases>(request)
                .UpdateAsync(request.Actor, request.Params.Text("id"), command, request.CancellationToken).ConfigureAwait(false));
        });

        routes.MapAuthenticated("DELETE", "/api/categories/{id}", new RouteSchemas(RequestSchemas.IdParams), async request =>
        {
            await Use<CategoryUseCases>(request).DeleteAsync(request.Actor, request.Params.Text("id"), request.CancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }

    private static T Use<T>(NativeRequest request)
        where T : notnull => request.Services.GetRequiredService<T>();
}
