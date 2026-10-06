import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { formatMoney, type CategoryDTO, type EntryType } from '@grana/shared';
import { Button } from '@/components/atoms/Button';
import { Chip } from '@/components/atoms/Chip';
import { Input } from '@/components/atoms/Input';
import { Spinner } from '@/components/atoms/Spinner';
import { Keypad } from '@/components/organisms/Keypad';
import {
  useCards,
  useCategories,
  useCreateCardPurchase,
  useCreateCategory,
  useCreateTransaction,
} from '@/application/hooks/queries';
import { features } from '@/config/env';
import { useToast } from '@/application/toast/ToastProvider';
import { ApiRequestError } from '@/infra/http/api-client';

/** Data de hoje em `YYYY-MM-DD`, sem sofrer com fuso. */
function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Tela de lançamento.
 *
 * O valor é digitado em CENTAVOS ("1250" vira R$ 12,50) — sem vírgula, sem
 * ponto, sem teclado do sistema atrapalhando. É o gesto mais rápido possível
 * para a ação que o usuário repete várias vezes por dia.
 */
export function AddEntryPage() {
  const navigate = useNavigate();
  const { show, showError } = useToast();
  const { data: categories, isPending } = useCategories();
  const createTransaction = useCreateTransaction();
  const createCategory = useCreateCategory();
  const createPurchase = useCreateCardPurchase();
  const { data: cards } = useCards();
  const activeCards = features.saldoFuturo ? (cards ?? []).filter((card) => card.active) : [];

  const [type, setType] = useState<EntryType>('EXPENSE');
  const [digits, setDigits] = useState('');
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<Record<EntryType, string | null>>({
    EXPENSE: null,
    INCOME: null,
  });
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  /** `null` = saiu da conta; senão, o id do cartão. */
  const [cardId, setCardId] = useState<string | null>(null);
  const [installments, setInstallments] = useState(1);
  const payingWithCard = type === 'EXPENSE' && cardId !== null;

  const visibleCategories = useMemo<CategoryDTO[]>(
    () => (categories ?? []).filter((category) => category.kind === type && !category.archivedAt),
    [categories, type],
  );

  const selectedId = selected[type] ?? visibleCategories[0]?.id ?? null;
  const selectedCategory = visibleCategories.find((category) => category.id === selectedId);
  const cents = Number.parseInt(digits || '0', 10);

  function press(key: string) {
    setDigits((current) => {
      if (key === 'del') return current.slice(0, -1);
      if (current.length >= 8) return current;
      return (current + key).replace(/^0+(?=\d)/, '');
    });
  }

  async function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (name.length < 2) {
      showError('Dê um nome de pelo menos 2 letras.');
      return;
    }
    try {
      const created = await createCategory.mutateAsync({ name, kind: type });
      setSelected((current) => ({ ...current, [type]: created.id }));
      setNewCategoryOpen(false);
      setNewCategoryName('');
      show(`Categoria ${created.name} criada`);
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para criar.');
    }
  }

  async function save() {
    if (!cents) {
      showError('Digite um valor primeiro.');
      return;
    }
    if (!selectedId) {
      showError('Escolha uma categoria.');
      return;
    }

    try {
      if (payingWithCard) {
        // No cartão, o dinheiro sai na fatura — não vira lançamento do dia.
        await createPurchase.mutateAsync({
          cardId,
          data: {
            amountCents: cents,
            installments,
            purchasedOn: todayISO(),
            categoryId: selectedId,
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        });
        show(
          `Compra de ${formatMoney(cents)} no cartão${installments > 1 ? ` em ${installments}x` : ''} salva`,
        );
        navigate('/');
        return;
      }
      await createTransaction.mutateAsync({
        type,
        amountCents: cents,
        categoryId: selectedId,
        occurredOn: todayISO(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      show(`${type === 'INCOME' ? 'Entrada' : 'Gasto'} de ${formatMoney(cents)} salvo`);
      navigate('/');
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para salvar.');
    }
  }

  if (isPending) return <Spinner />;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between px-5 pt-5">
        <button type="button" onClick={() => navigate('/')} className="text-sm text-muted">
          Cancelar
        </button>

        <div role="tablist" className="flex rounded-xl bg-chip p-[3px]">
          {(
            [
              ['EXPENSE', 'Saiu'],
              ['INCOME', 'Entrou'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={type === value}
              type="button"
              onClick={() => setType(value)}
              className={clsx(
                'rounded-[10px] px-4 py-[7px] text-[13px] font-semibold transition-colors',
                type === value ? 'bg-card text-ink' : 'text-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="w-[52px]" />
      </div>

      <div className="px-5 pt-8 pb-2.5 text-center">
        <p className="text-[13px] text-muted">
          {type === 'INCOME' ? 'Quanto entrou' : 'Quanto gastou'}
          {selectedCategory ? ` em ${selectedCategory.name.toLowerCase()}` : ''}
        </p>
        <p
          className={clsx(
            'mt-1.5 font-display text-[56px] font-bold tracking-[-0.04em] tabular',
            type === 'INCOME' ? 'text-green' : 'text-ink',
          )}
        >
          {formatMoney(cents)}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2 px-4 pt-1.5">
        {visibleCategories.map((category) => (
          <Chip
            key={category.id}
            label={category.name}
            dotColor={category.color}
            selected={category.id === selectedId}
            onClick={() => setSelected((current) => ({ ...current, [type]: category.id }))}
          />
        ))}
        <Chip label="+ Nova categoria" dashed onClick={() => setNewCategoryOpen((open) => !open)} />
      </div>

      {newCategoryOpen && (
        <div className="flex gap-2 px-5 pt-3">
          <Input
            value={newCategoryName}
            onChange={(event) => setNewCategoryName(event.target.value)}
            placeholder="Nome da categoria"
            maxLength={60}
          />
          <Button loading={createCategory.isPending} onClick={() => void handleCreateCategory()}>
            Criar
          </Button>
        </div>
      )}

      {type === 'EXPENSE' && activeCards.length > 0 && (
        <div className="px-5 pt-3">
          <p className="mb-1.5 text-[12px] font-medium text-muted">Pagou com</p>
          <div className="flex flex-wrap items-center gap-2">
            <Chip label="Conta / Pix" selected={cardId === null} onClick={() => setCardId(null)} />
            {activeCards.map((card) => (
              <Chip
                key={card.id}
                label={card.name}
                selected={cardId === card.id}
                onClick={() => setCardId(card.id)}
              />
            ))}
            {payingWithCard && (
              <label className="ml-auto flex items-center gap-2 text-[13px] text-soft">
                Parcelas
                <Input
                  type="number"
                  min={1}
                  max={48}
                  value={installments}
                  onChange={(event) =>
                    setInstallments(Math.min(48, Math.max(1, Number(event.target.value) || 1)))
                  }
                  className="h-9 w-16"
                />
              </label>
            )}
          </div>
        </div>
      )}

      <div className="px-5 pt-3">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Observação (opcional)"
          maxLength={140}
          aria-label="Observação"
        />
      </div>

      <Keypad onPress={press} />

      <div className="mt-auto px-4 pt-3 pb-4">
        <Button
          size="lg"
          fullWidth
          disabled={!cents}
          loading={createTransaction.isPending || createPurchase.isPending}
          onClick={() => void save()}
        >
          {cents ? `Salvar ${formatMoney(cents)}` : 'Digite o valor'}
        </Button>
      </div>
    </div>
  );
}
