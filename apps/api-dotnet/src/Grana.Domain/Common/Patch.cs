namespace Grana.Domain.Common;

/// <summary>
/// Campo de um PATCH: distingue "não veio" (<c>default</c>) de "veio com <c>null</c>".
/// No Node isso é o <c>undefined</c> × <c>null</c> do objeto validado pelo Zod — em
/// <c>openingDate</c>, por exemplo, <c>null</c> desliga o saldo futuro e a
/// ausência não mexe em nada (RN-151).
/// </summary>
public readonly record struct Patch<T>
{
    internal Patch(T value)
    {
        IsSet = true;
        Value = value;
    }

    public bool IsSet { get; }

    public T Value { get; }

    /// <summary>O valor novo, se veio; senão o atual.</summary>
    public T Or(T current) => IsSet ? Value : current;
}

public static class Patch
{
    /// <summary>Campo que veio no PATCH (inclusive com <c>null</c>).</summary>
    public static Patch<T> Set<T>(T value) => new(value);
}
