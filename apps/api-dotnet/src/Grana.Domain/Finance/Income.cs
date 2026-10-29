using Grana.Domain.Common;

namespace Grana.Domain.Finance;

/// <summary>
/// Entrada fixa (salário, aluguel recebido...) — RN-105. Nome, valor e dia de
/// recebimento chegam já validados pelo contrato; inativa continua listada, mas
/// sai do saldo futuro. A exclusão é definitiva.
/// </summary>
public sealed class Income
{
    private Income(string id, string userId, string name, int amountCents, int receiptDay, bool active)
    {
        Id = id;
        UserId = userId;
        Name = name;
        AmountCents = amountCents;
        ReceiptDay = receiptDay;
        Active = active;
    }

    public string Id { get; }

    public string UserId { get; }

    public string Name { get; private set; }

    public int AmountCents { get; private set; }

    /// <summary>1–31; em meses mais curtos, o recebimento cai no último dia.</summary>
    public int ReceiptDay { get; private set; }

    public bool Active { get; private set; }

    public static Income Restore(string id, string userId, string name, int amountCents, int receiptDay, bool active) =>
        new(id, userId, name, amountCents, receiptDay, active);

    /// <summary>Toda entrada nasce ativa.</summary>
    public static Income Create(string id, string userId, string name, int amountCents, int receiptDay) =>
        new(id, userId, name, amountCents, receiptDay, active: true);

    /// <summary>Aplica só os campos que vieram no PATCH.</summary>
    public void Update(Patch<string> name, Patch<int> amountCents, Patch<int> receiptDay, Patch<bool> active)
    {
        Name = name.Or(Name);
        AmountCents = amountCents.Or(AmountCents);
        ReceiptDay = receiptDay.Or(ReceiptDay);
        Active = active.Or(Active);
    }
}
