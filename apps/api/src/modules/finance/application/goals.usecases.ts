import type { CreateGoalRequest, GoalDTO, UpdateGoalRequest } from '@grana/shared';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { GoalRepository } from '../domain/ports.js';
import { toGoalDTO } from '../infra/finance.mappers.js';

export class ListGoalsUseCase {
  constructor(private readonly goals: GoalRepository) {}

  async execute(userId: string): Promise<GoalDTO[]> {
    return (await this.goals.listByUser(userId)).map(toGoalDTO);
  }
}

export class CreateGoalUseCase {
  constructor(private readonly goals: GoalRepository) {}

  async execute(userId: string, data: CreateGoalRequest): Promise<GoalDTO> {
    const created = await this.goals.create({ userId, ...data });
    // Só uma meta pode ser a "principal" (o card escuro em destaque).
    if (created.featured) await this.goals.clearFeatured(userId, created.id);
    return toGoalDTO(created);
  }
}

export class UpdateGoalUseCase {
  constructor(private readonly goals: GoalRepository) {}

  async execute(userId: string, id: string, data: UpdateGoalRequest): Promise<GoalDTO> {
    const goal = await this.goals.findById(userId, id);
    if (!goal) throw new NotFoundError('Meta');

    const updated = await this.goals.update(userId, id, data);
    if (data.featured === true) await this.goals.clearFeatured(userId, id);
    return toGoalDTO(updated);
  }
}

export class DeleteGoalUseCase {
  constructor(private readonly goals: GoalRepository) {}

  async execute(userId: string, id: string): Promise<void> {
    const goal = await this.goals.findById(userId, id);
    if (!goal) throw new NotFoundError('Meta');
    await this.goals.delete(userId, id);
  }
}

export class AddGoalDepositUseCase {
  constructor(private readonly goals: GoalRepository) {}

  async execute(userId: string, goalId: string, amountCents: number): Promise<GoalDTO> {
    const goal = await this.goals.findById(userId, goalId);
    if (!goal) throw new NotFoundError('Meta');
    return toGoalDTO(await this.goals.addDeposit(userId, goalId, amountCents));
  }
}
