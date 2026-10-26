using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Domain.Tests.Finance;

/// <summary>Entradas fixas — RN-105 (incomes.usecases.ts).</summary>
public class IncomeTests
{
    [Fact]
    public void Nasce_ativa()
    {
        var income = Income.Create("i1", "u1", "Salário", 520_000, 5);
        Assert.Equal(("i1", "u1", "Salário", 520_000, 5, true),
            (income.Id, income.UserId, income.Name, income.AmountCents, income.ReceiptDay, income.Active));
    }

    [Fact]
    public void Patch_altera_so_o_que_veio()
    {
        var income = Income.Create("i1", "u1", "Salário", 520_000, 5);
        income.Update(default, Patch.Set<int>(530_000), default, Patch.Set<bool>(false));
        Assert.Equal(("Salário", 530_000, 5, false), (income.Name, income.AmountCents, income.ReceiptDay, income.Active));

        income.Update(Patch.Set<string>("Salário novo"), default, Patch.Set<int>(31), default);
        Assert.Equal(("Salário novo", 530_000, 31, false), (income.Name, income.AmountCents, income.ReceiptDay, income.Active));
    }

    [Fact]
    public void Patch_vazio_nao_muda_nada()
    {
        var income = Income.Restore("i1", "u1", "Aluguel", 90_000, 10, active: false);
        income.Update(default, default, default, default);
        Assert.Equal(("Aluguel", 90_000, 10, false), (income.Name, income.AmountCents, income.ReceiptDay, income.Active));
    }
}
