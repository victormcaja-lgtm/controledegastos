import type { CreateIncomeRequest, IncomeDTO, UpdateIncomeRequest } from '@grana/shared';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { IncomeRepository } from '../domain/ports.js';
import { toIncomeDTO } from '../infra/finance.mappers.js';

export class ListIncomesUseCase {
  constructor(private readonly incomes: IncomeRepository) {}

  async execute(userId: string): Promise<IncomeDTO[]> {
    return (await this.incomes.listAll(userId)).map(toIncomeDTO);
  }
}

export class CreateIncomeUseCase {
  constructor(private readonly incomes: IncomeRepository) {}

  async execute(userId: string, data: CreateIncomeRequest): Promise<IncomeDTO> {
    return toIncomeDTO(await this.incomes.create({ userId, ...data }));
  }
}

export class UpdateIncomeUseCase {
  constructor(private readonly incomes: IncomeRepository) {}

  async execute(userId: string, id: string, data: UpdateIncomeRequest): Promise<IncomeDTO> {
    const income = await this.incomes.findById(userId, id);
    if (!income) throw new NotFoundError('Entrada');
    return toIncomeDTO(await this.incomes.update(userId, id, data));
  }
}

export class DeleteIncomeUseCase {
  constructor(private readonly incomes: IncomeRepository) {}

  async execute(userId: string, id: string): Promise<void> {
    const income = await this.incomes.findById(userId, id);
    if (!income) throw new NotFoundError('Entrada');
    await this.incomes.delete(userId, id);
  }
}
