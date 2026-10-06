import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  formatMoney,
  parseBRLToCents,
  type BooleanSettingKey,
  type CategoryKind,
  type SettingsDTO,
} from '@grana/shared';
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
  useCategories,
  useCreateCategory,
  useCreateIncome,
  useDeleteCategory,
  useDeleteIncome,
  useIncomes,
  useSettings,
  useUpdateCategory,
  useUpdateSettings,
} from '@/application/hooks/queries';
import { useAuthStore } from '@/application/auth/auth.store';
import { useToast } from '@/application/toast/ToastProvider';
import { ApiRequestError } from '@/infra/http/api-client';
import { localTodayISO } from '@/application/dates';
import { features } from '@/config/env';

const TOGGLES: Array<{ key: BooleanSettingKey; title: string; description: string }> = [
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
  const { data: categories } = useCategories();
  const updateSettings = useUpdateSettings();
  const createIncome = useCreateIncome();
  const deleteIncome = useDeleteIncome();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null);

  const { register, handleSubmit, reset } = useForm<{
    name: string;
    valor: string;
    receiptDay: number;
  }>({
    defaultValues: { name: '', valor: '', receiptDay: 5 },
  });

  const {
    register: registerCategory,
    handleSubmit: handleSubmitCategory,
    reset: resetCategory,
  } = useForm<{ name: string; kind: CategoryKind }>({
    defaultValues: { name: '', kind: 'EXPENSE' },
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

  const onSubmitCategory = handleSubmitCategory(async (values) => {
    try {
      await createCategory.mutateAsync({ name: values.name, kind: values.kind });
      show('Categoria cadastrada');
      resetCategory();
      setCategoryFormOpen(false);
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para cadastrar.');
    }
  });

  async function archiveCategory(id: string, name: string) {
    try {
      await updateCategory.mutateAsync({ id, data: { archived: true } });
      show(`${name} arquivada`);
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para arquivar.');
    }
  }

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
        <SectionHeader title="Categorias" aside={`${categories?.length ?? 0} cadastradas`} />

        <ul className="mt-2">
          {(categories ?? []).map((category) => (
            <li
              key={category.id}
              className="flex items-center gap-3 border-b border-line-soft py-3 last:border-0"
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: category.color }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{category.name}</p>
                <p className="text-[11.5px] text-muted">
                  {category.kind === 'EXPENSE' ? 'despesa' : 'receita'}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => void archiveCategory(category.id, category.name)}
                  className="text-[12.5px] font-medium text-soft transition-colors hover:text-ink"
                >
                  arquivar
                </button>
                {!category.isSystem && (
                  <button
                    type="button"
                    aria-label={`Excluir ${category.name}`}
                    onClick={() => setCategoryToDelete(category.id)}
                    className="px-1 text-muted transition-colors hover:text-clay"
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => setCategoryFormOpen((open) => !open)}
          className="mt-3 text-[13px] font-medium text-green"
        >
          {categoryFormOpen ? 'fechar' : '+ nova categoria'}
        </button>

        {categoryFormOpen && (
          <form onSubmit={onSubmitCategory} className="mt-3 flex flex-col gap-3">
            <FormField label="Nome">
              <Input placeholder="Farmácia" {...registerCategory('name', { required: true })} />
            </FormField>
            <FormField label="Tipo">
              <select
                {...registerCategory('kind')}
                className="h-11 w-full rounded-xl border border-line bg-card px-3 text-sm"
              >
                <option value="EXPENSE">Despesa</option>
                <option value="INCOME">Receita</option>
              </select>
            </FormField>
            <Button type="submit" fullWidth loading={createCategory.isPending}>
              Cadastrar
            </Button>
          </form>
        )}
      </Card>

      {features.saldoFuturo && <OpeningBalanceCard settings={settings} />}

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

      <ConfirmDialog
        open={categoryToDelete !== null}
        title="Excluir esta categoria?"
        description="Só é possível excluir categorias sem nenhum lançamento ou conta usando elas."
        confirmLabel="Excluir"
        destructive
        loading={deleteCategory.isPending}
        onConfirm={async () => {
          if (!categoryToDelete) return;
          try {
            await deleteCategory.mutateAsync(categoryToDelete);
            show('Categoria excluída');
          } catch (error) {
            showError(error instanceof ApiRequestError ? error.message : 'Não deu para excluir.');
          } finally {
            setCategoryToDelete(null);
          }
        }}
        onCancel={() => setCategoryToDelete(null)}
      />
    </div>
  );
}

/** Ponto de partida do saldo futuro e o gasto médio usado na previsão. */
function OpeningBalanceCard({ settings }: { settings: SettingsDTO }) {
  const { show, showError } = useToast();
  const updateSettings = useUpdateSettings();
  const toReais = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

  const { register, handleSubmit } = useForm<{ saldo: string; data: string; media: string }>({
    defaultValues: {
      saldo: toReais(settings.openingBalanceCents),
      data: settings.openingDate ?? localTodayISO(),
      media: settings.dailyBudgetCents === null ? '' : toReais(settings.dailyBudgetCents),
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const openingBalanceCents = parseBRLToCents(values.saldo);
    const dailyBudgetCents = values.media.trim() ? parseBRLToCents(values.media) : null;
    if (openingBalanceCents === null || (values.media.trim() && dailyBudgetCents === null)) {
      showError('Confira os valores — use o formato 1.250,00.');
      return;
    }
    try {
      await updateSettings.mutateAsync({
        openingBalanceCents,
        openingDate: values.data,
        dailyBudgetCents: dailyBudgetCents === null ? null : Math.max(0, dailyBudgetCents),
      });
      show('Saldo atualizado');
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para salvar.');
    }
  });

  return (
    <Card className="mt-3.5">
      <SectionHeader
        title="Saldo futuro"
        aside={
          settings.openingDate
            ? `desde ${settings.openingDate.split('-').reverse().join('/')}`
            : 'não configurado'
        }
      />
      <p className="mt-1 text-[12.5px] leading-relaxed text-soft">
        Tudo o que aconteceu antes dessa data já está dentro do saldo. Se o saldo do app se afastar
        do banco, informe o valor de hoje para recomeçar daqui.
      </p>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3">
        <div className="flex gap-3">
          <FormField label="Saldo (R$)" className="flex-1">
            <Input inputMode="decimal" {...register('saldo', { required: true })} />
          </FormField>
          <FormField label="No início do dia" className="flex-1">
            <Input type="date" max={localTodayISO()} {...register('data', { required: true })} />
          </FormField>
        </div>
        <FormField
          label="Gasto médio por dia (R$)"
          hint={`Deixe vazio para calcular pelos seus lançamentos dos últimos 90 dias. Ex.: ${formatMoney(5000)}.`}
        >
          <Input inputMode="decimal" placeholder="automático" {...register('media')} />
        </FormField>
        <Button type="submit" fullWidth loading={updateSettings.isPending}>
          Salvar saldo
        </Button>
      </form>
    </Card>
  );
}
