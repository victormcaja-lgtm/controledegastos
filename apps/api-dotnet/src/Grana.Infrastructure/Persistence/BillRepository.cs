using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;
using Microsoft.EntityFrameworkCore;

namespace Grana.Infrastructure.Persistence;

/// <summary>Contas fixas e baixas — <c>PrismaBillRepository</c>.</summary>
public sealed class EfBillRepository(GranaDbContext db) : IBillRepository
{
    private IQueryable<BillRow> Bills => db.Bills.AsNoTracking().Include(b => b.Category);

    public async Task<IReadOnlyList<Bill>> ListAllAsync(string userId, CancellationToken cancellationToken)
    {
        var rows = await Bills.Where(b => b.UserId == userId).OrderByDescending(b => b.Active).ThenBy(b => b.DueDay)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(ToDomain)];
    }

    public async Task<IReadOnlyList<Bill>> ListActiveAsync(string userId, CancellationToken cancellationToken)
    {
        var rows = await Bills.Where(b => b.UserId == userId && b.Active).OrderBy(b => b.DueDay)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(ToDomain)];
    }

    public async Task<Bill?> FindByIdAsync(string userId, string id, CancellationToken cancellationToken)
    {
        var row = await Bills.FirstOrDefaultAsync(b => b.Id == id && b.UserId == userId, cancellationToken).ConfigureAwait(false);
        return row is null ? null : ToDomain(row);
    }

    public async Task AddAsync(Bill bill, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(bill);
        db.Bills.Add(new BillRow
        {
            Id = bill.Id,
            UserId = bill.UserId,
            CategoryId = bill.Category.Id,
            Name = bill.Name,
            AmountCents = bill.AmountCents,
            DueDay = bill.DueDay,
            Active = bill.Active,
            StartMonth = bill.StartMonth.Start,
            TotalInstallments = bill.TotalInstallments,
            CreatedAt = nowUtc,
            UpdatedAt = nowUtc,
        });
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdateAsync(Bill bill, DateTime nowUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(bill);
        var row = await db.Bills.FirstAsync(b => b.Id == bill.Id && b.UserId == bill.UserId, cancellationToken).ConfigureAwait(false);
        row.CategoryId = bill.Category.Id;
        row.Name = bill.Name;
        row.AmountCents = bill.AmountCents;
        row.DueDay = bill.DueDay;
        row.Active = bill.Active;
        row.TotalInstallments = bill.TotalInstallments;
        row.UpdatedAt = nowUtc;
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public Task DeleteAsync(string userId, string id, CancellationToken cancellationToken) =>
        db.Bills.Where(b => b.Id == id && b.UserId == userId).ExecuteDeleteAsync(cancellationToken);

    public async Task<IReadOnlyList<BillPayment>> PaymentsForMonthAsync(string userId, MonthRef month, CancellationToken cancellationToken)
    {
        var start = month.Start;
        var rows = await db.BillPayments.AsNoTracking().Where(p => p.UserId == userId && p.ReferenceMonth == start)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(ToDomain)];
    }

    public async Task<IReadOnlyList<BillPayment>> PaymentsSinceAsync(string userId, MonthRef month, CancellationToken cancellationToken)
    {
        var start = month.Start;
        var rows = await db.BillPayments.AsNoTracking().Where(p => p.UserId == userId && p.ReferenceMonth >= start)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(ToDomain)];
    }

    public async Task MarkPaidAsync(
        string userId, string billId, MonthRef month, int amountCents, BillPaymentStatus status, string newPaymentId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var start = month.Start;
        var statusDb = status == BillPaymentStatus.Waived ? BillPaymentStatusDb.WAIVED : BillPaymentStatusDb.PAID;
        // Upsert pela chave única (billId, referenceMonth): clicar duas vezes não duplica a baixa.
        var row = await db.BillPayments.FirstOrDefaultAsync(p => p.BillId == billId && p.ReferenceMonth == start, cancellationToken).ConfigureAwait(false);
        if (row is null)
        {
            db.BillPayments.Add(new BillPaymentRow
            {
                Id = newPaymentId,
                BillId = billId,
                UserId = userId,
                ReferenceMonth = start,
                AmountCents = amountCents,
                PaidAt = nowUtc,
                Status = statusDb,
            });
        }
        else
        {
            row.AmountCents = amountCents;
            row.PaidAt = nowUtc;
            row.Status = statusDb;
        }

        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public Task MarkUnpaidAsync(string userId, string billId, MonthRef month, CancellationToken cancellationToken)
    {
        var start = month.Start;
        return db.BillPayments.Where(p => p.UserId == userId && p.BillId == billId && p.ReferenceMonth == start).ExecuteDeleteAsync(cancellationToken);
    }

    public static Bill ToDomain(BillRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        var category = row.Category ?? throw new InvalidOperationException($"Conta {row.Id} sem categoria carregada.");
        return Bill.Restore(row.Id, row.UserId,
            new CategoryRef(category.Id, category.Name, category.Color, category.Kind == CategoryKindDb.INCOME ? CategoryKind.Income : CategoryKind.Expense),
            row.Name, row.AmountCents, row.DueDay, row.Active, MonthRef.Of(row.StartMonth), row.TotalInstallments);
    }

    private static BillPayment ToDomain(BillPaymentRow row) =>
        new(row.BillId, MonthRef.Of(row.ReferenceMonth), row.Status == BillPaymentStatusDb.WAIVED ? BillPaymentStatus.Waived : BillPaymentStatus.Paid, row.AmountCents, row.PaidAt);
}
