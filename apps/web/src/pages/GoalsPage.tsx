import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { clsx } from 'clsx';
import { formatMoney } from '@grana/shared';
import { Card } from '@/components/atoms/Card';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { Money } from '@/components/atoms/Money';
import { Spinner } from '@/components/atoms/Spinner';
import { EmptyState } from '@/components/atoms/EmptyState';
import { FormField } from '@/components/molecules/FormField';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { MoreTabs } from '@/components/organisms/MoreTabs';
import {
  useCreateGoal,
  useDeleteGoal,
  useDepositToGoal,
  useGoals,
} from '@/application/hooks/queries';
import { useToast } from '@/application/toast/ToastProvider';
import { ApiRequestError } from '@/infra/http/api-client';

const QUICK_AMOUNTS = [5000, 10000, 25000] as const;

export function GoalsPage() {
  const { show, showError } = useToast();
  const { data: goals, isPending } = useGoals();
  const createGoal = useCreateGoal();
  const deposit = useDepositToGoal();
  const deleteGoal = useDeleteGoal();

  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<{ name: string; alvo: string }>({ defaultValues: { name: '', alvo: '' } });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createGoal.mutateAsync({
        name: values.name,
        targetCents: Math.round(Number(values.alvo.replace(',', '.')) * 100),
        savedCents: 0,
        featured: (goals ?? []).length === 0,
      });
      show('Meta criada');
      reset();
      setFormOpen(false);
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para criar a meta.');
    }
  });

  if (isPending || !goals) {
    return (
      <div className="px-5 pt-[22px]">
        <MoreTabs />
        <Spinner />
      </div>
    );
  }

  const totalSaved = goals.reduce((sum, goal) => sum + goal.savedCents, 0);

  return (
    <div className="px-5 pt-[22px] pb-6">
      <MoreTabs />

      <div className="mb-3.5">
        <SectionHeader title="Guardar" aside={`Guardado: ${formatMoney(totalSaved)}`} />
      </div>

      <Card className="mb-3.5">
        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          className="w-full text-left text-[13px] font-medium text-green"
        >
          {formOpen ? 'fechar' : '+ nova meta'}
        </button>

        {formOpen && (
          <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
            <FormField label="Nome da meta" error={errors.name?.message}>
              <Input
                placeholder="Reserva de emergência"
                {...register('name', { required: 'Informe o nome.' })}
              />
            </FormField>
            <FormField label="Objetivo (R$)" error={errors.alvo?.message}>
              <Input
                inputMode="decimal"
                placeholder="6000,00"
                {...register('alvo', { required: true })}
              />
            </FormField>
            <Button type="submit" fullWidth loading={createGoal.isPending}>
              Criar meta
            </Button>
          </form>
        )}
      </Card>

      {goals.length === 0 ? (
        <EmptyState
          title="Nenhuma meta ainda"
          description="Uma meta transforma sobra do mês em objetivo. Comece pela reserva de emergência."
        />
      ) : (
        <div className="flex flex-col gap-3.5">
          {goals.map((goal) => (
            <Card key={goal.id} tone={goal.featured ? 'dark' : 'light'} padding="lg">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-[15px] font-semibold">{goal.name}</p>
                  <p
                    className={clsx(
                      'mt-0.5 text-[11.5px]',
                      goal.featured ? 'text-faint' : 'text-muted',
                    )}
                  >
                    objetivo {formatMoney(goal.targetCents)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Excluir meta ${goal.name}`}
                  onClick={() => setToDelete(goal.id)}
                  className={clsx(
                    'transition-colors hover:text-clay',
                    goal.featured ? 'text-faint' : 'text-muted',
                  )}
                >
                  ×
                </button>
              </div>

              <Money
                cents={goal.savedCents}
                className="mt-3 block font-display text-[30px] font-bold tracking-[-0.03em]"
              />

              <div
                className={clsx(
                  'mt-3 h-2.5 w-full overflow-hidden rounded-md',
                  goal.featured ? 'bg-ink-soft' : 'bg-line-soft',
                )}
              >
                <div
                  className={clsx(
                    'h-full rounded-md transition-all',
                    goal.featured ? 'bg-mint' : 'bg-ink',
                  )}
                  style={{ width: `${goal.progressPercent}%` }}
                />
              </div>

              <p
                className={clsx('mt-2 text-[12.5px]', goal.featured ? 'text-faint' : 'text-muted')}
              >
                {goal.achieved
                  ? 'objetivo alcançado!'
                  : `faltam ${formatMoney(goal.remainingCents)} · ${goal.progressPercent}% do objetivo`}
              </p>

              <div className="mt-3.5 flex gap-2">
                {QUICK_AMOUNTS.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    disabled={deposit.isPending}
                    onClick={() =>
                      deposit.mutate(
                        { id: goal.id, amountCents: amount },
                        {
                          onSuccess: () =>
                            show(`Guardou ${formatMoney(amount)} em ${goal.name.toLowerCase()}`),
                        },
                      )
                    }
                    className={clsx(
                      'flex-1 rounded-xl py-2.5 text-[13px] font-semibold transition-colors',
                      goal.featured
                        ? 'bg-ink-soft text-surface hover:opacity-90'
                        : 'bg-line-soft text-ink hover:bg-chip',
                    )}
                  >
                    + {amount / 100}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Excluir esta meta?"
        description="O histórico de depósitos também é apagado."
        confirmLabel="Excluir"
        destructive
        loading={deleteGoal.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteGoal.mutateAsync(toDelete);
          setToDelete(null);
          show('Meta removida');
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
