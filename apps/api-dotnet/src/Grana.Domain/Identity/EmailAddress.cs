using System.Text.RegularExpressions;
using Grana.Domain.Common;

namespace Grana.Domain.Identity;

/// <summary>
/// E-mail — <c>email.vo.ts</c>: aparado, em minúsculas, até 160 caracteres e no padrão
/// <c>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/</c> do JavaScript (o <c>\s</c> do JS, não o do .NET).
/// Fora disso, <c>ValidationError</c> 422 "E-mail inválido." com <c>details</c> — inclusive
/// ao LER do banco um e-mail fora do padrão, como o mapper do Node faz.
/// </summary>
public sealed partial record EmailAddress
{
    private EmailAddress(string value) => Value = value;

    public string Value { get; }

    public static EmailAddress Create(string raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        var value = JsText.Trim(raw).ToLowerInvariant();
        if (value.Length > 160 || !Pattern().IsMatch(value))
        {
            throw new ValidationError("E-mail inválido.", [("email", "E-mail inválido.")]);
        }

        return new EmailAddress(value);
    }

    public override string ToString() => Value;

    // [^\s@] com o \s do JavaScript: WhiteSpace + LineTerminator do ECMAScript.
    [GeneratedRegex(@"^[^\t\n\v\f\r    -     　﻿@]+@[^\t\n\v\f\r    -     　﻿@]+\.[^\t\n\v\f\r    -     　﻿@]{2,}\z")]
    private static partial Regex Pattern();
}
