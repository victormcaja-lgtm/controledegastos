using Grana.Api.Http;
using Grana.Api.Validation;
using Grana.Application.Finance;
using Grana.Domain.Common;
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

    public static void MapTransactions(this IEndpointRouteBuilder routes)
    {
        routes.MapAuthenticated("GET", "/api/transactions", new RouteSchemas(Query: RequestSchemas.ListTransactionsQuery), async request =>
        {
            var query = request.Query;
            var type = query.TextOrNull("type");
            var month = query.TextOrNull("month");
            var filter = new TransactionFilter(
                request.Actor.UserId,
                month is null ? null : MonthRef.Parse(month),
                query.TextOrNull("categoryId"),
                type is null ? null : ParseEntryType(type),
                query.TextOrNull("search"),
                query.SafeInteger("page"),
                query.SafeInteger("perPage"));
            return Results.Json(await Use<TransactionUseCases>(request).ListAsync(filter, request.CancellationToken).ConfigureAwait(false));
        });

        routes.MapAuthenticated("POST", "/api/transactions", new RouteSchemas(Body: RequestSchemas.CreateTransactionRequest), async request =>
        {
            var body = request.Body;
            var command = new CreateTransactionCommand(
                ParseEntryType(body.Text("type")),
                body.Int32Column("amountCents"),
                body.Text("categoryId"),
                body.Text("occurredOn"),
                body.TextOrNull("note"));
            var created = await Use<TransactionUseCases>(request).CreateAsync(request.Actor, command, request.CancellationToken).ConfigureAwait(false);
            return Results.Json(created, statusCode: StatusCodes.Status201Created);
        });

        routes.MapAuthenticated("PATCH", "/api/transactions/{id}", new RouteSchemas(RequestSchemas.IdParams, RequestSchemas.UpdateTransactionRequest), async request =>
        {
            var body = request.Body;
            var command = new UpdateTransactionCommand(
                body.OptionalInt32Column("amountCents"),
                body.OptionalText("categoryId"),
                body.OptionalText("occurredOn"),
                body.OptionalTextOrNull("note"));
            return Results.Json(await Use<TransactionUseCases>(request)
                .UpdateAsync(request.Actor, request.Params.Text("id"), command, request.CancellationToken).ConfigureAwait(false));
        });

        routes.MapAuthenticated("DELETE", "/api/transactions/{id}", new RouteSchemas(RequestSchemas.IdParams), async request =>
        {
            await Use<TransactionUseCases>(request).DeleteAsync(request.Actor, request.Params.Text("id"), request.CancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }

    public static void MapDebts(this IEndpointRouteBuilder routes)
    {
        routes.MapAuthenticated("GET", "/api/debts", new RouteSchemas(), async request =>
            Results.Json(await Use<DebtUseCases>(request).OverviewAsync(request.Actor, request.CancellationToken).ConfigureAwait(false)));

        routes.MapAuthenticated("POST", "/api/debts", new RouteSchemas(Body: RequestSchemas.CreateDebtRequest), async request =>
        {
            var body = request.Body;
            var command = new CreateDebtCommand(
                body.Text("name"), body.Int32Column("installmentCents"), body.Int32Column("totalInstallments"), body.Int32Column("paidInstallments"));
            var created = await Use<DebtUseCases>(request).CreateAsync(request.Actor, command, request.CancellationToken).ConfigureAwait(false);
            return Results.Json(created, statusCode: StatusCodes.Status201Created);
        });

        routes.MapAuthenticated("PATCH", "/api/debts/{id}", new RouteSchemas(RequestSchemas.IdParams, RequestSchemas.UpdateDebtRequest), async request =>
        {
            var body = request.Body;
            var command = new UpdateDebtCommand(
                body.OptionalText("name"),
                body.OptionalInt32Column("installmentCents"),
                body.OptionalInt32Column("totalInstallments"),
                body.OptionalInt32Column("paidInstallments"));
            return Results.Json(await Use<DebtUseCases>(request)
                .UpdateAsync(request.Actor, request.Params.Text("id"), command, request.CancellationToken).ConfigureAwait(false));
        });

        routes.MapAuthenticated("DELETE", "/api/debts/{id}", new RouteSchemas(RequestSchemas.IdParams), async request =>
        {
            await Use<DebtUseCases>(request).DeleteAsync(request.Actor, request.Params.Text("id"), request.CancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });

        routes.MapAuthenticated("POST", "/api/debts/{id}/convert", new RouteSchemas(RequestSchemas.IdParams, RequestSchemas.ConvertDebtRequest), async request =>
        {
            var bill = await Use<DebtUseCases>(request).ConvertAsync(
                request.Actor, request.Params.Text("id"), request.Body.Text("categoryId"), request.Body.Int32Column("dueDay"), request.CancellationToken).ConfigureAwait(false);
            return Results.Json(bill, statusCode: StatusCodes.Status201Created);
        });
    }

    public static void MapGoals(this IEndpointRouteBuilder routes)
    {
        routes.MapAuthenticated("GET", "/api/goals", new RouteSchemas(), async request =>
            Results.Json(await Use<GoalUseCases>(request).ListAsync(request.Actor, request.CancellationToken).ConfigureAwait(false)));

        routes.MapAuthenticated("POST", "/api/goals", new RouteSchemas(Body: RequestSchemas.CreateGoalRequest), async request =>
        {
            var body = request.Body;
            var command = new CreateGoalCommand(body.Text("name"), body.Int32Column("targetCents"), body.Int32Column("savedCents"), body.Flag("featured"));
            var created = await Use<GoalUseCases>(request).CreateAsync(request.Actor, command, request.CancellationToken).ConfigureAwait(false);
            return Results.Json(created, statusCode: StatusCodes.Status201Created);
        });

        routes.MapAuthenticated("PATCH", "/api/goals/{id}", new RouteSchemas(RequestSchemas.IdParams, RequestSchemas.UpdateGoalRequest), async request =>
        {
            var body = request.Body;
            var command = new UpdateGoalCommand(
                body.OptionalText("name"), body.OptionalInt32Column("targetCents"), body.OptionalInt32Column("savedCents"), body.OptionalFlag("featured"));
            return Results.Json(await Use<GoalUseCases>(request)
                .UpdateAsync(request.Actor, request.Params.Text("id"), command, request.CancellationToken).ConfigureAwait(false));
        });

        routes.MapAuthenticated("DELETE", "/api/goals/{id}", new RouteSchemas(RequestSchemas.IdParams), async request =>
        {
            await Use<GoalUseCases>(request).DeleteAsync(request.Actor, request.Params.Text("id"), request.CancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });

        // 200, não 201: responde a meta atualizada (RN-109).
        routes.MapAuthenticated("POST", "/api/goals/{id}/deposits", new RouteSchemas(RequestSchemas.IdParams, RequestSchemas.CreateGoalDepositRequest), async request =>
            Results.Json(await Use<GoalUseCases>(request)
                .DepositAsync(request.Actor, request.Params.Text("id"), request.Body.Int32Column("amountCents"), request.CancellationToken).ConfigureAwait(false)));
    }

    private static EntryType ParseEntryType(string value) => value == "INCOME" ? EntryType.Income : EntryType.Expense;

    private static T Use<T>(NativeRequest request)
        where T : notnull => request.Services.GetRequiredService<T>();
}
