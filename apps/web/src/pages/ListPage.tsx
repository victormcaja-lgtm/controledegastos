import { useState } from 'react';
import { Money } from '@/components/atoms/Money';
import { Chip } from '@/components/atoms/Chip';
import { Spinner } from '@/components/atoms/Spinner';
import { EmptyState } from '@/components/atoms/EmptyState';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { MonthSwitcher } from '@/components/molecules/MonthSwitcher';
import {
  useCategories,
  useDeleteTransaction,
  useSettings,
  useTransactions,
} from '@/application/hooks/queries';
import { useMonth } from '@/application/month/useMonth';
import { useToast } from '@/application/toast/ToastProvider';

export function ListPage() {
  const { month, setMonth } = useMonth();
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const { show } = useToast();
  const { data: categories } = useCategories();
  const { data: settings } = useSettings();
  const { data, isPending } = useTransactions({
    month,
    ...(categoryId ? { categoryId } : {}),
    perPage: 100,
  });
  const remove = useDeleteTransaction();

  const hideCents = settings?.roundCents ?? false;

  async function confirmDelete() {
    if (!toDelete) return;
    await remove.mutateAsync(toDelete);
    setToDelete(null);
    show('Lançamento apagado');
  }

  return (
    <div className="px-5 pt-[22px] pb-6">
      <MonthSwitcher month={month} onChange={setMonth} subtitle={data?.summary} />

      <div className="no-scrollbar -mx-5 mb-3.5 flex gap-2 overflow-x-auto px-5 pb-1">
        <Chip label="Todos" selected={!categoryId} onClick={() => setCategoryId(undefined)} />
        {(categories ?? [])
          .filter((category) => !category.archivedAt)
          .map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              dotColor={category.color}
              selected={categoryId === category.id}
              onClick={() => setCategoryId(category.id)}
            />
          ))}
      </div>

      {isPending ? (
        <Spinner />
      ) : !data || data.groups.length === 0 ? (
        <EmptyState
          title="Nada lançado por aqui"
          description="Quando você registrar um gasto ou uma entrada, ele aparece nesta lista."
        />
      ) : (
        <div className="flex flex-col gap-3.5">
          {data.groups.map((group) => (
            <section
              key={group.date}
              className="rounded-[22px] border border-line bg-card px-5 py-4"
            >
              <header className="flex items-baseline justify-between">
                <h2 className="font-display text-sm font-semibold">{group.label}</h2>
                <Money
                  cents={group.totalCents}
                  hideCents={hideCents}
                  className="text-xs text-muted"
                />
              </header>

              <ul className="mt-1">
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0"
                  >
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: item.category.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.category.name}</p>
                      {item.note && (
                        <p className="truncate text-[11.5px] text-muted">{item.note}</p>
                      )}
                    </div>
                    <Money
                      cents={item.type === 'INCOME' ? -item.amountCents : item.amountCents}
                      hideCents={hideCents}
                      signed={item.type === 'INCOME'}
                      className={`font-display text-[15px] font-semibold ${
                        item.type === 'INCOME' ? 'text-green' : 'text-ink'
                      }`}
                    />
                    <button
                      type="button"
                      aria-label={`Apagar lançamento de ${item.category.name}`}
                      onClick={() => setToDelete(item.id)}
                      className="px-1 text-muted transition-colors hover:text-clay"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Apagar este lançamento?"
        description="Ele sai do mês e dos relatórios. Não dá para desfazer."
        confirmLabel="Apagar"
        destructive
        loading={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
