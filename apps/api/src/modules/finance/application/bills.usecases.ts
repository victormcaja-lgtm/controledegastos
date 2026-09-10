import {
  currentMonthRef,
  daysInMonth,
  firstWeekdayOfMonth,
  monthLabel,
  type BillDTO,
  type BillsOverview,
  type CreateBillRequest,
  type MonthRef,
  type UpdateBillRequest,
} from '@grana/shared';
import { BusinessRuleError, NotFoundError } from '../../../shared/domain/errors.js';
import type { BillRepository, CategoryRepository } from '../domain/ports.js';
import { toBillDTO } from '../infra/finance.mappers.js';

export class GetBillsOverviewUseCase {
  constructor(private readonly bills: BillRepository) {}

  async execute(userId: string, month: MonthRef = currentMonthRef()): Promise<BillsOverview> {
    const [records, payments] = await Promise.all([
      this.bills.listAll(userId),
      this.bills.paymentsForMonth(userId, month),
    ]);

    const paymentByBill = new Map(payments.map((payment) => [payment.billId, payment]));
    const dtos: BillDTO[] = records.map((record) =>
      toBillDTO(record, month, paymentByBill.get(record.id)),
    );

    const active = dtos.filter((bill) => bill.active);
    const paidCents = active
      .filter((bill) => bill.paid)
      .reduce((sum, bill) => sum + bill.amountCents, 0);
    const dueCents = active
      .filter((bill) => !bill.paid)
      .reduce((sum, bill) => sum + bill.amountCents, 0);

    return {
      month,
      monthLabel: monthLabel(month),
      bills: dtos,
      paidCents,
      dueCents,
      calendar: buildCalendar(month, active),
    };
  }
}

/** Monta a grade do calendário, incluindo as células vazias antes do dia 1. */
function buildCalendar(month: MonthRef, bills: BillDTO[]) {
  const today = new Date();
  const isCurrentMonth = currentMonthRef(today) === month;
  const total = daysInMonth(month);
  const offset = firstWeekdayOfMonth(month);

  const cells: BillsOverview['calendar'] = Array.from({ length: offset }, () => ({
    day: null,
    isToday: false,
    hasBill: false,
    allPaid: false,
  }));

  for (let day = 1; day <= total; day += 1) {
    const dayBills = bills.filter((bill) => bill.dueDay === day);
    cells.push({
      day,
      isToday: isCurrentMonth && today.getUTCDate() === day,
      hasBill: dayBills.length > 0,
      allPaid: dayBills.length > 0 && dayBills.every((bill) => bill.paid),
    });
  }

  return cells;
}

export class CreateBillUseCase {
  constructor(
    private readonly bills: BillRepository,
    private readonly categories: CategoryRepository,
  ) {}

  async execute(userId: string, data: CreateBillRequest, month: MonthRef): Promise<BillDTO> {
    const category = await this.categories.findById(userId, data.categoryId);
    if (!category) throw new NotFoundError('Categoria');
    if (category.kind !== 'EXPENSE') {
      throw new BusinessRuleError('Contas fixas precisam de uma categoria de despesa.');
    }

    const created = await this.bills.create({
      userId,
      categoryId: data.categoryId,
      name: data.name,
      amountCents: data.amountCents,
      dueDay: data.dueDay,
    });
    return toBillDTO(created, month, undefined);
  }
}

export class UpdateBillUseCase {
  constructor(
    private readonly bills: BillRepository,
    private readonly categories: CategoryRepository,
  ) {}

  async execute(
    userId: string,
    id: string,
    data: UpdateBillRequest,
    month: MonthRef,
  ): Promise<BillDTO> {
    const bill = await this.bills.findById(userId, id);
    if (!bill) throw new NotFoundError('Conta');

    if (data.categoryId) {
      const category = await this.categories.findById(userId, data.categoryId);
      if (!category) throw new NotFoundError('Categoria');
      if (category.kind !== 'EXPENSE') {
        throw new BusinessRuleError('Contas fixas precisam de uma categoria de despesa.');
      }
    }

    const updated = await this.bills.update(userId, id, data);
    const payments = await this.bills.paymentsForMonth(userId, month);
    return toBillDTO(
      updated,
      month,
      payments.find((payment) => payment.billId === id),
    );
  }
}

export class DeleteBillUseCase {
  constructor(private readonly bills: BillRepository) {}

  async execute(userId: string, id: string): Promise<void> {
    const bill = await this.bills.findById(userId, id);
    if (!bill) throw new NotFoundError('Conta');
    await this.bills.delete(userId, id);
  }
}

/**
 * Dar baixa numa conta fixa é por competência, não por conta.
 * "Aluguel de setembro pago" não diz nada sobre outubro.
 */
export class SetBillPaymentUseCase {
  constructor(private readonly bills: BillRepository) {}

  async execute(
    userId: string,
    billId: string,
    input: { month: MonthRef; paid: boolean },
  ): Promise<BillDTO> {
    const bill = await this.bills.findById(userId, billId);
    if (!bill) throw new NotFoundError('Conta');

    if (input.paid) {
      await this.bills.markPaid({
        userId,
        billId,
        month: input.month,
        amountCents: bill.amountCents,
      });
    } else {
      await this.bills.markUnpaid(userId, billId, input.month);
    }

    const payments = await this.bills.paymentsForMonth(userId, input.month);
    return toBillDTO(
      bill,
      input.month,
      payments.find((payment) => payment.billId === billId),
    );
  }
}
