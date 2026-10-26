using Grana.Application.Common;
using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Tests.Finance;

/// <summary>bills.usecases.ts e GetOverdueBillsUseCase — RN-090–101.</summary>
public class BillUseCasesTests
{
    private static readonly DateTime Now = new(2026, 10, 5, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Actor Ana = new("u1", "ana@grana.app", "USER");
    private static readonly MonthRef October = MonthRef.Parse("2026-10");

    private readonly InMemoryCategories _categories = new();
    private readonly InMemoryBills _bills = new();
    private readonly InMemorySettings _settings = new();
    private readonly FixedClock _clock = new(Now);
    private readonly BillUseCases _useCases;

    public BillUseCasesTests()
    {
        _useCases = new BillUseCases(_bills, _categories, _settings, _clock, new SequentialIds());
        _categories.Items.Add(Category.CreateSystem("casa", "u1", "Casa", "x", CategoryKind.Expense));
        _categories.Items.Add(Category.CreateSystem("luz", "u1", "Luz", "z", CategoryKind.Expense));
        _categories.Items.Add(Category.CreateSystem("salario", "u1", "Salário", "y", CategoryKind.Income));
    }

    private Task<BillDto> Create(string name, int dueDay, int amount = 100, int? total = null, string category = "casa") =>
        _useCases.CreateAsync(Ana, new CreateBillCommand(name, category, amount, dueDay, total), CancellationToken.None);

    [Fact]
    public async Task Cria_na_competencia_atual_e_recusa_categoria_ausente_ou_de_entrada()
    {
        var created = await Create("Aluguel", 31, 100000, 6);
        Assert.Equal(new BillDto("id-1", "Aluguel", 100000, 31, true, new CategoryRefDto("casa", "Casa", "x", "EXPENSE"), false, false, null, new DateOnly(2026, 10, 31), 6, 1), created);
        Assert.Equal(October, _bills.Items.Single().StartMonth);
        await Assert.ThrowsAsync<NotFoundError>(() => Create("X", 1, category: "nada"));
        await Assert.ThrowsAsync<BusinessRuleError>(() => Create("X", 1, category: "salario"));
    }

    [Fact]
    public async Task Visao_do_mes_ordem_somas_calendario_e_encerradas()
    {
        var rent = await Create("Aluguel", 5, 100000);
        var tv = await Create("TV", 1, 5000, total: 1);
        var gym = await Create("Academia", 2, 9000);
        var power = await Create("Luz", 5, 10000);
        await _useCases.UpdateAsync(Ana, gym.Id, new UpdateBillCommand(default, default, default, default, Patch.Set(false), default), null, CancellationToken.None);
        await _useCases.SetPaymentAsync(Ana, rent.Id, new SetBillPaymentCommand(October, true, null, 101500), CancellationToken.None);
        await _useCases.SetPaymentAsync(Ana, tv.Id, new SetBillPaymentCommand(October, false, true, null), CancellationToken.None);

        var overview = await _useCases.OverviewAsync(Ana, null, CancellationToken.None);
        Assert.Equal(("2026-10", "Outubro 2026"), (overview.Month, overview.MonthLabel));
        Assert.Equal(["TV", "Aluguel", "Luz", "Academia"], overview.Bills.Select(b => b.Name));
        Assert.Equal((100000L, 10000L), (overview.PaidCents, overview.DueCents));
        Assert.Equal(Now, overview.Bills[1].PaidAt);
        Assert.Null(overview.Bills[0].PaidAt);
        Assert.Equal(4 + 31, overview.Calendar.Count);
        Assert.Equal(new BillsCalendarDayDto(5, true, true, false), overview.Calendar[8]);
        Assert.Equal(new BillsCalendarDayDto(2, false, false, false), overview.Calendar[5]);

        var november = await _useCases.OverviewAsync(Ana, MonthRef.Parse("2026-11"), CancellationToken.None);
        Assert.DoesNotContain(november.Bills, b => b.Name == "TV");
        Assert.DoesNotContain(november.Calendar, cell => cell.IsToday);
        Assert.Equal(-1, (await _useCases.OverviewAsync(Ana, MonthRef.Parse("2026-08"), CancellationToken.None)).Bills.Single(b => b.Name == "TV").InstallmentNumber);
        _ = power;
    }

    [Fact]
    public async Task Editar_responde_o_mes_pedido_com_a_baixa_dele()
    {
        var bill = await Create("Aluguel", 5);
        await _useCases.SetPaymentAsync(Ana, bill.Id, new SetBillPaymentCommand(MonthRef.Parse("2026-09"), true, null, null), CancellationToken.None);
        var september = await _useCases.UpdateAsync(
            Ana, bill.Id, new UpdateBillCommand(Patch.Set("Casa"), Patch.Set("luz"), Patch.Set(7), Patch.Set(6), default, Patch.Set<int?>(12)), MonthRef.Parse("2026-09"), CancellationToken.None);
        Assert.Equal(("Casa", "luz", 7, true, 0, new DateOnly(2026, 9, 6)), (september.Name, september.Category.Id, september.AmountCents, september.Paid, september.InstallmentNumber, september.DueDate));

        await Assert.ThrowsAsync<NotFoundError>(() => _useCases.UpdateAsync(Ana, "nada", new UpdateBillCommand(Patch.Set("x"), default, default, default, default, default), null, CancellationToken.None));
        await Assert.ThrowsAsync<NotFoundError>(() => _useCases.UpdateAsync(Ana, bill.Id, new UpdateBillCommand(default, Patch.Set("nada"), default, default, default, default), null, CancellationToken.None));
        await Assert.ThrowsAsync<BusinessRuleError>(() => _useCases.UpdateAsync(Ana, bill.Id, new UpdateBillCommand(default, Patch.Set("salario"), default, default, default, default), null, CancellationToken.None));
    }

    [Fact]
    public async Task Baixa_paga_refaz_dispensa_e_desfaz()
    {
        var bill = await Create("Aluguel", 5, 20000);
        var paid = await _useCases.SetPaymentAsync(Ana, bill.Id, new SetBillPaymentCommand(October, true, false, null), CancellationToken.None);
        Assert.Equal((true, false, (DateTime?)Now, 20000), (paid.Paid, paid.Waived, paid.PaidAt, _bills.Payments.Single().Payment.AmountCents));

        _clock.UtcNow = Now.AddHours(1);
        await _useCases.SetPaymentAsync(Ana, bill.Id, new SetBillPaymentCommand(October, true, null, 21500), CancellationToken.None);
        Assert.Equal((21500, Now.AddHours(1)), (_bills.Payments.Single().Payment.AmountCents, _bills.Payments.Single().Payment.PaidAt));

        var waived = await _useCases.SetPaymentAsync(Ana, bill.Id, new SetBillPaymentCommand(October, true, true, 99), CancellationToken.None);
        Assert.Equal((false, true, (DateTime?)null, 20000), (waived.Paid, waived.Waived, waived.PaidAt, _bills.Payments.Single().Payment.AmountCents));

        var undone = await _useCases.SetPaymentAsync(Ana, bill.Id, new SetBillPaymentCommand(October, false, false, null), CancellationToken.None);
        Assert.Equal((false, false), (undone.Paid, undone.Waived));
        Assert.Empty(_bills.Payments);
        await Assert.ThrowsAsync<NotFoundError>(() => _useCases.SetPaymentAsync(Ana, "nada", new SetBillPaymentCommand(October, false, null, null), CancellationToken.None));
    }

    [Fact]
    public async Task Exclui_e_depois_404_no_masculino()
    {
        var bill = await Create("Aluguel", 5);
        await _useCases.DeleteAsync(Ana, bill.Id, CancellationToken.None);
        Assert.Equal("Conta não encontrado.", (await Assert.ThrowsAsync<NotFoundError>(() => _useCases.DeleteAsync(Ana, bill.Id, CancellationToken.None))).Message);
    }

    [Fact]
    public async Task Atrasadas_sem_saldo_inicial_vazias_e_com_ele_calculadas()
    {
        var water = await Create("Água", 1);
        Assert.Empty(await _useCases.OverdueAsync(Ana, null, CancellationToken.None));

        var settings = UserSettings.Defaults("u1");
        settings.Apply(new SettingsPatch { OpeningDate = Patch.Set<string?>("2026-10-01") }, Now);
        _settings.Rows["u1"] = settings;
        Assert.Equal([("Água", "2026-10", 4)], (await _useCases.OverdueAsync(Ana, null, CancellationToken.None)).Select(o => (o.Name, o.Month, o.DaysLate)));
        Assert.Empty(await _useCases.OverdueAsync(Ana, "2026-10-01", CancellationToken.None));
        await Assert.ThrowsAsync<InvalidOperationException>(() => _useCases.OverdueAsync(Ana, "9998-11-01", CancellationToken.None));
        Assert.NotEmpty(await _useCases.OverdueAsync(Ana, "9998-10-02", CancellationToken.None));
        _ = water;
    }
}
