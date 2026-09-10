import {
  currentMonthRef,
  type CreateDebtRequest,
  type DebtDTO,
  type DebtOverview,
  type UpdateDebtRequest,
} from '@grana/shared';
import { BusinessRuleError, NotFoundError } from '../../../shared/domain/errors.js';
import type { DebtRepository } from '../domain/ports.js';
import { projectDebts } from '../domain/budget.calculator.js';
import { toDebtDTO } from '../infra/finance.mappers.js';

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
