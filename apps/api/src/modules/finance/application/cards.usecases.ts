import type {
  CardDTO,
  CardPurchaseDTO,
  CreateCardPurchaseRequest,
  CreateCardRequest,
  InvoiceDetail,
  MonthRef,
  UpdateCardRequest,
} from '@grana/shared';
import { BusinessRuleError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  buildInvoices,
  installmentsOf,
  invoiceFor,
  openInvoiceMonth,
  type PurchaseLike,
} from '../domain/card.calculator.js';
import type {
  CardPurchaseRecord,
  CardRecord,
  CardRepository,
  CategoryRepository,
} from '../domain/ports.js';
import { toCardPurchaseDTO, toISODate } from '../infra/finance.mappers.js';
import { serverToday } from './cashflow.usecases.js';

function toPurchaseLike(record: CardPurchaseRecord): PurchaseLike {
  return {
    id: record.id,
    amountCents: record.amountCents,
    installments: record.installments,
    purchasedOn: toISODate(record.purchasedOn),
  };
}

function toCardDTO(card: CardRecord, purchases: CardPurchaseRecord[], today: string): CardDTO {
  const likes = purchases.map(toPurchaseLike);
  const upcoming = buildInvoices(card, likes, today).filter((invoice) => invoice.status !== 'PAST');
  const openMonth = openInvoiceMonth(card, today);
  if (!upcoming.some((invoice) => invoice.month === openMonth)) {
    upcoming.push(invoiceFor(card, [], openMonth, today));
    upcoming.sort((a, b) => (a.month < b.month ? -1 : 1));
  }

  const usedLimitCents = likes
    .flatMap((purchase) => installmentsOf(card, purchase))
    .filter((installment) => installment.dueDate >= today)
    .reduce((sum, installment) => sum + installment.amountCents, 0);

  return {
    id: card.id,
    name: card.name,
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    limitCents: card.limitCents,
    active: card.active,
    usedLimitCents,
    invoices: upcoming.slice(0, 4).map(({ month, closingDate, dueDate, totalCents, status }) => ({
      month,
      closingDate,
      dueDate,
      totalCents,
      status,
    })),
  };
}

export class ListCardsUseCase {
  constructor(private readonly cards: CardRepository) {}

  async execute(userId: string, today: string = serverToday()): Promise<CardDTO[]> {
    const [cards, purchases] = await Promise.all([
      this.cards.listByUser(userId),
      this.cards.listPurchases(userId),
    ]);
    return cards.map((card) =>
      toCardDTO(
        card,
        purchases.filter((purchase) => purchase.cardId === card.id),
        today,
      ),
    );
  }
}

export class CreateCardUseCase {
  constructor(private readonly cards: CardRepository) {}

  async execute(userId: string, data: CreateCardRequest): Promise<CardDTO> {
    const card = await this.cards.create({
      userId,
      name: data.name,
      closingDay: data.closingDay,
      dueDay: data.dueDay,
      limitCents: data.limitCents ?? null,
    });
    return toCardDTO(card, [], serverToday());
  }
}

export class UpdateCardUseCase {
  constructor(private readonly cards: CardRepository) {}

  async execute(userId: string, id: string, data: UpdateCardRequest): Promise<CardDTO> {
    const card = await this.cards.findById(userId, id);
    if (!card) throw new NotFoundError('Cartão');
    const updated = await this.cards.update(userId, id, data);
    return toCardDTO(updated, await this.cards.listPurchases(userId, id), serverToday());
  }
}

export class DeleteCardUseCase {
  constructor(private readonly cards: CardRepository) {}

  async execute(userId: string, id: string): Promise<void> {
    const card = await this.cards.findById(userId, id);
    if (!card) throw new NotFoundError('Cartão');
    await this.cards.delete(userId, id);
  }
}

export class GetInvoiceUseCase {
  constructor(private readonly cards: CardRepository) {}

  async execute(
    userId: string,
    cardId: string,
    month?: MonthRef,
    today: string = serverToday(),
  ): Promise<InvoiceDetail> {
    const card = await this.cards.findById(userId, cardId);
    if (!card) throw new NotFoundError('Cartão');
    const purchases = await this.cards.listPurchases(userId, cardId);
    const byId = new Map(purchases.map((purchase) => [purchase.id, purchase]));

    const invoice = invoiceFor(
      card,
      purchases.map(toPurchaseLike),
      month ?? openInvoiceMonth(card, today),
      today,
    );

    return {
      cardId: card.id,
      cardName: card.name,
      month: invoice.month,
      closingDate: invoice.closingDate,
      dueDate: invoice.dueDate,
      totalCents: invoice.totalCents,
      status: invoice.status,
      items: invoice.items.map((item) => {
        const purchase = byId.get(item.purchaseId)!;
        return {
          purchaseId: purchase.id,
          label: purchase.note ?? purchase.category.name,
          category: purchase.category,
          purchasedOn: toISODate(purchase.purchasedOn),
          installmentNumber: item.number,
          installments: item.installments,
          amountCents: item.amountCents,
        };
      }),
    };
  }
}

export class CreateCardPurchaseUseCase {
  constructor(
    private readonly cards: CardRepository,
    private readonly categories: CategoryRepository,
  ) {}

  async execute(
    userId: string,
    cardId: string,
    data: CreateCardPurchaseRequest,
  ): Promise<CardPurchaseDTO> {
    const card = await this.cards.findById(userId, cardId);
    if (!card) throw new NotFoundError('Cartão');
    const category = await this.categories.findById(userId, data.categoryId);
    if (!category) throw new NotFoundError('Categoria');
    if (category.kind !== 'EXPENSE') {
      throw new BusinessRuleError('Compra no cartão precisa de uma categoria de despesa.');
    }

    const created = await this.cards.createPurchase({
      userId,
      cardId,
      categoryId: data.categoryId,
      amountCents: data.amountCents,
      installments: data.installments,
      purchasedOn: new Date(`${data.purchasedOn}T00:00:00.000Z`),
      note: data.note?.trim() ? data.note.trim() : null,
    });
    return toCardPurchaseDTO(created);
  }
}

export class DeleteCardPurchaseUseCase {
  constructor(private readonly cards: CardRepository) {}

  async execute(userId: string, id: string): Promise<void> {
    const purchase = await this.cards.findPurchase(userId, id);
    if (!purchase) throw new NotFoundError('Compra');
    await this.cards.deletePurchase(userId, id);
  }
}
