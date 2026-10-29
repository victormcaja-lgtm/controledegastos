using Grana.Application.Common;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Finance;

public interface IBillRepository
{
    /// <summary>Todas, inclusive inativas, na ordem <c>active desc, dueDay asc</c> (RN-096).</summary>
    Task<IReadOnlyList<Bill>> ListAllAsync(string userId, CancellationToken cancellationToken);

    /// <summary>Só as ativas, por <c>dueDay asc</c> (saldo futuro e atrasadas).</summary>
    Task<IReadOnlyList<Bill>> ListActiveAsync(string userId, CancellationToken cancellationToken);

    Task<Bill?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken);

    Task AddAsync(Bill bill, DateTime nowUtc, CancellationToken cancellationToken);

    Task UpdateAsync(Bill bill, DateTime nowUtc, CancellationToken cancellationToken);

    /// <summary>As baixas vão junto, em cascata (RN-092).</summary>
    Task DeleteAsync(string userId, string id, CancellationToken cancellationToken);

    Task<IReadOnlyList<BillPayment>> PaymentsForMonthAsync(string userId, MonthRef month, CancellationToken cancellationToken);

    Task<IReadOnlyList<BillPayment>> PaymentsSinceAsync(string userId, MonthRef month, CancellationToken cancellationToken);

    /// <summary>Upsert por (conta, competência): refazer atualiza valor, status e <c>paidAt = agora</c> (RN-094).</summary>
    Task MarkPaidAsync(string userId, string billId, MonthRef month, int amountCents, BillPaymentStatus status, string newPaymentId, DateTime nowUtc, CancellationToken cancellationToken);

    Task MarkUnpaidAsync(string userId, string billId, MonthRef month, CancellationToken cancellationToken);
}

/// <summary>Conta fixa numa competência (<c>toBillDTO</c>).</summary>
public sealed record BillDto(
    string Id, string Name, int AmountCents, int DueDay, bool Active, CategoryRefDto Category,
    bool Paid, bool Waived, DateTime? PaidAt, DateOnly DueDate, int? TotalInstallments, int? InstallmentNumber)
{
    /// <summary><c>paidAt</c> só existe quando a baixa é PAID.</summary>
    public static BillDto From(Bill bill, MonthRef month, BillPayment? payment)
    {
        ArgumentNullException.ThrowIfNull(bill);
        var category = bill.Category;
        var paid = payment?.Status == BillPaymentStatus.Paid;
        return new(bill.Id, bill.Name, bill.AmountCents, bill.DueDay, bill.Active,
            new CategoryRefDto(category.Id, category.Name, category.Color, CategoryDto.KindName(category.Kind)),
            paid, payment?.Status == BillPaymentStatus.Waived, paid ? payment!.PaidAt : null,
            bill.DueDate(month), bill.TotalInstallments, bill.InstallmentNumber(month));
    }

    /// <summary>Competência sem baixa: nem paga, nem dispensada.</summary>
    public static BillDto Unpaid(Bill bill, MonthRef month) => From(bill, month, null);
}

public sealed record BillsCalendarDayDto(int? Day, bool IsToday, bool HasBill, bool AllPaid);

public sealed record BillsOverviewDto(
    string Month, string MonthLabel, IReadOnlyList<BillDto> Bills, long PaidCents, long DueCents, IReadOnlyList<BillsCalendarDayDto> Calendar);

public sealed record OverdueBillDto(
    string BillId, string Name, string Month, DateOnly DueDate, int AmountCents, int DaysLate, int? InstallmentNumber, int? TotalInstallments);

public sealed record CreateBillCommand(string Name, string CategoryId, int AmountCents, int DueDay, int? TotalInstallments);

public sealed record UpdateBillCommand(
    Patch<string> Name, Patch<string> CategoryId, Patch<int> AmountCents, Patch<int> DueDay, Patch<bool> Active, Patch<int?> TotalInstallments);

public sealed record SetBillPaymentCommand(MonthRef Month, bool Paid, bool? Waived, int? AmountCents);

/// <summary>Contas fixas — <c>bills.usecases.ts</c> e <c>GetOverdueBillsUseCase</c> (RN-090–101).</summary>
public sealed class BillUseCases(IBillRepository bills, ICategoryRepository categories, IUserSettingsRepository settings, IClock clock, IIdGenerator ids)
{
    private MonthRef CurrentMonth => MonthRef.Of(DateOnly.FromDateTime(clock.UtcNow));

    /// <summary>
    /// Visão da competência (padrão: a atual em UTC): todas as contas menos as encerradas;
    /// ⚠️ as criadas DEPOIS aparecem com parcela ≤ 0 (RN-097). Somas e calendário só com as ativas.
    /// </summary>
    public async Task<BillsOverviewDto> OverviewAsync(Actor actor, MonthRef? requested, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var month = requested ?? CurrentMonth;
        var all = await bills.ListAllAsync(actor.UserId, cancellationToken).ConfigureAwait(false);
        var payments = await bills.PaymentsForMonthAsync(actor.UserId, month, cancellationToken).ConfigureAwait(false);
        var paymentByBill = payments.ToDictionary(payment => payment.BillId);

        var visible = all.Where(bill => !bill.IsFinishedIn(month))
            .Select(bill => (Bill: bill, Payment: paymentByBill.GetValueOrDefault(bill.Id)))
            .ToList();
        var active = visible.Where(entry => entry.Bill.Active).ToList();

        // ⚠️ "Pago" soma o valor da conta, não o efetivamente pago (RN-098).
        var paidCents = active.Where(entry => entry.Payment?.Status == BillPaymentStatus.Paid).Sum(entry => (long)entry.Bill.AmountCents);
        var dueCents = active.Where(entry => entry.Payment is null).Sum(entry => (long)entry.Bill.AmountCents);
        var calendar = BillsCalendar.Build(month, active, DateOnly.FromDateTime(clock.UtcNow));

        return new BillsOverviewDto(
            month.Value,
            month.Label,
            [.. visible.Select(entry => BillDto.From(entry.Bill, month, entry.Payment))],
            paidCents,
            dueCents,
            [.. calendar.Select(cell => new BillsCalendarDayDto(cell.Day, cell.IsToday, cell.HasBill, cell.AllPaid))]);
    }

    /// <summary>
    /// Atrasadas (RN-101). Saldo futuro sem data inicial → nada. O Node carrega o saldo
    /// futuro inteiro aqui; o que entra no resultado é só data inicial, contas ativas e baixas.
    /// </summary>
    /// <param name="requestedToday"><c>?today=</c> como texto (ver <see cref="BillsCalendar.FindOverdue"/>); padrão: hoje em UTC.</param>
    public async Task<IReadOnlyList<OverdueBillDto>> OverdueAsync(Actor actor, string? requestedToday, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        var today = requestedToday ?? DateOnly.FromDateTime(clock.UtcNow).ToIso();
        var found = await settings.FindAsync(actor.UserId, cancellationToken).ConfigureAwait(false);
        if (found?.OpeningDate is not { } openingDate) return [];

        // O carregador do Node consulta lançamentos até o dia 1 de (mês de hoje + 14). Perto do
        // ano 9999 essa data não existe, o Date do JS fica inválido e o Prisma falha: 500.
        if (MonthRef.Parse(today[..7]).AddMonths(14).Year > 9999)
        {
            throw new InvalidOperationException("Data limite do saldo futuro fora do alcance do Date do JavaScript.");
        }

        var active = await bills.ListActiveAsync(actor.UserId, cancellationToken).ConfigureAwait(false);
        var payments = await bills.PaymentsSinceAsync(actor.UserId, MonthRef.Of(openingDate), cancellationToken).ConfigureAwait(false);
        return [.. BillsCalendar.FindOverdue(active, payments, openingDate, today)
            .Select(bill => new OverdueBillDto(bill.BillId, bill.Name, bill.Month.Value, bill.DueDate, bill.AmountCents, bill.DaysLate, bill.InstallmentNumber, bill.TotalInstallments))];
    }

    public async Task<BillDto> CreateAsync(Actor actor, CreateBillCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var category = await categories.FindByIdAsync(actor.UserId, command.CategoryId, cancellationToken).ConfigureAwait(false)
            ?? throw new NotFoundError("Categoria");
        var month = CurrentMonth;
        var bill = Bill.Create(ids.NewId(), actor.UserId, category, command.Name, command.AmountCents, command.DueDay, command.TotalInstallments, month);
        await bills.AddAsync(bill, clock.UtcNow, cancellationToken).ConfigureAwait(false);
        return BillDto.Unpaid(bill, month);
    }

    /// <summary>Responde o DTO da competência pedida (padrão: a atual), com a baixa dela.</summary>
    public async Task<BillDto> UpdateAsync(Actor actor, string id, UpdateBillCommand command, MonthRef? requested, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var bill = await bills.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Conta");
        if (command.CategoryId.IsSet)
        {
            var category = await categories.FindByIdAsync(actor.UserId, command.CategoryId.Value, cancellationToken).ConfigureAwait(false)
                ?? throw new NotFoundError("Categoria");
            bill.ChangeCategory(category);
        }

        bill.Update(command.Name, command.AmountCents, command.DueDay, command.Active, command.TotalInstallments);
        await bills.UpdateAsync(bill, clock.UtcNow, cancellationToken).ConfigureAwait(false);

        var month = requested ?? CurrentMonth;
        var payments = await bills.PaymentsForMonthAsync(actor.UserId, month, cancellationToken).ConfigureAwait(false);
        return BillDto.From(bill, month, payments.FirstOrDefault(payment => payment.BillId == id));
    }

    public async Task DeleteAsync(Actor actor, string id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        _ = await bills.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Conta");
        await bills.DeleteAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Baixa por competência (RN-094): <c>waived</c> grava a dispensa com o valor da conta
    /// e ignora <c>paid</c>; <c>paid</c> grava o pagamento (valor informado ou o da conta);
    /// senão, desfaz. ⚠️ Não confere a vigência nem se a conta está ativa (RN-095).
    /// </summary>
    public async Task<BillDto> SetPaymentAsync(Actor actor, string id, SetBillPaymentCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(command);
        var bill = await bills.FindByIdAsync(actor.UserId, id, cancellationToken).ConfigureAwait(false) ?? throw new NotFoundError("Conta");
        if (command.Waived == true)
        {
            await bills.MarkPaidAsync(actor.UserId, id, command.Month, bill.AmountCents, BillPaymentStatus.Waived, ids.NewId(), clock.UtcNow, cancellationToken).ConfigureAwait(false);
        }
        else if (command.Paid)
        {
            await bills.MarkPaidAsync(actor.UserId, id, command.Month, command.AmountCents ?? bill.AmountCents, BillPaymentStatus.Paid, ids.NewId(), clock.UtcNow, cancellationToken).ConfigureAwait(false);
        }
        else
        {
            await bills.MarkUnpaidAsync(actor.UserId, id, command.Month, cancellationToken).ConfigureAwait(false);
        }

        var payments = await bills.PaymentsForMonthAsync(actor.UserId, command.Month, cancellationToken).ConfigureAwait(false);
        return BillDto.From(bill, command.Month, payments.FirstOrDefault(payment => payment.BillId == id));
    }
}
