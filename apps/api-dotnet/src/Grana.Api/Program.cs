using Grana.Api.Endpoints;
using Grana.Api.Hosting;
using Grana.Api.Http;
using Grana.Api.Json;
using Grana.Api.Strangler;
using Grana.Application.Finance;
using Grana.Application.Identity;
using Grana.Infrastructure;
using Microsoft.AspNetCore.Routing.Matching;

var settings = GranaSettings.FromEnvironment(Environment.GetEnvironmentVariable);

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://{settings.Host}:{settings.Port}");
builder.WebHost.ConfigureKestrel(options =>
{
    // O Node não envia "Server"; corpo de até 1 MB como no Fastify (RN-017).
    options.AddServerHeader = false;
    options.Limits.MaxRequestBodySize = RequestBody.Limit;
});

builder.Services.AddSingleton(settings);
builder.Services.ConfigureHttpJsonOptions(options => GranaJson.Configure(options.SerializerOptions));
builder.Services.AddGranaInfrastructure(
    settings.DatabaseUrl,
    settings.JwtAccessSecret is { } secret ? new TokenOptions(secret, settings.AccessTokenTtl, settings.RefreshTokenTtlDays) : null);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(services => new RateLimiter(settings.RateLimitMax, TimeSpan.FromMinutes(1), services.GetRequiredService<TimeProvider>()));
builder.Services.AddSingleton(services => new AccessToken(settings.JwtAccessSecret ?? string.Empty, services.GetRequiredService<TimeProvider>()));
builder.Services.AddSingleton<RouteRateLimiters>();
builder.Services.AddSingleton<MatcherPolicy, ExactPathPolicy>();
builder.Services.AddScoped<SettingsUseCases>();
builder.Services.AddScoped<IncomeUseCases>();
builder.Services.AddScoped<CategoryUseCases>();
builder.Services.AddScoped<TransactionUseCases>();
builder.Services.AddScoped<DebtUseCases>();
builder.Services.AddScoped<GoalUseCases>();
builder.Services.AddScoped<BillUseCases>();
builder.Services.AddScoped<CardUseCases>();
builder.Services.AddScoped<DashboardUseCases>();
builder.Services.AddScoped<CashflowUseCases>();
if (settings.JwtAccessSecret is not null)
{
    // Emitem tokens: só existem com o segredo configurado (a fachada só de repasse não precisa dele).
    builder.Services.AddScoped<AuthUseCases>();
    builder.Services.AddScoped<AdminUserUseCases>();
}

if (settings.NodeUpstreamUrl is { Length: > 0 } upstream) builder.Services.AddNodeFallback(upstream);

var app = builder.Build();

app.UseRouting();
app.UseMiddleware<NativeEdgeMiddleware>();

app.MapHealth();
if (settings.IsNative("Settings")) app.MapSettings();
if (settings.IsNative("Incomes")) app.MapIncomes();
if (settings.IsNative("Categories")) app.MapCategories();
if (settings.IsNative("Transactions")) app.MapTransactions();
if (settings.IsNative("Debts")) app.MapDebts();
if (settings.IsNative("Goals")) app.MapGoals();
if (settings.IsNative("Bills")) app.MapBills();
if (settings.IsNative("Cards")) app.MapCards();
if (settings.IsNative("Dashboard")) app.MapDashboard();
if (settings.IsNative("Cashflow")) app.MapCashflow();
if (settings.IsNative("Identity")) app.MapIdentity(settings);
if (settings.NodeUpstreamUrl is { Length: > 0 }) app.MapReverseProxy();
else app.MapNativeFallback(); // Sem Node atrás (T-091): 404 e preflight do próprio .NET.

await app.RunAsync().ConfigureAwait(false);

/// <summary>Ponto de entrada (exposto para os testes de integração).</summary>
public partial class Program;
