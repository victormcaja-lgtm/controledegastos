import {
  MONTH_NAMES_LONG,
  formatMoney,
  monthRefFromISODate,
  type CreateTransactionRequest,
  type ListTransactionsQuery,
  type TransactionDayGroup,
  type TransactionDTO,
  type UpdateTransactionRequest,
} from '@grana/shared';
import { BusinessRuleError, NotFoundError } from '../../../shared/domain/errors.js';
import type { CategoryRepository, TransactionRepository } from '../domain/ports.js';
import { toISODate, toTransactionDTO } from '../infra/finance.mappers.js';

export interface ListTransactionsResult {
  items: TransactionDTO[];
  groups: TransactionDayGroup[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  summary: string;
}

/** Converte `YYYY-MM-DD` para um Date em UTC — sem deslocamento de fuso. */
function parseISODate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export class ListTransactionsUseCase {
  constructor(private readonly transactions: TransactionRepository) {}

  async execute(userId: string, query: ListTransactionsQuery): Promise<ListTransactionsResult> {
    const { items, total } = await this.transactions.list({ userId, ...query });
    const dtos = items.map(toTransactionDTO);

    const expenseTotal = dtos
      .filter((item) => item.type === 'EXPENSE')
      .reduce((sum, item) => sum + item.amountCents, 0);

    return {
      items: dtos,
      groups: groupByDay(dtos),
      page: query.page,
      perPage: query.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      summary: `${total} lançamento${total === 1 ? '' : 's'} · ${formatMoney(expenseTotal)} em gastos`,
    };
  }
}

/** Agrupa por dia e rotula "Hoje"/"Ontem" — o formato que a tela Lista consome. */
export function groupByDay(items: TransactionDTO[], today = new Date()): TransactionDayGroup[] {
  const todayISO = toISODate(today);
  const yesterdayISO = toISODate(new Date(today.getTime() - 24 * 60 * 60 * 1000));

  const buckets = new Map<string, TransactionDTO[]>();
  for (const item of items) {
    const bucket = buckets.get(item.occurredOn);
    if (bucket) bucket.push(item);
    else buckets.set(item.occurredOn, [item]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, group]) => {
      const monthIndex = Number(date.slice(5, 7)) - 1;
      const label =
        date === todayISO
          ? 'Hoje'
          : date === yesterdayISO
            ? 'Ontem'
            : `${date.slice(8, 10)} de ${MONTH_NAMES_LONG[monthIndex]}`;

      return {
        date,
        label,
        totalCents: group.reduce(
          (sum, item) => sum + (item.type === 'EXPENSE' ? item.amountCents : -item.amountCents),
          0,
        ),
        items: group,
      };
    });
}

export class CreateTransactionUseCase {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly categories: CategoryRepository,
  ) {}

  async execute(userId: string, data: CreateTransactionRequest): Promise<TransactionDTO> {
    const category = await this.categories.findById(userId, data.categoryId);
    if (!category) throw new NotFoundError('Categoria');
    if (category.archivedAt) {
      throw new BusinessRuleError('Esta categoria está arquivada. Escolha outra.');
    }
    if (category.kind !== data.type) {
      throw new BusinessRuleError(
        data.type === 'EXPENSE'
          ? 'Escolha uma categoria de despesa para um gasto.'
          : 'Escolha uma categoria de entrada para um recebimento.',
      );
    }

    const created = await this.transactions.create({
      userId,
      categoryId: data.categoryId,
      type: data.type,
      amountCents: data.amountCents,
      occurredOn: parseISODate(data.occurredOn),
      note: data.note ?? null,
    });
    return toTransactionDTO(created);
  }
}

export class UpdateTransactionUseCase {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly categories: CategoryRepository,
  ) {}

  async execute(
    userId: string,
    id: string,
    data: UpdateTransactionRequest,
  ): Promise<TransactionDTO> {
    const transaction = await this.transactions.findById(userId, id);
    if (!transaction) throw new NotFoundError('Lançamento');

    if (data.categoryId) {
      const category = await this.categories.findById(userId, data.categoryId);
      if (!category) throw new NotFoundError('Categoria');
      if (category.kind !== transaction.type) {
        throw new BusinessRuleError('A categoria escolhida não combina com o tipo do lançamento.');
      }
    }

    const updated = await this.transactions.update(userId, id, {
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.amountCents !== undefined ? { amountCents: data.amountCents } : {}),
      ...(data.occurredOn !== undefined ? { occurredOn: parseISODate(data.occurredOn) } : {}),
      ...(data.note !== undefined ? { note: data.note } : {}),
    });
    return toTransactionDTO(updated);
  }
}

export class DeleteTransactionUseCase {
  constructor(private readonly transactions: TransactionRepository) {}

  async execute(userId: string, id: string): Promise<void> {
    const transaction = await this.transactions.findById(userId, id);
    if (!transaction) throw new NotFoundError('Lançamento');
    await this.transactions.delete(userId, id);
  }
}

export { monthRefFromISODate };
