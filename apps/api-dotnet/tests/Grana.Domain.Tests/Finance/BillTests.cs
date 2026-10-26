using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Domain.Tests.Finance;

/// <summary>Contas fixas, calendário e atrasadas — RN-090–101.</summary>
public class BillTests
{
    private static readonly Category House = Category.CreateSystem("casa", "u1", "Casa", "x", CategoryKind.Expense);
    private static readonly Category Salary = Category.CreateSystem("salario", "u1", "Salário", "y", CategoryKind.Income);
    private static readonly MonthRef October = MonthRef.Parse("2026-10");

    private static Bill NewBill(string id, int dueDay, string start = "2026-10", int? total = null, bool active = true, int amount = 100) =>
        Bill.Restore(id, "u1", CategoryRef.Of(House), id, amount, dueDay, active, MonthRef.Parse(start), total);

    private static BillPayment Paid(string billId, string month, BillPaymentStatus status = BillPaymentStatus.Paid) =>
        new(billId, MonthRef.Parse(month), status, 100, new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc));

    [Fact]
    public void Cria_na_competencia_atual_com_categoria_de_despesa_mesmo_arquivada()
    {
        var archived = Category.CreateCustom("arq", "u1", "Arquivada", CategoryKind.Expense, null, 0);
        archived.SetArchived(true, DateTime.UtcNow);
        var bill = Bill.Create("b1", "u1", archived, "Aluguel", 100000, 5, 6, October);
        Assert.Equal(("Aluguel", 100000, 5, true, October, (int?)6, "arq"), (bill.Name, bill.AmountCents, bill.DueDay, bill.Active, bill.StartMonth, bill.TotalInstallments, bill.Category.Id));
        Assert.Equal(Bill.ExpenseCategoryMessage, Assert.Throws<BusinessRuleError>(() => Bill.Create("b2", "u1", Salary, "X", 1, 1, null, October)).Message);
    }

    [Fact]
    public void Edicao_troca_categoria_de_despesa_e_campos_mas_nao_o_inicio()
    {
        var bill = NewBill("b1", 5, total: 6);
        Assert.Throws<BusinessRuleError>(() => bill.ChangeCategory(Salary));
        bill.ChangeCategory(Category.CreateSystem("luz", "u1", "Luz", "z", CategoryKind.Expense));
        bill.Update(Patch.Set("Luz"), Patch.Set(200), Patch.Set(31), Patch.Set(false), Patch.Set<int?>(null));
        Assert.Equal(("luz", "Luz", 200, 31, false, (int?)null, October), (bill.Category.Id, bill.Name, bill.AmountCents, bill.DueDay, bill.Active, bill.TotalInstallments, bill.StartMonth));
        bill.Update(default, default, default, default, default);
        Assert.Equal("Luz", bill.Name);
    }

    [Fact]
    public void Parcela_encerramento_e_vencimento()
    {
        var bill = NewBill("b1", 31, start: "2026-10", total: 2);
        Assert.Equal([-1, 1, 2, 3], new[] { "2026-08", "2026-10", "2026-11", "2026-12" }.Select(m => bill.InstallmentNumber(MonthRef.Parse(m)) ?? 0));
        Assert.False(bill.IsFinishedIn(MonthRef.Parse("2026-11")));
        Assert.True(bill.IsFinishedIn(MonthRef.Parse("2026-12")));
        Assert.False(NewBill("b2", 1).IsFinishedIn(MonthRef.Parse("2099-01")));
        Assert.Equal(new DateOnly(2027, 2, 28), bill.DueDate(MonthRef.Parse("2027-02")));
        Assert.Equal(["2026-10", "2026-11"], bill.MonthsBetween(MonthRef.Parse("2026-01"), MonthRef.Parse("2027-06")).Select(m => m.Value));
        Assert.Equal(["2026-11"], bill.MonthsBetween(MonthRef.Parse("2026-11"), MonthRef.Parse("2026-11")).Select(m => m.Value));
    }

    [Fact]
    public void Calendario_com_celulas_vazias_hoje_e_dia_31_sumindo_em_mes_curto()
    {
        // Fevereiro de 2026 começa num domingo; outubro, numa quinta (4 células vazias).
        var calendar = BillsCalendar.Build(October, [(NewBill("a", 1), Paid("a", "2026-10")), (NewBill("b", 5), null), (NewBill("c", 5), Paid("c", "2026-10", BillPaymentStatus.Waived))], new DateOnly(2026, 10, 5));
        Assert.Equal(4 + 31, calendar.Count);
        Assert.All(calendar.Take(4), cell => Assert.Equal(new BillsCalendarDay(null, false, false, false), cell));
        Assert.Equal(new BillsCalendarDay(1, false, true, true), calendar[4]);
        Assert.Equal(new BillsCalendarDay(5, true, true, false), calendar[8]);
        Assert.Equal(new BillsCalendarDay(2, false, false, false), calendar[5]);

        var february = BillsCalendar.Build(MonthRef.Parse("2026-02"), [(NewBill("d", 31), null)], new DateOnly(2026, 10, 5));
        Assert.Equal(28, february.Count);
        Assert.DoesNotContain(february, cell => cell.HasBill || cell.IsToday);
    }

    [Fact]
    public void Portado_nao_marca_como_atrasada_a_conta_que_vence_hoje() =>
        Assert.Empty(BillsCalendar.FindOverdue([NewBill("b1", 10)], [], new DateOnly(2026, 10, 1), "2026-10-10"));

    [Fact]
    public void Atrasadas_acumulam_meses_sem_baixa_a_partir_do_saldo_inicial_na_ordem_de_vencimento()
    {
        var water = NewBill("agua", 10, start: "2026-07");
        var power = NewBill("luz", 28, start: "2026-08", total: 12, amount: 500);
        var overdue = BillsCalendar.FindOverdue(
            [water, power],
            [Paid("agua", "2026-08"), Paid("luz", "2026-09", BillPaymentStatus.Waived)],
            new DateOnly(2026, 7, 15),
            "2026-10-11");

        Assert.Equal(
            [("luz", "2026-08", "2026-08-28", 44, (int?)1), ("agua", "2026-09", "2026-09-10", 31, null), ("agua", "2026-10", "2026-10-10", 1, null)],
            overdue.Select(o => (o.BillId, o.Month.Value, o.DueDate.ToIso(), o.DaysLate, o.InstallmentNumber)));
        Assert.Equal((500, (int?)12, "luz"), (overdue[0].AmountCents, overdue[0].TotalInstallments, overdue[0].Name));
    }

    [Fact]
    public void Hoje_inexistente_compara_o_texto_e_conta_os_dias_pela_data_rolada()
    {
        // "2026-02-31": o mês é fevereiro (texto); 28/02 < "2026-02-31"; atraso até 03/03 = 3 dias.
        var overdue = BillsCalendar.FindOverdue([NewBill("b", 31, start: "2026-02")], [], new DateOnly(2026, 2, 1), "2026-02-31");
        Assert.Equal(("2026-02", "2026-02-28", 3), (overdue.Single().Month.Value, overdue.Single().DueDate.ToIso(), overdue.Single().DaysLate));
        Assert.Throws<ArgumentException>(() => BillsCalendar.FindOverdue([], [], new DateOnly(2026, 2, 1), "2026-00-10"));
    }
}
