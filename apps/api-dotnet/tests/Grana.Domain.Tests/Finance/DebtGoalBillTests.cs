using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Domain.Tests.Finance;

/// <summary>Dívidas, projeção (RN-106–108), metas (RN-109) e a conta criada pela conversão.</summary>
public class DebtGoalBillTests
{
    private static readonly MonthRef October = MonthRef.Parse("2026-10");

    private static Debt NewDebt(int installment, int total, int paid = 0, string name = "Notebook") =>
        Debt.Create($"d-{name}", "u1", name, installment, paid, total);

    [Fact]
    public void Derivados_da_divida()
    {
        var debt = NewDebt(30000, 3);
        Assert.Equal((3, 90000L, 0, false), (debt.RemainingInstallments, debt.RemainingCents, debt.ProgressPercent, debt.Settled));
        debt.Update(default, default, Patch.Set(1), default);
        Assert.Equal((2, 60000L, 33), (debt.RemainingInstallments, debt.RemainingCents, debt.ProgressPercent));
        debt.Update(Patch.Set("PC"), Patch.Set(100), Patch.Set(3), default);
        Assert.Equal(("PC", 100, 0, true, 100), (debt.Name, debt.InstallmentCents, debt.RemainingInstallments, debt.Settled, debt.ProgressPercent));
        Assert.Equal(0L, Debt.Restore("x", "u1", "Grande", int.MaxValue, 0, 600).RemainingCents - (600L * int.MaxValue));
    }

    [Fact]
    public void Pagas_acima_do_total_na_edicao_da_422_e_nao_muda_nada()
    {
        var debt = NewDebt(30000, 3, paid: 2);
        Assert.Equal("As parcelas pagas não podem passar do total de parcelas.",
            Assert.Throws<BusinessRuleError>(() => debt.Update(Patch.Set("Outro"), default, Patch.Set(4), default)).Message);
        Assert.Throws<BusinessRuleError>(() => debt.Update(default, default, default, Patch.Set(1)));
        Assert.Equal(("Notebook", 2, 3), (debt.Name, debt.PaidInstallments, debt.TotalInstallments));
    }

    [Fact]
    public void Projecao_sem_parcelas()
    {
        var projection = DebtProjector.Project([], October);
        Assert.Equal(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"], projection.Months.Select(m => m.Month.Value));
        Assert.Equal(["out", "nov", "dez", "jan", "fev", "mar"], projection.Months.Select(m => m.Label));
        Assert.Equal(("Você não tem parcelas em aberto. 👏", 0L), (projection.Note, projection.MonthlyTotalCents));
    }

    [Fact]
    public void Projecao_com_o_mes_em_que_sobra_dinheiro()
    {
        var projection = DebtProjector.Project([NewDebt(10000, 12, 10, "Celular"), NewDebt(5000, 24, 0, "Moto")], October);
        Assert.Equal([15000L, 15000, 5000, 5000, 5000, 5000], projection.Months.Select(m => m.TotalCents));
        Assert.Equal("Em dezembro 2026 sobram R$ 100,00 a mais no seu bolso: uma parcela acaba.", projection.Note);
        Assert.Equal(15000L, projection.MonthlyTotalCents);

        Assert.Equal("As parcelas seguem iguais nos próximos meses.", DebtProjector.Project([NewDebt(5000, 24)], October).Note);
        Assert.Equal("Você não tem parcelas em aberto. 👏", DebtProjector.Project([NewDebt(5000, 2, 2)], October).Note);
    }

    /* Casos portados de apps/api/src/modules/finance/domain/budget.calculator.test.ts (projectDebts). */

    [Fact]
    public void Portado_detecta_o_mes_em_que_uma_parcela_acaba()
    {
        var result = DebtProjector.Project([NewDebt(43_000, 36, 34, "A"), NewDebt(64_000, 8, 3, "B")], MonthRef.Parse("2026-09"));
        Assert.Equal(107_000L, result.MonthlyTotalCents);
        Assert.Equal(6, result.Months.Count);
        Assert.Equal((107_000L, 64_000L), (result.Months[0].TotalCents, result.Months[2].TotalCents));
        Assert.Contains("a mais no seu bolso", result.Note, StringComparison.Ordinal);
    }

    [Fact]
    public void Portado_vira_o_ano_corretamente()
    {
        var result = DebtProjector.Project([NewDebt(10_000, 24)], MonthRef.Parse("2026-11"));
        Assert.Equal(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"], result.Months.Select(m => m.Month.Value));
    }

    [Fact]
    public void Conversao_em_conta_com_prazo()
    {
        var house = Category.CreateSystem("casa", "u1", "Casa", "x", CategoryKind.Expense);
        var bill = Bill.FromDebt("b1", NewDebt(25000, 10, 4, "Sofá"), house, 31, MonthRef.Parse("2026-02"));
        Assert.Equal(("Sofá", 25000, 31, true, 6, "2026-02"), (bill.Name, bill.AmountCents, bill.DueDay, bill.Active, bill.TotalInstallments, bill.StartMonth.Value));
        Assert.Equal((1, new DateOnly(2026, 2, 28)), (bill.InstallmentNumber(MonthRef.Parse("2026-02")), bill.DueDate(MonthRef.Parse("2026-02"))));
        Assert.Equal(3, bill.InstallmentNumber(MonthRef.Parse("2026-04")));
        Assert.Equal(new CategoryRef("casa", "Casa", "x", CategoryKind.Expense), bill.Category);

        var salary = Category.CreateSystem("salario", "u1", "Salário", "x", CategoryKind.Income);
        Assert.Equal("Contas fixas precisam de uma categoria de despesa.",
            Assert.Throws<BusinessRuleError>(() => Bill.FromDebt("b2", NewDebt(1, 2), salary, 1, October)).Message);
        Assert.Equal("Esta dívida já está quitada.",
            Assert.Throws<BusinessRuleError>(() => Bill.FromDebt("b3", NewDebt(1, 2, 2), salary, 1, October)).Message);

        var forever = Bill.Restore("b4", "u1", CategoryRef.Of(house), "Aluguel", 1, 5, false, October, null);
        Assert.Null(forever.InstallmentNumber(October));
        Assert.Equal(("u1", "b4"), (forever.UserId, forever.Id));
    }

    [Fact]
    public void Meta_derivados_e_edicao()
    {
        var goal = Goal.Create("g1", "u1", "Viagem", 100000, 0, featured: true);
        Assert.Equal((100000L, 0, false, true, 0), (goal.RemainingCents, goal.ProgressPercent, goal.Achieved, goal.Featured, goal.Deposits.Count));
        goal.Update(Patch.Set("Praia"), Patch.Set(1000), Patch.Set(1500), Patch.Set(false));
        Assert.Equal(("Praia", 0L, 100, true, false), (goal.Name, goal.RemainingCents, goal.ProgressPercent, goal.Achieved, goal.Featured));

        var deposit = new GoalDeposit("dep", 100, new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        var restored = Goal.Restore("g2", "u1", "Carro", 2000, 500, false, [deposit]);
        Assert.Equal((25, deposit, "u1"), (restored.ProgressPercent, restored.Deposits.Single(), restored.UserId));
    }
}
