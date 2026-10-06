import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { formatCompact, formatMoney, type DebtDTO } from '@grana/shared';
import { Card } from '@/components/atoms/Card';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { Money } from '@/components/atoms/Money';
import { Spinner } from '@/components/atoms/Spinner';
import { ProgressBar } from '@/components/atoms/ProgressBar';
import { EmptyState } from '@/components/atoms/EmptyState';
import { FormField } from '@/components/molecules/FormField';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { MoreTabs } from '@/components/organisms/MoreTabs';
import {
  useCategories,
  useConvertDebt,
  useCreateDebt,
  useDebts,
  useDeleteDebt,
  useUpdateDebt,
} from '@/application/hooks/queries';
import { features } from '@/config/env';
import { useToast } from '@/application/toast/ToastProvider';
import { ApiRequestError } from '@/infra/http/api-client';

type FormValues = {
  name: string;
  valor: string;
  paidInstallments: number;
  totalInstallments: number;
};

export function DebtsPage() {
  const { show, showError } = useToast();
  const { data, isPending } = useDebts();
  const createDebt = useCreateDebt();
  const updateDebt = useUpdateDebt();
  const deleteDebt = useDeleteDebt();

  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [toConvert, setToConvert] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { name: '', valor: '', paidInstallments: 0, totalInstallments: 12 },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createDebt.mutateAsync({
        name: values.name,
        installmentCents: Math.round(Number(values.valor.replace(',', '.')) * 100),
        paidInstallments: Number(values.paidInstallments),
        totalInstallments: Number(values.totalInstallments),
      });
      show('Dívida cadastrada');
      reset();
      setFormOpen(false);
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para cadastrar.');
    }
  });

  if (isPending || !data) {
    return (
      <div className="px-5 pt-[22px]">
        <MoreTabs />
        <Spinner />
      </div>
    );
  }

  const maxProjection = Math.max(...data.projection.map((entry) => entry.totalCents), 1);

  return (
    <div className="px-5 pt-[22px] pb-6">
      <MoreTabs />

      {features.saldoFuturo && data.debts.some((debt) => !debt.settled) && (
        <Card className="mb-3.5 border-green/40">
          <p className="text-[13px] leading-relaxed text-soft">
            <strong className="font-semibold text-ink">Novidade:</strong> parcelas agora podem
            virar contas fixas com prazo. Assim elas entram no seu saldo futuro, com aviso de
            atraso. Use <em>mover para Contas</em> em cada uma. Compras parceladas no cartão ficam
            em <em>Cartões</em>.
          </p>
        </Card>
      )}

      <Card padding="lg">
        <p className="text-[13px] text-muted">Por mês em parcelas</p>
        <Money
          cents={data.monthlyTotalCents}
          className="mt-1 block font-display text-[32px] font-bold tracking-[-0.03em]"
        />

        <div aria-hidden className="mt-5 flex h-[92px] items-end gap-2.5">
          {data.projection.map((entry, index) => (
            <div
              key={entry.month}
              className="flex h-full flex-1 flex-col items-center justify-end gap-2"
            >
              <span className="text-[11px] text-muted">
                {entry.totalCents ? formatCompact(entry.totalCents) : '—'}
              </span>
              <div
                className={index === 0 ? 'w-full rounded-lg bg-ink' : 'w-full rounded-lg bg-pebble'}
                style={{ height: `${Math.max(6, (entry.totalCents / maxProjection) * 62)}px` }}
              />
              <span className="font-display text-[11px] text-soft">{entry.label}</span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-[12.5px] leading-relaxed text-soft">{data.note}</p>
      </Card>

      <Card className="mt-3.5">
        <SectionHeader
          title="Suas parcelas"
          aside={
            <button
              type="button"
              onClick={() => setFormOpen((open) => !open)}
              className="text-green hover:underline"
            >
              {formOpen ? 'fechar' : '+ nova'}
            </button>
          }
        />

        {formOpen && (
          <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
            <FormField label="Nome" error={errors.name?.message}>
              <Input
                placeholder="Cartão parcelado"
                {...register('name', { required: 'Informe o nome.' })}
              />
            </FormField>
            <div className="flex gap-3">
              <FormField label="Parcela (R$)" error={errors.valor?.message} className="flex-1">
                <Input
                  inputMode="decimal"
                  placeholder="430,00"
                  {...register('valor', { required: true })}
                />
              </FormField>
              <FormField label="Pagas" className="w-20">
                <Input
                  type="number"
                  min={0}
                  {...register('paidInstallments', { valueAsNumber: true })}
                />
              </FormField>
              <FormField label="Total" className="w-20">
                <Input
                  type="number"
                  min={1}
                  {...register('totalInstallments', { valueAsNumber: true })}
                />
              </FormField>
            </div>
            <Button type="submit" fullWidth loading={createDebt.isPending}>
              Cadastrar
            </Button>
          </form>
        )}

        {data.debts.length === 0 ? (
          <EmptyState title="Nenhuma parcela cadastrada" description="Ótimo sinal. 👏" />
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {data.debts.map((debt) => (
              <li key={debt.id}>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-medium">{debt.name}</p>
                  <div className="flex items-center gap-2">
                    <Money
                      cents={debt.installmentCents}
                      className="font-display text-[15px] font-semibold"
                    />
                    <button
                      type="button"
                      aria-label={`Excluir ${debt.name}`}
                      onClick={() => setToDelete(debt.id)}
                      className="text-muted transition-colors hover:text-clay"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <ProgressBar
                  percent={debt.progressPercent}
                  label={`${debt.paidInstallments} de ${debt.totalInstallments} parcelas pagas`}
                  className="mt-2 h-1.5"
                  barClassName="bg-green"
                />

                <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-muted">
                  <span>
                    parcela {debt.paidInstallments} de {debt.totalInstallments}
                  </span>
                  <span>faltam {formatMoney(debt.remainingCents)}</span>
                </div>

                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={debt.paidInstallments >= debt.totalInstallments}
                    onClick={() =>
                      updateDebt.mutate(
                        { id: debt.id, data: { paidInstallments: debt.paidInstallments + 1 } },
                        { onSuccess: () => show('Parcela marcada como paga') },
                      )
                    }
                  >
                    + paguei uma
                  </Button>
                  {features.saldoFuturo && !debt.settled && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setToConvert(toConvert === debt.id ? null : debt.id)}
                    >
                      mover para Contas
                    </Button>
                  )}
                  {debt.paidInstallments > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        updateDebt.mutate({
                          id: debt.id,
                          data: { paidInstallments: debt.paidInstallments - 1 },
                        })
                      }
                    >
                      desfazer
                    </Button>
                  )}
                </div>

                {toConvert === debt.id && (
                  <ConvertDebtForm debt={debt} onDone={() => setToConvert(null)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={toDelete !== null}
        title="Excluir esta dívida?"
        confirmLabel="Excluir"
        destructive
        loading={deleteDebt.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteDebt.mutateAsync(toDelete);
          setToDelete(null);
          show('Dívida removida');
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

/** Leva as parcelas que faltam para uma conta fixa com prazo. */
function ConvertDebtForm({ debt, onDone }: { debt: DebtDTO; onDone: () => void }) {
  const { show, showError } = useToast();
  const { data: categories } = useCategories();
  const convert = useConvertDebt();
  const expenseCategories = (categories ?? []).filter(
    (category) => category.kind === 'EXPENSE' && !category.archivedAt,
  );
  const [categoryId, setCategoryId] = useState('');
  const [dueDay, setDueDay] = useState(10);

  return (
    <form
      className="mt-3 flex flex-col gap-3 rounded-2xl bg-line-soft p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const selected = categoryId || expenseCategories[0]?.id;
        if (!selected) {
          showError('Crie uma categoria de despesa primeiro.');
          return;
        }
        try {
          await convert.mutateAsync({ id: debt.id, data: { categoryId: selected, dueDay } });
          show(`${debt.name} agora está em Contas, com ${debt.remainingInstallments} parcelas`);
          onDone();
        } catch (error) {
          showError(error instanceof ApiRequestError ? error.message : 'Não deu para mover.');
        }
      }}
    >
      <p className="text-[12.5px] text-soft">
        Vira uma conta fixa de {formatMoney(debt.installmentCents)} com{' '}
        {debt.remainingInstallments} parcelas, começando neste mês.
      </p>
      <div className="flex gap-3">
        <FormField label="Categoria" className="flex-1">
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="h-11 w-full rounded-xl border border-line bg-card px-3 text-sm"
          >
            {expenseCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Vence dia" className="w-24">
          <Input
            type="number"
            min={1}
            max={31}
            value={dueDay}
            onChange={(event) =>
              setDueDay(Math.min(31, Math.max(1, Number(event.target.value) || 1)))
            }
          />
        </FormField>
      </div>
      <Button type="submit" size="sm" loading={convert.isPending}>
        Mover para Contas
      </Button>
    </form>
  );
}
