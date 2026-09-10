import type { PrismaClient } from '../../../shared/infra/database/client.js';
import type { AuditLogger } from '../domain/ports.js';

/**
 * A auditoria nunca pode derrubar a operação principal: se gravar o log falhar,
 * o erro é registrado e engolido. Perder uma linha de auditoria é ruim; perder
 * o pagamento que o usuário acabou de registrar é pior.
 */
export class PrismaAuditLogger implements AuditLogger {
  constructor(
    private readonly db: PrismaClient,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  async record(params: {
    action: string;
    targetType: string;
    targetId?: string | null;
    actorId?: string | null;
    actorEmail?: string | null;
    ip?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      await this.db.auditLog.create({
        data: {
          action: params.action,
          targetType: params.targetType,
          targetId: params.targetId ?? null,
          actorId: params.actorId ?? null,
          actorEmail: params.actorEmail ?? null,
          ip: params.ip?.slice(0, 64) ?? null,
          metadata: (params.metadata ?? undefined) as never,
        },
      });
    } catch (error) {
      this.onError(error);
    }
  }
}
