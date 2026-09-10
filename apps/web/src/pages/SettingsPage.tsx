import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import type { SettingsDTO } from '@grana/shared';
import { Card } from '@/components/atoms/Card';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { Money } from '@/components/atoms/Money';
import { Toggle } from '@/components/atoms/Toggle';
import { Spinner } from '@/components/atoms/Spinner';
import { FormField } from '@/components/molecules/FormField';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { MoreTabs } from '@/components/organisms/MoreTabs';
import {
  useCreateIncome,
  useDeleteIncome,
  useIncomes,
  useSettings,
  useUpdateSettings,
} from '@/application/hooks/queries';
import { useAuthStore } from '@/application/auth/auth.store';
import { useToast } from '@/application/toast/ToastProvider';
import { ApiRequestError } from '@/infra/http/api-client';

const TOGGLES: Array<{ key: keyof SettingsDTO; title: string; description: string }> = [
  {
    key: 'overspendAlerts',
    title: 'Avisar quando eu estourar',
    description: 'Um toque quando uma categoria passa da média',
  },
  {
    key: 'weeklySummary',
    title: 'Resumo toda segunda',
    description: 'Quanto gastei na semana, em uma frase',
  },
  {
    key: 'roundCents',
    title: 'Arredondar centavos',
    description: 'Mostra R$ 214 no lugar de R$ 214,90',
  },
  {
    key: 'showDailyAllowance',
    title: 'Mostrar quanto posso gastar por dia',
    description: 'O segundo cartão da tela inicial',
  },
  {
    key: 'autoDarkMode',
    title: 'Modo noturno automático',
    description: 'Acompanha o sistema à noite',
  },
];

export function SettingsPage() {
  const { show, showError } = useToast();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const { data: settings, isPending } = useSettings();
  const { data: incomes } = useIncomes();
  const updateSettings = useUpdateSettings();
  const createIncome = useCreateIncome();
  const deleteIncome = useDeleteIncome();

  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const { register, handleSubmit, reset } = useForm<{
    name: string;
    valor: string;
    receiptDay: number;
  }>({
    defaultValues: { name: '', valor: '', receiptDay: 5 },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createIncome.mutateAsync({
        name: values.name,
        amountCents: Math.round(Number(values.valor.replace(',', '.')) * 100),
        receiptDay: Number(values.receiptDay),
      });
      show('Entrada cadastrada');
      reset();
      setFormOpen(false);
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para cadastrar.');
    }
  });

  if (isPending || !settings) {
    return (
      <div className="px-5 pt-[22px]">
        <MoreTabs />
        <Spinner />
      </div>
    );
  }

  return (
    <div className="px-5 pt-[22px] pb-6">
      <MoreTabs />

      <Card>
        <SectionHeader title="Suas entradas fixas" aside={`${incomes?.length ?? 0} cadastradas`} />

        <ul className="mt-2">
          {(incomes ?? []).map((income) => (
            <li
              key={income.id}
              className="flex items-center gap-3 border-b border-line-soft py-3 last:border-0"
            >
              <div className="flex-1">
                <p className="text-sm font-medium">{income.name}</p>
                <p className="text-[11.5px] text-muted">todo dia {income.receiptDay}</p>
              </div>
              <Money
                cents={income.amountCents}
                className="font-display text-[15px] font-semibold"
              />
              <button
                type="button"
                aria-label={`Remover ${income.name}`}
                onClick={() => setToDelete(income.id)}
                className="px-1 text-muted transition-colors hover:text-clay"
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          className="mt-3 text-[13px] font-medium text-green"
        >
          {formOpen ? 'fechar' : '+ nova entrada'}
        </button>

        {formOpen && (
          <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3">
            <FormField label="Nome">
              <Input placeholder="Salário" {...register('name', { required: true })} />
            </FormField>
            <div className="flex gap-3">
              <FormField label="Valor (R$)" className="flex-1">
                <Input
                  inputMode="decimal"
                  placeholder="4200,00"
                  {...register('valor', { required: true })}
                />
              </FormField>
              <FormField label="Dia" className="w-24">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  {...register('receiptDay', { valueAsNumber: true })}
                />
              </FormField>
            </div>
            <Button type="submit" fullWidth loading={createIncome.isPending}>
              Cadastrar
            </Button>
          </form>
        )}
      </Card>

      <Card className="mt-3.5">
        <SectionHeader title="Preferências" />
        <ul className="mt-2">
          {TOGGLES.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-4 border-b border-line-soft py-3.5 last:border-0"
            >
              <div className="flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-[11.5px] text-muted">{item.description}</p>
              </div>
              <Toggle
                label={item.title}
                checked={settings[item.key]}
                onChange={(value) => updateSettings.mutate({ [item.key]: value })}
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-3.5">
        <SectionHeader title="Conta" />
        <p className="mt-2 text-sm">{user?.name}</p>
        <p className="text-[11.5px] text-muted">{user?.email}</p>

        <div className="mt-4 flex flex-col gap-2">
          <Link to="/trocar-senha">
            <Button variant="secondary" fullWidth>
              Trocar minha senha
            </Button>
          </Link>

          {user?.role === 'ADMIN' && (
            <Link to="/admin/usuarios">
              <Button variant="secondary" fullWidth>
                Gerenciar usuários
              </Button>
            </Link>
          )}

          <Button variant="ghost" fullWidth onClick={() => void logout()}>
            Sair
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={toDelete !== null}
        title="Remover esta entrada?"
        description="Ela deixa de contar no cálculo do mês."
        confirmLabel="Remover"
        destructive
        loading={deleteIncome.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteIncome.mutateAsync(toDelete);
          setToDelete(null);
          show('Entrada removida');
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
