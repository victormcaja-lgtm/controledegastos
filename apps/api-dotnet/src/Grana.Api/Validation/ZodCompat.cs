using System.Text.RegularExpressions;

namespace Grana.Api.Validation;

/// <summary>Um problema de validação, como no <c>details</c> da API: caminho e mensagem.</summary>
public sealed record ValidationIssue(string Path, string Message);

/// <summary>Resultado de uma validação: dados de saída (após trim, defaults etc.) ou problemas.</summary>
public sealed record ValidationResult(bool Success, JsValue Data, IReadOnlyList<ValidationIssue> Issues);

/// <summary>
/// Réplica do mecanismo de validação do Zod 4 usado pela API Node (R-07). As
/// regras de execução são as de <c>zod/v4/core</c> (lidas no código-fonte):
/// <list type="bullet">
/// <item>Primeiro o tipo; depois as checagens, na ordem declarada.</item>
/// <item>Um problema "aborta" quando não é marcado como <c>continue</c> (erro de tipo,
/// opção inválida, inteiro inválido). Depois de abortar, só rodam as checagens com
/// condição <c>when</c> própria — as de tamanho, sobre qualquer valor com <c>length</c>.</item>
/// <item>Checagens de tamanho, formato, faixa numérica e <c>refine</c> não abortam:
/// um campo pode acumular várias mensagens.</item>
/// <item><c>pipe</c> só roda o segundo schema se o primeiro não teve nenhum problema.</item>
/// </list>
/// </summary>
public abstract class ZodSchema
{
    private readonly List<ZodCheck> _checks = [];

    public ValidationResult Validate(JsValue input)
    {
        var payload = new Payload(input);
        Run(payload);
        return new ValidationResult(
            payload.Issues.Count == 0,
            payload.Value,
            [.. payload.Issues.Select(issue => new ValidationIssue(string.Join('.', issue.Path), issue.Message))]);
    }

    internal void Run(Payload payload)
    {
        Parse(payload);
        RunChecks(payload);
    }

    /// <summary>Tipo e transformação estrutural (o <c>_zod.parse</c>).</summary>
    private protected abstract void Parse(Payload payload);

    /// <summary>Acrescenta uma checagem (o <c>.check()</c> do Zod).</summary>
    internal ZodSchema AddCheck(ZodCheck check)
    {
        _checks.Add(check);
        return this;
    }

    /// <summary>
    /// Validação personalizada sobre o valor já processado (<c>.refine</c>).
    /// <paramref name="path"/> é relativo a este schema (ex.: "confirmPassword").
    /// </summary>
    public ZodSchema Refine(Func<JsValue, bool> predicate, string message, string? path = null)
    {
        AddCheck(new ZodCheck(null, payload =>
        {
            if (predicate(payload.Value)) return;
            payload.Issues.Add(new Issue(path is null ? [] : [path], message, Continue: true));
        }));
        return this;
    }

    public ZodSchema Optional() => new OptionalSchema(this);

    public ZodSchema Nullable() => new NullableSchema(this);

    public ZodSchema Default(JsValue value) => new DefaultSchema(this, value);

    public ZodSchema Pipe(ZodSchema next) => new PipeSchema(this, next);

    private void RunChecks(Payload payload)
    {
        var aborted = payload.IsAborted(0);
        foreach (var check in _checks)
        {
            if (check.When is not null)
            {
                if (payload.IsExplicitlyAborted(0) || !check.When(payload.Value)) continue;
            }
            else if (aborted)
            {
                continue;
            }

            var before = payload.Issues.Count;
            check.Execute(payload);
            if (!aborted && payload.Issues.Count > before) aborted = payload.IsAborted(before);
        }
    }
}

internal sealed record Issue(List<string> Path, string Message, bool? Continue)
{
    public Issue Prefixed(string key) => this with { Path = [key, .. Path] };
}

internal sealed class Payload(JsValue value)
{
    public JsValue Value { get; set; } = value;

    public List<Issue> Issues { get; } = [];

    /// <summary><c>util.aborted</c>: algum problema sem <c>continue === true</c>.</summary>
    public bool IsAborted(int start) => Issues.Skip(start).Any(issue => issue.Continue != true);

    /// <summary><c>util.explicitlyAborted</c>: algum problema com <c>continue === false</c>.</summary>
    public bool IsExplicitlyAborted(int start) => Issues.Skip(start).Any(issue => issue.Continue == false);
}

internal sealed record ZodCheck(Func<JsValue, bool>? When, Action<Payload> Execute);

/// <summary>Fábrica de schemas, no estilo <c>z.*</c>.</summary>
public static class Z
{
    public static StringSchema String() => new();

    public static NumberSchema Number(bool coerce = false) => new(coerce);

    public static ZodSchema Boolean(bool coerce = false) => new BooleanSchema(coerce);

    public static ZodSchema Enum(params string[] values) => new EnumSchema(values);

    public static ObjectSchema Object(params (string Key, ZodSchema Schema)[] shape) => new(shape);

    /// <summary>Regex de e-mail do Zod 4 (<c>z.email()</c>), com a mensagem dada.</summary>
    public static ZodSchema Email(string message) =>
        String().Regex(EmailPattern(), message);

    internal static string Expected(string expected, JsValue input) =>
        $"Invalid input: expected {expected}, received {(input is JsNumber { Value: var v } && double.IsNaN(v) ? "NaN" : input.TypeName)}";

    private static Regex EmailPattern() => new(
        @"^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}\z",
        RegexOptions.CultureInvariant);
}

public sealed class StringSchema : ZodSchema
{
    private protected override void Parse(Payload payload)
    {
        if (payload.Value is JsString) return;
        payload.Issues.Add(new Issue([], Z.Expected("string", payload.Value), null));
    }

    /// <summary><c>.trim()</c> — sobrescreve o valor (sem <c>when</c>: não roda depois de abortar).</summary>
    public StringSchema Trim()
    {
        AddCheck(new ZodCheck(null, payload => payload.Value = new JsString(JsRuntime.Trim(((JsString)payload.Value).Value))));
        return this;
    }

    public StringSchema ToLowerCase()
    {
        AddCheck(new ZodCheck(null, payload => payload.Value = new JsString(((JsString)payload.Value).Value.ToLowerInvariant())));
        return this;
    }

    public StringSchema Min(int minimum, string? message = null)
    {
        AddCheck(new ZodCheck(HasLength, payload =>
        {
            var (length, origin) = Measure(payload.Value);
            if (length >= minimum) return;
            payload.Issues.Add(new Issue([], message ?? $"Too small: expected {origin} to have >={minimum} {Unit(origin)}", true));
        }));
        return this;
    }

    public StringSchema Max(int maximum, string? message = null)
    {
        AddCheck(new ZodCheck(HasLength, payload =>
        {
            var (length, origin) = Measure(payload.Value);
            if (length <= maximum) return;
            payload.Issues.Add(new Issue([], message ?? $"Too big: expected {origin} to have <={maximum} {Unit(origin)}", true));
        }));
        return this;
    }

    /// <summary><c>.regex()</c>. O padrão deve usar <c>[0-9]</c> e <c>\z</c> (semântica do JS).</summary>
    public StringSchema Regex(Regex pattern, string message)
    {
        AddCheck(new ZodCheck(null, payload =>
        {
            if (pattern.IsMatch(((JsString)payload.Value).Value)) return;
            payload.Issues.Add(new Issue([], message, true));
        }));
        return this;
    }

    private static bool HasLength(JsValue value) => value is JsString or JsArray;

    private static (int Length, string Origin) Measure(JsValue value) => value switch
    {
        JsString s => (s.CodePointLength, "string"),
        JsArray a => (a.Items.Count, "array"),
        _ => (0, "value"),
    };

    private static string Unit(string origin) => origin == "array" ? "items" : "characters";
}

public sealed class NumberSchema(bool coerce) : ZodSchema
{
    private const double MaxSafeInteger = 9007199254740991;

    private protected override void Parse(Payload payload)
    {
        if (coerce) payload.Value = new JsNumber(JsRuntime.ToNumber(payload.Value));
        if (payload.Value is JsNumber { Value: var number } && double.IsFinite(number)) return;
        var received = payload.Value is JsNumber { Value: var n } ? JsRuntime.NumberToString(n) : payload.Value.TypeName;
        payload.Issues.Add(new Issue([], $"Invalid input: expected number, received {received}", null));
    }

    /// <summary><c>.int()</c>: inteiro (aborta explicitamente) e dentro da faixa segura.</summary>
    public NumberSchema Int(string? message = null)
    {
        AddCheck(new ZodCheck(null, payload =>
        {
            var value = ((JsNumber)payload.Value).Value;
            if (value != Math.Floor(value))
            {
                payload.Issues.Add(new Issue([], message ?? "Invalid input: expected int, received number", false));
                return;
            }

            if (value > MaxSafeInteger)
            {
                payload.Issues.Add(new Issue([], message ?? "Too big: expected int to be <=9007199254740991", true));
            }
            else if (value < -MaxSafeInteger)
            {
                payload.Issues.Add(new Issue([], message ?? "Too small: expected int to be >=-9007199254740991", true));
            }
        }));
        return this;
    }

    public NumberSchema Positive(string? message = null) => GreaterThan(0, inclusive: false, message);

    public NumberSchema Min(double minimum, string? message = null) => GreaterThan(minimum, inclusive: true, message);

    public NumberSchema Max(double maximum, string? message = null)
    {
        AddCheck(new ZodCheck(null, payload =>
        {
            if (((JsNumber)payload.Value).Value <= maximum) return;
            payload.Issues.Add(new Issue([], message ?? $"Too big: expected number to be <={JsRuntime.NumberToString(maximum)}", true));
        }));
        return this;
    }

    private NumberSchema GreaterThan(double minimum, bool inclusive, string? message)
    {
        AddCheck(new ZodCheck(null, payload =>
        {
            var value = ((JsNumber)payload.Value).Value;
            if (inclusive ? value >= minimum : value > minimum) return;
            payload.Issues.Add(new Issue(
                [],
                message ?? $"Too small: expected number to be {(inclusive ? ">=" : ">")}{JsRuntime.NumberToString(minimum)}",
                true));
        }));
        return this;
    }
}

internal sealed class BooleanSchema(bool coerce) : ZodSchema
{
    private protected override void Parse(Payload payload)
    {
        if (coerce) payload.Value = new JsBoolean(JsRuntime.ToBoolean(payload.Value));
        if (payload.Value is JsBoolean) return;
        payload.Issues.Add(new Issue([], Z.Expected("boolean", payload.Value), null));
    }
}

internal sealed class EnumSchema(string[] values) : ZodSchema
{
    private protected override void Parse(Payload payload)
    {
        if (payload.Value is JsString s && values.Contains(s.Value)) return;
        var options = string.Join('|', values.Select(v => $"\"{v}\""));
        payload.Issues.Add(new Issue(
            [],
            values.Length == 1 ? $"Invalid input: expected {options}" : $"Invalid option: expected one of {options}",
            null));
    }
}

public sealed class ObjectSchema((string Key, ZodSchema Schema)[] shape) : ZodSchema
{
    private protected override void Parse(Payload payload)
    {
        if (payload.Value is not JsObject input)
        {
            payload.Issues.Add(new Issue([], Z.Expected("object", payload.Value), null));
            return;
        }

        var output = new List<KeyValuePair<string, JsValue>>();
        foreach (var (key, schema) in shape)
        {
            var present = input.Properties.Any(p => p.Key == key);
            var child = new Payload(input[key]);
            schema.Run(child);
            payload.Issues.AddRange(child.Issues.Select(issue => issue.Prefixed(key)));
            // Chave ausente que continuou undefined não aparece na saída (as chaves desconhecidas também não).
            if (present || child.Value is not JsUndefined) output.Add(new(key, child.Value));
        }

        payload.Value = new JsObject(output);
    }
}

internal sealed class OptionalSchema(ZodSchema inner) : ZodSchema
{
    private protected override void Parse(Payload payload)
    {
        if (payload.Value is JsUndefined) return;
        inner.Run(payload);
    }
}

internal sealed class NullableSchema(ZodSchema inner) : ZodSchema
{
    private protected override void Parse(Payload payload)
    {
        if (payload.Value is JsNull) return;
        inner.Run(payload);
    }
}

internal sealed class DefaultSchema(ZodSchema inner, JsValue value) : ZodSchema
{
    private protected override void Parse(Payload payload)
    {
        if (payload.Value is JsUndefined)
        {
            payload.Value = value;
            return;
        }

        inner.Run(payload);
    }
}

internal sealed class PipeSchema(ZodSchema first, ZodSchema second) : ZodSchema
{
    private protected override void Parse(Payload payload)
    {
        first.Run(payload);
        if (payload.Issues.Count > 0) return;
        second.Run(payload);
    }
}
