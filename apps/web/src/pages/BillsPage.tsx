import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { clsx } from 'clsx';
import { createBillRequestSchema, formatMoney, type CreateBillRequest } from '@grana/shared';
import { Card } from '@/components/atoms/Card';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { Money } from '@/components/atoms/Money';
import { Spinner } from '@/components/atoms/Spinner';
import { FormField } from '@/components/molecules/FormField';
import { MonthSwitcher } from '@/components/molecules/MonthSwitcher';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { CalendarGrid } from '@/components/organisms/CalendarGrid';
import {
  useBills,
  useCategories,
  useCreateBill,
  useDeleteBill,
  useSetBillPayment,
  useSettings,
} from '@/application/hooks/queries';
import { useMonth } from '@/application/month/useMonth';
import { useToast } from '@/application/toast/ToastProvider';
import { ApiRequestError } from '@/infra/http/api-client';

type FormValues = { name: string; categoryId: string; valor: string; dueDay: number };

export function BillsPage() {
  const { month, setMonth } = useMonth();
  const { show, showError } = useToast();
  const { data, isPending } = useBills(month);
  const { data: categories } = useCategories();
  const { data: settings } = useSettings();
  const setPayment = useSetBillPayment(month);
  const createBill = useCreateBill();
  const deleteBill = useDeleteBill();

  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const hideCents = settings?.roundCents ?? false;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { name: '', categoryId: '', valor: '', dueDay: 5 },
  });

  const expenseCategories = (categories ?? []).filter(
    (category) => category.kind === 'EXPENSE' && !category.archivedAt,
  );

  const onSubmit = handleSubmit(async (values) => {
    // O formulário trabalha em reais; o domínio, em centavos. A conversão é aqui.
    const amountCents = Math.round(Number(values.valor.replace(',', '.')) * 100);
    const payload: CreateBillRequest = {
      name: values.name,
      categoryId: values.categoryId,
      amountCents,
      dueDay: Number(values.dueDay),
    };

    const parsed = createBillRequestSchema.safeParse(payload);
    if (!parsed.success) {
      showError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
      return;
    }

    try {
      await createBill.mutateAsync(parsed.data);
      show('Conta cadastrada');
      reset();
      setFormOpen(false);
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para cadastrar.');
    }
  });

  if (isPending || !data) return <Spinner />;

  return (
    <div className="px-5 pt-[22px] pb-6">
      <MonthSwitcher
        month={month}
        onChange={setMonth}
        subtitle={`${formatMoney(data.paidCents)} pagas · ${formatMoney(data.dueCents)} a pagar`}
      />

      <Card>
        <CalendarGrid days={data.calendar} />
      </Card>

      <Card className="mt-3.5">
        <SectionHeader
          title="Contas do mês"
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
              <Input placeholder="Aluguel" {...register('name', { required: 'Informe o nome.' })} />
            </FormField>

            <FormField label="Categoria" error={errors.categoryId?.message}>
              <select
                {...register('categoryId', { required: 'Escolha uma categoria.' })}
                className="h-11 w-full rounded-xl border border-line bg-card px-3 text-sm"
              >
                <option value="">Selecione…</option>
                {expenseCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </FormField>

            <div className="flex gap-3">
              <FormField label="Valor (R$)" error={errors.valor?.message} className="flex-1">
                <Input
                  inputMode="decimal"
                  placeholder="1200,00"
                  {...register('valor', { required: 'Informe o valor.' })}
                />
              </FormField>
              <FormField label="Dia" error={errors.dueDay?.message} className="w-24">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  {...register('dueDay', { valueAsNumber: true })}
                />
              </FormField>
            </div>

            <Button type="submit" fullWidth loading={createBill.isPending}>
              Cadastrar conta
            </Button>
          </form>
        )}

        <ul className="mt-2">
          {data.bills.map((bill) => (
            <li
              key={bill.id}
              className="flex items-center gap-3 border-b border-line-soft py-3 last:border-0"
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={bill.paid}
                aria-label={`Marcar ${bill.name} como ${bill.paid ? 'não paga' : 'paga'}`}
                onClick={() => {
                  setPayment.mutate(
                    { id: bill.id, paid: !bill.paid },
                    {
                      onSuccess: () =>
                        show(bill.paid ? `${bill.name} voltou para a pagar` : `${bill.name} paga`),
                    },
                  );
                }}
                className={clsx(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-[13px] text-white transition-colors',
                  bill.paid ? 'border-green bg-green' : 'border-pebble bg-transparent',
                )}
              >
                {bill.paid ? '✓' : ''}
              </button>

              <div className="min-w-0 flex-1">
                <p className={clsx('truncate text-sm font-medium', bill.paid && 'text-muted')}>
                  {bill.name}
                </p>
                <p className="truncate text-[11.5px] text-muted">
                  {bill.paid ? 'pago' : `vence dia ${bill.dueDay}`} · {bill.category.name}
                </p>
              </div>

              <Money
                cents={bill.amountCents}
                hideCents={hideCents}
                className={clsx(
                  'font-display text-[15px] font-semibold',
                  bill.paid ? 'text-muted' : 'text-ink',
                )}
              />

              <button
                type="button"
                aria-label={`Excluir ${bill.name}`}
                onClick={() => setToDelete(bill.id)}
                className="px-1 text-muted transition-colors hover:text-clay"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog
        open={toDelete !== null}
        title="Excluir esta conta fixa?"
        description="O histórico de pagamentos dela também é removido."
        confirmLabel="Excluir"
        destructive
        loading={deleteBill.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteBill.mutateAsync(toDelete);
          setToDelete(null);
          show('Conta excluída');
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
