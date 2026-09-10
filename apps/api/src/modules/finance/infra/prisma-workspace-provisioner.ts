import type { PrismaClient } from '../../../shared/infra/database/client.js';
import type { UserWorkspaceProvisioner } from '../../identity/domain/ports.js';
import { DEFAULT_CATEGORIES } from '../domain/default-categories.js';

/**
 * Implementa a porta que Identidade declarou. É aqui que o contexto de Finanças
 * responde ao evento "um usuário foi criado" — sem que o módulo de usuários
 * precise saber o que é uma categoria.
 */
export class PrismaWorkspaceProvisioner implements UserWorkspaceProvisioner {
  constructor(private readonly db: PrismaClient) {}

  async provision(userId: string, options: { withDefaultCategories: boolean }): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.userSettings.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });

      if (!options.withDefaultCategories) return;

      await tx.category.createMany({
        data: DEFAULT_CATEGORIES.map((category) => ({
          userId,
          name: category.name,
          color: category.color,
          kind: category.kind,
          isSystem: true,
        })),
        skipDuplicates: true,
      });
    });
  }
}
