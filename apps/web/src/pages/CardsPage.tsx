import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { clsx } from 'clsx';
import {
  createCardPurchaseRequestSchema,
  createCardRequestSchema,
  formatMoney,
  monthNameShort,
  parseBRLToCents,
  type CardDTO,
  type MonthRef,
} from '@grana/shared';
import { Button } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Input } from '@/components/atoms/Input';
import { Money } from '@/components/atoms/Money';
import { ProgressBar } from '@/components/atoms/ProgressBar';
import { Spinner } from '@/components/atoms/Spinner';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { FormField } from '@/components/molecules/FormField';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { MoreTabs } from '@/components/organisms/MoreTabs';
import {
  useCards,
  useCategories,
  useCreateCard,
  useCreateCardPurchase,
  useDeleteCard,
  useDeleteCardPurchase,
  useInvoice,
  useSettings,
} from '@/application/hooks/queries';
import { useToast } from '@/application/toast/ToastProvider';
import { localTodayISO, shortDate } from '@/application/dates';
import { ApiRequestError } from '@/infra/http/api-client';

const STATUS_LABEL = {
  OPEN: 'aberta',
  FUTURE: 'próxima',
  CLOSED: 'fechada',
  PAST: 'paga',
} as const;

/**
 * Cartões de crédito: a compra não sai do saldo no dia — sai na fatura, no
 * vencimento. Parcelada, uma parcela por fatura.
 */
export function CardsPage() {
  const { show, showError } = useToast();
  const { data: cards, isPending } = useCards();
  const { data: settings } = useSettings();
  const createCard = useCreateCard();
  const deleteCard = useDeleteCard();
  const hideCents = settings?.roundCents ?? false;

  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<CardDTO | null>(null);

  const { register, handleSubmit, reset } = useForm<{
    name: string;
    closingDay: number;
    dueDay: number;
    limite: string;
  }>({ defaultValues: { name: '', closingDay: 3, dueDay: 10, limite: '' } });

  const onSubmit = handleSubmit(async (values) => {
    const limitCents = values.limite.trim() ? parseBRLToCents(values.limite) : null;
    const parsed = createCardRequestSchema.safeParse({
      name: values.name,
      closingDay: Number(values.closingDay),
      dueDay: Number(values.dueDay),
      limitCents,
    });
    if (!parsed.success) {
      showError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
      return;
    }
    try {
      await createCard.mutateAsync(parsed.data);
      show('Cartão cadastrado');
      reset();
      setFormOpen(false);
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para cadastrar.');
    }
  });

  return (
    <div className="px-5 pt-[22px] pb-6">
      <MoreTabs />

      <div className="mb-3.5">
        <SectionHeader
          title="Cartões"
          aside={
            <button
              type="button"
              onClick={() => setFormOpen((open) => !open)}
              className="text-green hover:underline"
            >
              {formOpen ? 'fechar' : '+ novo cartão'}
            </button>
          }
        />
      </div>

      {formOpen && (
        <Card className="mb-3.5">
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <FormField label="Nome">
              <Input placeholder="Nubank" {...register('name', { required: true })} />
            </FormField>
            <div className="flex gap-3">
              <FormField label="Fecha dia" className="flex-1">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  {...register('closingDay', { valueAsNumber: true })}
                />
              </FormField>
              <FormField label="Vence dia" className="flex-1">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  {...register('dueDay', { valueAsNumber: true })}
                />
              </FormField>
            </div>
            <FormField label="Limite (opcional)">
              <Input inputMode="decimal" placeholder="5.000,00" {...register('limite')} />
            </FormField>
            <Button type="submit" fullWidth loading={createCard.isPending}>
              Cadastrar cartão
            </Button>
          </form>
        </Card>
      )}

      {isPending ? (
        <Spinner />
      ) : !cards || cards.length === 0 ? (
        <EmptyState
          title="Nenhum cartão cadastrado"
          description="Cadastre seu cartão para a fatura entrar no saldo futuro no dia do vencimento."
        />
      ) : (
        <div className="flex flex-col gap-3.5">
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              hideCents={hideCents}
              onDelete={() => setToDelete(card)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={toDelete ? `Excluir ${toDelete.name}?` : ''}
        description="Todas as compras e faturas deste cartão também são removidas."
        confirmLabel="Excluir"
        destructive
        loading={deleteCard.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteCard.mutateAsync(toDelete.id);
          setToDelete(null);
          show('Cartão excluído');
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function CardItem({
  card,
  hideCents,
  onDelete,
}: {
  card: CardDTO;
  hideCents: boolean;
  onDelete: () => void;
}) {
  const { show } = useToast();
  const [month, setMonth] = useState<MonthRef | undefined>(card.invoices[0]?.month);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const { data: invoice, isPending } = useInvoice(card.id, month);
  const deletePurchase = useDeleteCardPurchase();
  const [toDelete, setToDelete] = useState<string | null>(null);

  const limitPercent =
    card.limitCents && card.limitCents > 0
      ? Math.round((card.usedLimitCents / card.limitCents) * 100)
      : null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold">{card.name}</h2>
          <p className="text-[11.5px] text-muted">
            fecha dia {card.closingDay} · vence dia {card.dueDay}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Excluir ${card.name}`}
          onClick={onDelete}
          className="px-1 text-muted transition-colors hover:text-clay"
        >
          ×
        </button>
      </div>

      {limitPercent !== null && (
        <div className="mt-3">
          <ProgressBar
            percent={limitPercent}
            label={`${limitPercent}% do limite usado`}
            className="h-1.5"
            barClassName={limitPercent > 90 ? 'bg-clay' : 'bg-green'}
          />
          <p className="mt-1.5 text-[11.5px] text-muted">
            {formatMoney(card.usedLimitCents, { hideCents })} usados de{' '}
            {formatMoney(card.limitCents!, { hideCents })}
          </p>
        </div>
      )}

      <div className="no-scrollbar -mx-5 mt-3.5 flex gap-2 overflow-x-auto px-5 pb-1">
        {card.invoices.map((item) => (
          <button
            key={item.month}
            type="button"
            aria-pressed={item.month === month}
            onClick={() => setMonth(item.month)}
            className={clsx(
              'flex min-w-[96px] flex-col items-start rounded-[14px] border px-3 py-2 text-left transition-colors',
              item.month === month ? 'border-ink bg-ink text-surface' : 'border-line bg-card',
            )}
          >
            <span className="text-[11px] opacity-75">
              {monthNameShort(item.month)} · {STATUS_LABEL[item.status]}
            </span>
            <span className="font-display text-[14px] font-semibold tabular">
              {formatMoney(item.totalCents, { hideCents })}
            </span>
            <span className="text-[10.5px] opacity-75">vence {shortDate(item.dueDate)}</span>
          </button>
        ))}
      </div>

      <div className="mt-3">
        {isPending ? (
          <Spinner />
        ) : !invoice || invoice.items.length === 0 ? (
          <p className="py-2 text-[13px] text-muted">Nenhuma compra nesta fatura.</p>
        ) : (
          <ul>
            {invoice.items.map((item) => (
              <li
                key={`${item.purchaseId}-${item.installmentNumber}`}
                className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: item.category.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  <p className="text-[11px] text-muted">
                    {shortDate(item.purchasedOn)}
                    {item.installments > 1
                      ? ` · parcela ${item.installmentNumber}/${item.installments}`
                      : ''}
                  </p>
                </div>
                <Money
                  cents={item.amountCents}
                  hideCents={hideCents}
                  className="font-display text-[14px] font-semibold"
                />
                <button
                  type="button"
                  aria-label={`Apagar compra ${item.label}`}
                  onClick={() => setToDelete(item.purchaseId)}
                  className="px-1 text-muted transition-colors hover:text-clay"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={() => setPurchaseOpen((open) => !open)}
        className="mt-3 text-[13px] font-medium text-green"
      >
        {purchaseOpen ? 'fechar' : '+ compra no cartão'}
      </button>

      {purchaseOpen && <PurchaseForm cardId={card.id} onDone={() => setPurchaseOpen(false)} />}

      <ConfirmDialog
        open={toDelete !== null}
        title="Apagar esta compra?"
        description="Todas as parcelas dela saem das faturas."
        confirmLabel="Apagar"
        destructive
        loading={deletePurchase.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          await deletePurchase.mutateAsync(toDelete);
          setToDelete(null);
          show('Compra apagada');
        }}
        onCancel={() => setToDelete(null)}
      />
    </Card>
  );
}

function PurchaseForm({ cardId, onDone }: { cardId: string; onDone: () => void }) {
  const { show, showError } = useToast();
  const { data: categories } = useCategories();
  const createPurchase = useCreateCardPurchase();
  const expenseCategories = (categories ?? []).filter(
    (category) => category.kind === 'EXPENSE' && !category.archivedAt,
  );

  const { register, handleSubmit, reset } = useForm<{
    valor: string;
    installments: number;
    purchasedOn: string;
    categoryId: string;
    note: string;
  }>({
    defaultValues: {
      valor: '',
      installments: 1,
      purchasedOn: localTodayISO(),
      categoryId: '',
      note: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const parsed = createCardPurchaseRequestSchema.safeParse({
      amountCents: parseBRLToCents(values.valor) ?? 0,
      installments: Number(values.installments),
      purchasedOn: values.purchasedOn,
      categoryId: values.categoryId || expenseCategories[0]?.id,
      ...(values.note.trim() ? { note: values.note.trim() } : {}),
    });
    if (!parsed.success) {
      showError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
      return;
    }
    try {
      await createPurchase.mutateAsync({ cardId, data: parsed.data });
      show('Compra registrada');
      reset();
      onDone();
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para registrar.');
    }
  });

  return (
    <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3">
      <div className="flex gap-3">
        <FormField label="Valor total (R$)" className="flex-1">
          <Input
            inputMode="decimal"
            placeholder="600,00"
            {...register('valor', { required: true })}
          />
        </FormField>
        <FormField label="Parcelas" className="w-24">
          <Input
            type="number"
            min={1}
            max={48}
            {...register('installments', { valueAsNumber: true })}
          />
        </FormField>
      </div>
      <div className="flex gap-3">
        <FormField label="Data" className="flex-1">
          <Input type="date" {...register('purchasedOn', { required: true })} />
        </FormField>
        <FormField label="Categoria" className="flex-1">
          <select
            {...register('categoryId')}
            className="h-11 w-full rounded-xl border border-line bg-card px-3 text-sm"
          >
            {expenseCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <FormField label="Descrição (opcional)">
        <Input placeholder="Geladeira" maxLength={140} {...register('note')} />
      </FormField>
      <Button type="submit" fullWidth loading={createPurchase.isPending}>
        Registrar compra
      </Button>
    </form>
  );
}
