import type { CategoryDTO, CreateCategoryRequest, UpdateCategoryRequest } from '@grana/shared';
import { colorForIndex } from '@grana/shared';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { CategoryRepository } from '../domain/ports.js';
import { toCategoryDTO } from '../infra/finance.mappers.js';

export class ListCategoriesUseCase {
  constructor(private readonly categories: CategoryRepository) {}

  async execute(userId: string, includeArchived = false): Promise<CategoryDTO[]> {
    const records = await this.categories.listByUser(userId, { includeArchived });
    return records.map(toCategoryDTO);
  }
}

export class CreateCategoryUseCase {
  constructor(private readonly categories: CategoryRepository) {}

  async execute(userId: string, data: CreateCategoryRequest): Promise<CategoryDTO> {
    const existing = await this.categories.findByName(userId, data.name, data.kind);
    if (existing) throw new ConflictError('Você já tem uma categoria com esse nome.');

    const total = (await this.categories.listByUser(userId, { includeArchived: true })).length;
    const created = await this.categories.create({
      userId,
      name: data.name,
      kind: data.kind,
      color: data.color ?? colorForIndex(total),
    });
    return toCategoryDTO(created);
  }
}

export class UpdateCategoryUseCase {
  constructor(private readonly categories: CategoryRepository) {}

  async execute(userId: string, id: string, data: UpdateCategoryRequest): Promise<CategoryDTO> {
    const category = await this.categories.findById(userId, id);
    if (!category) throw new NotFoundError('Categoria');

    if (data.name && data.name.toLowerCase() !== category.name.toLowerCase()) {
      const clash = await this.categories.findByName(userId, data.name, category.kind);
      if (clash) throw new ConflictError('Você já tem uma categoria com esse nome.');
    }

    const updated = await this.categories.update(userId, id, {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.archived !== undefined ? { archivedAt: data.archived ? new Date() : null } : {}),
    });
    return toCategoryDTO(updated);
  }
}

/**
 * Excluir categoria é a operação mais perigosa deste módulo: se ela estiver em
 * uso, apagar quebraria lançamentos históricos. A regra é: em uso → arquive.
 */
export class DeleteCategoryUseCase {
  constructor(private readonly categories: CategoryRepository) {}

  async execute(userId: string, id: string): Promise<void> {
    const category = await this.categories.findById(userId, id);
    if (!category) throw new NotFoundError('Categoria');

    const usages = await this.categories.countUsages(userId, id);
    if (usages > 0) {
      throw new BusinessRuleError(
        `Esta categoria está em ${usages} registro(s). Arquive-a em vez de excluir.`,
      );
    }
    if (category.isSystem) {
      throw new BusinessRuleError('Categorias padrão não podem ser excluídas — apenas arquivadas.');
    }

    await this.categories.delete(userId, id);
  }
}
