using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Grana.Api.Validation;

/// <summary>
/// Valor no modelo do JavaScript, que a validação do Zod enxerga: distingue
/// <c>undefined</c> (campo ausente) de <c>null</c>, e guarda números como double.
/// </summary>
public abstract record JsValue
{
    /// <summary>Tipo como o Zod o descreve em "received …" (<c>util.getParsedType</c>).</summary>
    public abstract string TypeName { get; }

    public static JsValue FromJson(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Undefined => JsUndefined.Instance,
        JsonValueKind.Null => JsNull.Instance,
        JsonValueKind.True => new JsBoolean(true),
        JsonValueKind.False => new JsBoolean(false),
        JsonValueKind.Number => new JsNumber(element.GetDouble()),
        JsonValueKind.String => new JsString(element.GetString()!),
        JsonValueKind.Array => new JsArray([.. element.EnumerateArray().Select(FromJson)]),
        _ => ObjectFromJson(element),
    };

    /// <summary>Chave repetida: vale o ÚLTIMO valor, na posição da primeira (como o <c>JSON.parse</c>).</summary>
    private static JsObject ObjectFromJson(JsonElement element)
    {
        var properties = new List<KeyValuePair<string, JsValue>>();
        var positions = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            var value = FromJson(property.Value);
            if (positions.TryGetValue(property.Name, out var index))
            {
                properties[index] = new(property.Name, value);
            }
            else
            {
                positions[property.Name] = properties.Count;
                properties.Add(new(property.Name, value));
            }
        }

        return new JsObject(properties);
    }

    /// <summary>Converte para JSON; <c>undefined</c> some (como no <c>JSON.stringify</c>).</summary>
    public abstract JsonNode? ToJsonNode();
}

public sealed record JsUndefined : JsValue
{
    public static readonly JsUndefined Instance = new();

    private JsUndefined()
    {
    }

    public override string TypeName => "undefined";

    public override JsonNode? ToJsonNode() => null;
}

public sealed record JsNull : JsValue
{
    public static readonly JsNull Instance = new();

    private JsNull()
    {
    }

    public override string TypeName => "null";

    public override JsonNode? ToJsonNode() => null;
}

public sealed record JsBoolean(bool Value) : JsValue
{
    public override string TypeName => "boolean";

    public override JsonNode? ToJsonNode() => JsonValue.Create(Value);
}

public sealed record JsNumber(double Value) : JsValue
{
    public override string TypeName => double.IsNaN(Value) ? "nan" : "number";

    public override JsonNode? ToJsonNode() => JsonValue.Create(Value);
}

public sealed record JsString(string Value) : JsValue
{
    public override string TypeName => "string";

    /// <summary>Tamanho em code points, como o Zod mede strings.</summary>
    public int CodePointLength
    {
        get
        {
            var length = 0;
            for (var index = 0; index < Value.Length; index++, length++)
            {
                if (char.IsHighSurrogate(Value[index]) && index + 1 < Value.Length && char.IsLowSurrogate(Value[index + 1])) index++;
            }

            return length;
        }
    }

    public override JsonNode? ToJsonNode() => JsonValue.Create(Value);
}

public sealed record JsArray(IReadOnlyList<JsValue> Items) : JsValue
{
    public override string TypeName => "array";

    public override JsonNode? ToJsonNode() => new JsonArray([.. Items.Select(item => item.ToJsonNode())]);
}

/// <summary>Objeto com chaves na ordem de inserção (como no JS).</summary>
public sealed record JsObject(IReadOnlyList<KeyValuePair<string, JsValue>> Properties) : JsValue
{
    public override string TypeName => "object";

    public JsValue this[string key] => Properties.FirstOrDefault(p => p.Key == key).Value ?? JsUndefined.Instance;

    public override JsonNode? ToJsonNode()
    {
        var node = new JsonObject();
        foreach (var (key, value) in Properties)
        {
            if (value is JsUndefined) continue;
            node[key] = value.ToJsonNode();
        }

        return node;
    }
}

/// <summary>Operações com a semântica do JavaScript usadas pelo Zod.</summary>
public static class JsRuntime
{
    // WhiteSpace + LineTerminator da especificação ECMAScript (o que String.prototype.trim remove).
    private static readonly char[] Whitespace =
    [
        .. new ushort[]
        {
            0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x0020, 0x00A0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
            0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
        }.Select(code => (char)code),
    ];

    public static string Trim(string value) => value.Trim(Whitespace);

    /// <summary><c>Number(value)</c>.</summary>
    public static double ToNumber(JsValue value) => value switch
    {
        JsUndefined => double.NaN,
        JsNull => 0,
        JsBoolean b => b.Value ? 1 : 0,
        JsNumber n => n.Value,
        JsString s => StringToNumber(s.Value),
        JsArray { Items.Count: 0 } => 0,
        JsArray { Items.Count: 1 } a => StringToNumber(ToStringValue(a.Items[0])),
        _ => double.NaN,
    };

    /// <summary><c>Boolean(value)</c>.</summary>
    public static bool ToBoolean(JsValue value) => value switch
    {
        JsUndefined or JsNull => false,
        JsBoolean b => b.Value,
        JsNumber n => n.Value != 0 && !double.IsNaN(n.Value),
        JsString s => s.Value.Length > 0,
        _ => true,
    };

    /// <summary><c>String(value)</c> para os casos que aparecem em querystring.</summary>
    public static string ToStringValue(JsValue value) => value switch
    {
        JsUndefined => "undefined",
        JsNull => "null",
        JsBoolean b => b.Value ? "true" : "false",
        JsNumber n => NumberToString(n.Value),
        JsString s => s.Value,
        JsArray a => string.Join(',', a.Items.Select(item => item is JsNull or JsUndefined ? string.Empty : ToStringValue(item))),
        _ => "[object Object]",
    };

    /// <summary><c>String(number)</c> para os valores usados nas mensagens (inteiros e decimais simples).</summary>
    public static string NumberToString(double value)
    {
        if (double.IsNaN(value)) return "NaN";
        if (double.IsPositiveInfinity(value)) return "Infinity";
        if (double.IsNegativeInfinity(value)) return "-Infinity";
        if (value == Math.Floor(value) && Math.Abs(value) < 1e21) return value.ToString("F0", CultureInfo.InvariantCulture);
        return value.ToString("R", CultureInfo.InvariantCulture);
    }

    private static double StringToNumber(string raw)
    {
        var text = Trim(raw);
        if (text.Length == 0) return 0;
        switch (text)
        {
            case "Infinity" or "+Infinity": return double.PositiveInfinity;
            case "-Infinity": return double.NegativeInfinity;
        }

        if (text.Length > 2 && text[0] == '0' && text[1] is 'x' or 'X' or 'o' or 'O' or 'b' or 'B')
        {
            var radix = text[1] switch { 'x' or 'X' => 16, 'o' or 'O' => 8, _ => 2 };
            double result = 0;
            foreach (var digit in text[2..])
            {
                var valueOfDigit = digit switch
                {
                    >= '0' and <= '9' => digit - '0',
                    >= 'a' and <= 'f' => digit - 'a' + 10,
                    >= 'A' and <= 'F' => digit - 'A' + 10,
                    _ => 99,
                };
                if (valueOfDigit >= radix) return double.NaN;
                result = (result * radix) + valueOfDigit;
            }

            return result;
        }

        return IsDecimalLiteral(text) && double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            ? number
            : double.NaN;
    }

    // StrDecimalLiteral: [+-] (dígitos [. dígitos] | . dígitos) [e [+-] dígitos]
    private static bool IsDecimalLiteral(string text)
    {
        var index = 0;
        if (text[index] is '+' or '-') index++;
        var digitsBefore = CountDigits(text, ref index);
        var digitsAfter = 0;
        if (index < text.Length && text[index] == '.')
        {
            index++;
            digitsAfter = CountDigits(text, ref index);
        }

        if (digitsBefore + digitsAfter == 0) return false;
        if (index < text.Length && text[index] is 'e' or 'E')
        {
            index++;
            if (index < text.Length && text[index] is '+' or '-') index++;
            if (CountDigits(text, ref index) == 0) return false;
        }

        return index == text.Length;
    }

    private static int CountDigits(string text, ref int index)
    {
        var start = index;
        while (index < text.Length && char.IsAsciiDigit(text[index])) index++;
        return index - start;
    }

    /// <summary>Texto JSON compacto (para comparação em testes e log).</summary>
    public static string ToJsonText(JsValue value)
    {
        var node = value.ToJsonNode();
        if (node is null) return value is JsNull ? "null" : "undefined";
        var builder = new StringBuilder();
        builder.Append(node.ToJsonString());
        return builder.ToString();
    }
}
