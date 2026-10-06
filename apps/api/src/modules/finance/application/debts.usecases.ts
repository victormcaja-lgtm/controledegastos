import {
  currentMonthRef,
  type BillDTO,
  type ConvertDebtRequest,
  type CreateDebtRequest,
  type DebtDTO,
  type DebtOverview,
  type UpdateDebtRequest,
} from '@grana/shared';
import { BusinessRuleError, NotFoundError } from '../../../shared/domain/errors.js';
import type { BillRepository, CategoryRepository, DebtRepository } from '../domain/ports.js';
import { projectDebts } from '../domain/budget.calculator.js';
import { toBillDTO, toDebtDTO } from '../infra/finance.mappers.js';

export class GetDebtOverviewUseCase {
  constructor(private readonly debts: DebtRepository) {}

  async execute(userId: string): Promise<DebtOverview> {
    const records = await this.debts.listByUser(userId);
    const projection = projectDebts(records, currentMonthRef());

    return {
      debts: records.map(toDebtDTO),
      monthlyTotalCents: projection.monthlyTotalCents,
      projection: projection.months.map((entry) => ({
        month: entry.month,
        label: entry.label,
        totalCents: entry.totalCents,
      })),
      note: projection.note,
    };
  }
}

export class CreateDebtUseCase {
  constructor(private readonly debts: DebtRepository) {}

  async execute(userId: string, data: CreateDebtRequest): Promise<DebtDTO> {
    return toDebtDTO(await this.debts.create({ userId, ...data }));
  }
}

export class UpdateDebtUseCase {
  constructor(private readonly debts: DebtRepository) {}

  async execute(userId: string, id: string, data: UpdateDebtRequest): Promise<DebtDTO> {
    const debt = await this.debts.findById(userId, id);
    if (!debt) throw new NotFoundError('Dívida');

    const paid = data.paidInstallments ?? debt.paidInstallments;
    const total = data.totalInstallments ?? debt.totalInstallments;
    if (paid > total) {
      throw new BusinessRuleError('As parcelas pagas não podem passar do total de parcelas.');
    }

    return toDebtDTO(await this.debts.update(userId, id, data));
  }
}

export class DeleteDebtUseCase {
  constructor(private readonly debts: DebtRepository) {}

  async execute(userId: string, id: string): Promise<void> {
    const debt = await this.debts.findById(userId, id);
    if (!debt) throw new NotFoundError('Dívida');
    await this.debts.delete(userId, id);
  }
}

/**
 * Uma dívida parcelada é, na prática, uma conta fixa com prazo. Converter leva
 * as parcelas que faltam para Contas — e daí para o saldo futuro, com aviso de
 * atraso e tudo. A dívida original é removida.
 */
export class ConvertDebtToBillUseCase {
  constructor(
    private readonly debts: DebtRepository,
    private readonly bills: BillRepository,
    private readonly categories: CategoryRepository,
  ) {}

  async execute(userId: string, id: string, data: ConvertDebtRequest): Promise<BillDTO> {
    const debt = await this.debts.findById(userId, id);
    if (!debt) throw new NotFoundError('Dívida');

    const remaining = debt.totalInstallments - debt.paidInstallments;
    if (remaining <= 0) throw new BusinessRuleError('Esta dívida já está quitada.');

    const category = await this.categories.findById(userId, data.categoryId);
    if (!category) throw new NotFoundError('Categoria');
    if (category.kind !== 'EXPENSE') {
      throw new BusinessRuleError('Contas fixas precisam de uma categoria de despesa.');
    }

    const month = currentMonthRef();
    const bill = await this.bills.create({
      userId,
      categoryId: data.categoryId,
      name: debt.name,
      amountCents: debt.installmentCents,
      dueDay: data.dueDay,
      startMonth: month,
      totalInstallments: remaining,
    });
    await this.debts.delete(userId, id);
    return toBillDTO(bill, month, undefined);
  }
}
