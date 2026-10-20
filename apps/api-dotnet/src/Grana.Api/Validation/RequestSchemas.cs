using System.Text.RegularExpressions;
using Grana.Domain.Common;

namespace Grana.Api.Validation;

/// <summary>
/// Schemas de requisição — tradução linha a linha de
/// <c>packages/shared/src/primitives.ts</c> e <c>contracts/*.contract.ts</c>, e dos
/// schemas montados nas rotas (<c>*.routes.ts</c>). Cada um é conferido contra
/// o arquivo de referência gerado pelo Zod (tests/.../zod-golden.json).
/// Os padrões usam <c>[0-9]</c> e <c>\z</c>: no .NET, <c>\d</c> aceita dígitos de
/// outros alfabetos e <c>$</c> aceita uma quebra de linha final, ao contrário do JS.
/// </summary>
public static partial class RequestSchemas
{
    /* ───────────────────────────── Primitivos ───────────────────────────── */

    private const string CentsMessage = "O valor deve estar em centavos (número inteiro).";
    private const string DayMessage = "O dia precisa estar entre 1 e 31.";

    private static StringSchema Id() => Z.String().Min(8).Max(64);

    private static StringSchema MonthRef() => Z.String().Regex(MonthPattern(), "Competência inválida. Use o formato AAAA-MM.");

    private static ZodSchema IsoDate() =>
        Z.String()
            .Regex(IsoDatePattern(), "Data inválida. Use o formato AAAA-MM-DD.")
            .Refine(value => !double.IsNaN(JsDate.MidnightUtcMilliseconds(((JsString)value).Value)), "Data inexistente.");

    private static NumberSchema Cents() =>
        Z.Number().Int(CentsMessage).Positive("O valor precisa ser maior que zero.").Max(10_000_000_000, "Valor acima do limite suportado.");

    private static NumberSchema CentsOrZero() =>
        Z.Number().Int(CentsMessage).Min(0, "O valor não pode ser negativo.").Max(10_000_000_000, "Valor acima do limite suportado.");

    private static NumberSchema DayOfMonth() => Z.Number().Int().Min(1, DayMessage).Max(31, DayMessage);

    private static StringSchema Color() =>
        Z.String().Min(3).Max(64).Regex(ColorPattern(), "Cor inválida. Use hex, oklch(), rgb() ou hsl().");

    private static StringSchema Name() => Z.String().Trim().Min(2, "Informe pelo menos 2 caracteres.").Max(60, "Máximo de 60 caracteres.");

    private static StringSchema Note() => Z.String().Trim().Max(140, "Máximo de 140 caracteres.");

    private static ZodSchema Password() =>
        Z.String()
            .Min(10, "A senha precisa ter pelo menos 10 caracteres.")
            .Max(128, "A senha pode ter no máximo 128 caracteres.")
            .Refine(v => LowerPattern().IsMatch(((JsString)v).Value), "Inclua ao menos uma letra minúscula.")
            .Refine(v => UpperPattern().IsMatch(((JsString)v).Value), "Inclua ao menos uma letra maiúscula.")
            .Refine(v => DigitPattern().IsMatch(((JsString)v).Value), "Inclua ao menos um número.");

    private static ZodSchema Email() => Z.String().Trim().ToLowerCase().Max(160).Pipe(Z.Email("E-mail inválido."));

    private static ZodSchema UserRole() => Z.Enum("ADMIN", "USER");

    private static ZodSchema UserStatus() => Z.Enum("ACTIVE", "SUSPENDED", "PENDING");

    private static ZodSchema EntryType() => Z.Enum("EXPENSE", "INCOME");

    private static ZodSchema Page() => Z.Number(coerce: true).Int().Min(1).Default(new JsNumber(1));

    private static ZodSchema PerPage() => Z.Number(coerce: true).Int().Min(1).Max(100).Default(new JsNumber(20));

    private static ZodSchema Installments() => Z.Number().Int().Min(1).Max(48).Default(new JsNumber(1));

    private static ZodSchema TotalInstallments() => Z.Number().Int().Min(1).Max(600).Nullable().Optional();

    /// <summary><c>.refine(data =&gt; Object.keys(data).length &gt; 0, 'Nada para atualizar.')</c>.</summary>
    private static ZodSchema NotEmpty(ZodSchema schema) =>
        schema.Refine(data => ((JsObject)data).Properties.Count > 0, "Nada para atualizar.");

    private static string Text(JsValue data, string key) => ((JsString)((JsObject)data)[key]).Value;

    /// <summary><c>refineRange</c> de cashflow.contract.ts.</summary>
    private static ZodSchema RefineRange(ZodSchema schema) =>
        schema
            .Refine(data => string.CompareOrdinal(Text(data, "to"), Text(data, "from")) >= 0, "A data final precisa ser depois da inicial.", "to")
            .Refine(
                data => JsMath.Round(
                    (JsDate.MidnightUtcMilliseconds(Text(data, "to")) - JsDate.MidnightUtcMilliseconds(Text(data, "from"))) / 86_400_000) <= 400,
                "Peça no máximo 400 dias por vez.",
                "to");

    /* ───────────────────────────── Identity ─────────────────────────────── */

    public static readonly ZodSchema LoginRequest = Z.Object(
        ("email", Email()),
        ("password", Z.String().Min(1, "Informe a senha.").Max(128)));

    public static readonly ZodSchema SignupRequest = Z.Object(
        ("name", Z.String().Trim().Min(2, "Informe o nome completo.").Max(80)),
        ("email", Email()),
        ("password", Password()));

    public static readonly ZodSchema ChangePasswordRequest = Z.Object(
            ("currentPassword", Z.String().Min(1, "Informe a senha atual.")),
            ("newPassword", Password()),
            ("confirmPassword", Z.String()))
        .Refine(data => Text(data, "newPassword") == Text(data, "confirmPassword"), "As senhas não conferem.", "confirmPassword")
        .Refine(data => Text(data, "newPassword") != Text(data, "currentPassword"), "A nova senha precisa ser diferente da atual.", "newPassword");

    public static readonly ZodSchema UpdateProfileRequest = Z.Object(("name", Z.String().Trim().Min(2).Max(80)));

    public static readonly ZodSchema CreateUserRequest = Z.Object(
        ("name", Z.String().Trim().Min(2, "Informe o nome completo.").Max(80)),
        ("email", Email()),
        ("password", Password()),
        ("role", UserRole().Default(new JsString("USER"))),
        ("mustChangePassword", Z.Boolean().Default(new JsBoolean(true))),
        ("seedDefaultCategories", Z.Boolean().Default(new JsBoolean(true))));

    public static readonly ZodSchema UpdateUserRequest = NotEmpty(Z.Object(
        ("name", Z.String().Trim().Min(2).Max(80).Optional()),
        ("email", Email().Optional()),
        ("role", UserRole().Optional()),
        ("status", UserStatus().Optional())));

    public static readonly ZodSchema ResetUserPasswordRequest = Z.Object(
        ("newPassword", Password()),
        ("mustChangePassword", Z.Boolean().Default(new JsBoolean(true))));

    public static readonly ZodSchema ListUsersQuery = Z.Object(
        ("page", Page()),
        ("perPage", PerPage()),
        ("search", Z.String().Trim().Max(80).Optional()),
        ("role", UserRole().Optional()),
        ("status", UserStatus().Optional()));

    /* ────────────────────────────── Finance ─────────────────────────────── */

    public static readonly ZodSchema CreateCategoryRequest = Z.Object(
        ("name", Name()),
        ("color", Color().Optional()),
        ("kind", Z.Enum("EXPENSE", "INCOME").Default(new JsString("EXPENSE"))));

    public static readonly ZodSchema UpdateCategoryRequest = NotEmpty(Z.Object(
        ("name", Name().Optional()),
        ("color", Color().Optional()),
        ("archived", Z.Boolean().Optional())));

    public static readonly ZodSchema CreateTransactionRequest = Z.Object(
        ("type", EntryType()),
        ("amountCents", Cents()),
        ("categoryId", Id()),
        ("occurredOn", IsoDate()),
        ("note", Note().Optional()));

    public static readonly ZodSchema UpdateTransactionRequest = NotEmpty(Z.Object(
        ("amountCents", Cents().Optional()),
        ("categoryId", Id().Optional()),
        ("occurredOn", IsoDate().Optional()),
        ("note", Note().Nullable().Optional())));

    public static readonly ZodSchema ListTransactionsQuery = Z.Object(
        ("page", Page()),
        ("perPage", PerPage()),
        ("month", MonthRef().Optional()),
        ("categoryId", Id().Optional()),
        ("type", EntryType().Optional()),
        ("search", Z.String().Trim().Max(80).Optional()));

    public static readonly ZodSchema CreateBillRequest = Z.Object(
        ("name", Name()),
        ("categoryId", Id()),
        ("amountCents", Cents()),
        ("dueDay", DayOfMonth()),
        ("totalInstallments", TotalInstallments()));

    public static readonly ZodSchema UpdateBillRequest = NotEmpty(Z.Object(
        ("name", Name().Optional()),
        ("categoryId", Id().Optional()),
        ("amountCents", Cents().Optional()),
        ("dueDay", DayOfMonth().Optional()),
        ("active", Z.Boolean().Optional()),
        ("totalInstallments", TotalInstallments())));

    public static readonly ZodSchema SetBillPaymentRequest = Z.Object(
        ("month", MonthRef()),
        ("paid", Z.Boolean()),
        ("waived", Z.Boolean().Optional()),
        ("amountCents", Cents().Optional()));

    public static readonly ZodSchema CreateIncomeRequest = Z.Object(
        ("name", Name()),
        ("amountCents", Cents()),
        ("receiptDay", DayOfMonth()));

    public static readonly ZodSchema UpdateIncomeRequest = NotEmpty(Z.Object(
        ("name", Name().Optional()),
        ("amountCents", Cents().Optional()),
        ("receiptDay", DayOfMonth().Optional()),
        ("active", Z.Boolean().Optional())));

    public static readonly ZodSchema CreateDebtRequest = Z.Object(
            ("name", Name()),
            ("installmentCents", Cents()),
            ("totalInstallments", Z.Number().Int().Min(1).Max(600)),
            ("paidInstallments", Z.Number().Int().Min(0).Max(600).Default(new JsNumber(0))))
        .Refine(
            data => ((JsNumber)((JsObject)data)["paidInstallments"]).Value <= ((JsNumber)((JsObject)data)["totalInstallments"]).Value,
            "Parcelas pagas não podem passar do total.",
            "paidInstallments");

    public static readonly ZodSchema UpdateDebtRequest = NotEmpty(Z.Object(
        ("name", Name().Optional()),
        ("installmentCents", Cents().Optional()),
        ("totalInstallments", Z.Number().Int().Min(1).Max(600).Optional()),
        ("paidInstallments", Z.Number().Int().Min(0).Max(600).Optional())));

    public static readonly ZodSchema ConvertDebtRequest = Z.Object(("categoryId", Id()), ("dueDay", DayOfMonth()));

    public static readonly ZodSchema CreateGoalRequest = Z.Object(
        ("name", Name()),
        ("targetCents", Cents()),
        ("savedCents", CentsOrZero().Default(new JsNumber(0))),
        ("featured", Z.Boolean().Default(new JsBoolean(false))));

    public static readonly ZodSchema UpdateGoalRequest = NotEmpty(Z.Object(
        ("name", Name().Optional()),
        ("targetCents", Cents().Optional()),
        ("savedCents", CentsOrZero().Optional()),
        ("featured", Z.Boolean().Optional())));

    public static readonly ZodSchema CreateGoalDepositRequest = Z.Object(("amountCents", Cents()));

    public static readonly ZodSchema UpdateSettingsRequest = NotEmpty(Z.Object(
        ("overspendAlerts", Z.Boolean().Optional()),
        ("weeklySummary", Z.Boolean().Optional()),
        ("roundCents", Z.Boolean().Optional()),
        ("autoDarkMode", Z.Boolean().Optional()),
        ("showDailyAllowance", Z.Boolean().Optional()),
        ("openingBalanceCents", Z.Number().Int(CentsMessage).Min(-10_000_000_000).Max(10_000_000_000).Optional()),
        ("openingDate", IsoDate().Nullable().Optional()),
        ("dailyBudgetCents", CentsOrZero().Nullable().Optional())));

    public static readonly ZodSchema CreateCardRequest = Z.Object(
        ("name", Name()),
        ("closingDay", DayOfMonth()),
        ("dueDay", DayOfMonth()),
        ("limitCents", Cents().Nullable().Optional()));

    public static readonly ZodSchema UpdateCardRequest = NotEmpty(Z.Object(
        ("name", Name().Optional()),
        ("closingDay", DayOfMonth().Optional()),
        ("dueDay", DayOfMonth().Optional()),
        ("limitCents", Cents().Nullable().Optional()),
        ("active", Z.Boolean().Optional())));

    public static readonly ZodSchema CreateCardPurchaseRequest = Z.Object(
        ("amountCents", Cents()),
        ("installments", Installments()),
        ("purchasedOn", IsoDate()),
        ("categoryId", Id()),
        ("note", Note().Optional()));

    public static readonly ZodSchema CashflowQuery = RefineRange(Z.Object(
        ("from", IsoDate()),
        ("to", IsoDate()),
        ("today", IsoDate().Optional())));

    public static readonly ZodSchema SimulatePurchaseRequest = RefineRange(Z.Object(
            ("from", IsoDate()),
            ("to", IsoDate()),
            ("today", IsoDate().Optional()),
            ("amountCents", Cents()),
            ("installments", Installments()),
            ("date", IsoDate()),
            ("method", Z.Enum("ACCOUNT", "CARD")),
            ("cardId", Id().Optional())))
        .Refine(
            data => Text(data, "method") != "CARD" || ((JsObject)data)["cardId"] is JsString { Value.Length: > 0 },
            "Escolha o cartão.",
            "cardId");

    /* ───────────────────── Schemas montados nas rotas ───────────────────── */

    public static readonly ZodSchema MonthQuery = Z.Object(("month", MonthRef().Optional()));

    public static readonly ZodSchema InvoiceQuery = Z.Object(("month", MonthRef().Optional()));

    public static readonly ZodSchema TodayQuery = Z.Object(("today", IsoDate().Optional()));

    public static readonly ZodSchema CategoriesQuery = Z.Object(("includeArchived", Z.Boolean(coerce: true).Default(new JsBoolean(false))));

    public static readonly ZodSchema IdParams = Z.Object(("id", Id()));

    /// <summary>Todos os schemas, pelo nome usado no arquivo de referência.</summary>
    public static IReadOnlyDictionary<string, ZodSchema> All { get; } = new Dictionary<string, ZodSchema>
    {
        ["loginRequest"] = LoginRequest,
        ["signupRequest"] = SignupRequest,
        ["changePasswordRequest"] = ChangePasswordRequest,
        ["updateProfileRequest"] = UpdateProfileRequest,
        ["createUserRequest"] = CreateUserRequest,
        ["updateUserRequest"] = UpdateUserRequest,
        ["resetUserPasswordRequest"] = ResetUserPasswordRequest,
        ["listUsersQuery"] = ListUsersQuery,
        ["createCategoryRequest"] = CreateCategoryRequest,
        ["updateCategoryRequest"] = UpdateCategoryRequest,
        ["createTransactionRequest"] = CreateTransactionRequest,
        ["updateTransactionRequest"] = UpdateTransactionRequest,
        ["listTransactionsQuery"] = ListTransactionsQuery,
        ["createBillRequest"] = CreateBillRequest,
        ["updateBillRequest"] = UpdateBillRequest,
        ["setBillPaymentRequest"] = SetBillPaymentRequest,
        ["createIncomeRequest"] = CreateIncomeRequest,
        ["updateIncomeRequest"] = UpdateIncomeRequest,
        ["createDebtRequest"] = CreateDebtRequest,
        ["updateDebtRequest"] = UpdateDebtRequest,
        ["convertDebtRequest"] = ConvertDebtRequest,
        ["createGoalRequest"] = CreateGoalRequest,
        ["updateGoalRequest"] = UpdateGoalRequest,
        ["createGoalDepositRequest"] = CreateGoalDepositRequest,
        ["updateSettingsRequest"] = UpdateSettingsRequest,
        ["createCardRequest"] = CreateCardRequest,
        ["updateCardRequest"] = UpdateCardRequest,
        ["createCardPurchaseRequest"] = CreateCardPurchaseRequest,
        ["simulatePurchaseRequest"] = SimulatePurchaseRequest,
        ["cashflowQuery"] = CashflowQuery,
        ["monthQuery"] = MonthQuery,
        ["invoiceQuery"] = InvoiceQuery,
        ["todayQuery"] = TodayQuery,
        ["categoriesQuery"] = CategoriesQuery,
        ["idParams"] = IdParams,
    };

    [GeneratedRegex(@"^[0-9]{4}-(0[1-9]|1[0-2])\z")]
    private static partial Regex MonthPattern();

    [GeneratedRegex(@"^[0-9]{4}-[0-9]{2}-[0-9]{2}\z")]
    private static partial Regex IsoDatePattern();

    [GeneratedRegex(@"^(#[0-9a-fA-F]{3,8}|oklch\([^)]+\)|rgb\([^)]+\)|hsl\([^)]+\))\z")]
    private static partial Regex ColorPattern();

    [GeneratedRegex("[a-z]")]
    private static partial Regex LowerPattern();

    [GeneratedRegex("[A-Z]")]
    private static partial Regex UpperPattern();

    [GeneratedRegex("[0-9]")]
    private static partial Regex DigitPattern();
}
