namespace Grana.Domain.Common;

/// <summary>Operações de texto com a semântica do JavaScript.</summary>
public static class JsText
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

    /// <summary><c>String.prototype.trim</c>.</summary>
    public static string Trim(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return value.Trim(Whitespace);
    }

    /// <summary><c>value.slice(0, max)</c>: corta em unidades UTF-16, como o JavaScript.</summary>
    public static string? Slice(string? value, int max) => value is null || value.Length <= max ? value : value[..max];
}
