import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  addMonths,
  currentMonthRef,
  formatMoney,
  parseBRLToCents,
  type CashflowMonth,
} from '@grana/shared';
import { Button } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Input } from '@/components/atoms/Input';
import { Money } from '@/components/atoms/Money';
import { Spinner } from '@/components/atoms/Spinner';
import { MoreTabs } from '@/components/organisms/MoreTabs';
import { useCashflow, useDepositToGoal, useGoals, useSettings } from '@/application/hooks/queries';
import { useToast } from '@/application/toast/ToastProvider';
import { lastDayOfMonthISO } from '@/application/dates';
import { ApiRequestError } from '@/infra/http/api-client';

const MONTHS_BACK = 5;

/**
 * Resultado de cada mês: entrou, saiu, guardou e o lucro ou prejuízo. O saldo
 * final de um mês é o inicial do seguinte — a sobra nunca se perde.
 */
export function ResultPage() {
  const current = currentMonthRef();
  const from = `${addMonths(current, -MONTHS_BACK)}-01`;
  const to = lastDayOfMonthISO(`${addMonths(current, 1)}-01`);
  const { data, isPending } = useCashflow(from, to);
  const { data: settings } = useSettings();
  const hideCents = settings?.roundCents ?? false;

  return (
    <div className="px-5 pt-[22px] pb-6">
      <MoreTabs />

      {isPending ? (
        <Spinner />
      ) : !data?.configured ? (
        <EmptyState
          title="Informe seu saldo primeiro"
          description="Na tela inicial, diga quanto você tem hoje na conta para ver o resultado dos meses."
        />
      ) : data.months.length === 0 ? (
        <EmptyState title="Ainda não há meses para mostrar" />
      ) : (
        <div className="flex flex-col gap-3.5">
          {[...data.months].reverse().map((month) => (
            <MonthCard key={month.month} month={month} current={current} hideCents={hideCents} />
          ))}
        </div>
      )}
    </div>
  );
}

function MonthCard({
  month,
  current,
  hideCents,
}: {
  month: CashflowMonth;
  current: string;
  hideCents: boolean;
}) {
  const [saveOpen, setSaveOpen] = useState(false);
  const status = month.closed ? 'fechado' : month.month === current ? 'em andamento' : 'previsto';
  const positive = month.resultCents >= 0;
  const leftover = Math.max(0, month.resultCents - month.savedCents);
  const canSave = month.month <= current && leftover > 0;

  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-[15px] font-semibold">{month.label}</h2>
        <span
          className={clsx(
            'rounded-full px-2 py-0.5 text-[11px]',
            month.closed ? 'bg-line-soft text-soft' : 'bg-mint/30 text-green',
          )}
        >
          {status}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-y-2 text-[13px]">
        <dt className="text-muted">Começou com</dt>
        <dd className="text-right">
          <Money cents={month.openingCents} hideCents={hideCents} />
        </dd>
        <dt className="text-muted">Entrou</dt>
        <dd className="text-right text-green">
          <Money cents={month.inCents} hideCents={hideCents} signed />
        </dd>
        <dt className="text-muted">Saiu</dt>
        <dd className="text-right">
          <Money cents={-month.outCents} hideCents={hideCents} />
        </dd>
        {month.savedCents > 0 && (
          <>
            <dt className="text-muted">Guardado em metas</dt>
            <dd className="text-right">
              <Money cents={-month.savedCents} hideCents={hideCents} />
            </dd>
          </>
        )}
        <dt className="border-t border-line-soft pt-2 font-medium">
          {positive ? 'Sobrou no mês' : 'Faltou no mês'}
        </dt>
        <dd
          className={clsx(
            'border-t border-line-soft pt-2 text-right font-display font-semibold',
            positive ? 'text-green' : 'text-clay',
          )}
        >
          <Money cents={month.resultCents} hideCents={hideCents} signed />
        </dd>
        <dt className="text-muted">Saldo no fim</dt>
        <dd className="text-right font-medium">
          <Money cents={month.closingCents} hideCents={hideCents} />
        </dd>
      </dl>

      {canSave && (
        <>
          <button
            type="button"
            onClick={() => setSaveOpen((open) => !open)}
            className="mt-3 text-[13px] font-medium text-green"
          >
            {saveOpen ? 'fechar' : `guardar a sobra (${formatMoney(leftover, { hideCents })})`}
          </button>
          {saveOpen && <SaveLeftover suggested={leftover} onDone={() => setSaveOpen(false)} />}
        </>
      )}
    </Card>
  );
}

/** Manda parte da sobra para uma meta — o valor sai do saldo e entra no guardado. */
function SaveLeftover({ suggested, onDone }: { suggested: number; onDone: () => void }) {
  const { show, showError } = useToast();
  const { data: goals } = useGoals();
  const deposit = useDepositToGoal();
  const [goalId, setGoalId] = useState('');
  const [value, setValue] = useState((suggested / 100).toFixed(2).replace('.', ','));

  if (goals && goals.length === 0) {
    return (
      <p className="mt-2 text-[13px] text-soft">
        Crie uma meta em{' '}
        <Link to="/guardar" className="text-green hover:underline">
          Guardar
        </Link>{' '}
        para mandar a sobra para lá.
      </p>
    );
  }

  const selected = goalId || goals?.[0]?.id || '';

  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const cents = parseBRLToCents(value);
        if (!cents || cents <= 0 || !selected) {
          showError('Escolha a meta e o valor.');
          return;
        }
        try {
          await deposit.mutateAsync({ id: selected, amountCents: cents });
          show(`${formatMoney(cents)} guardados`);
          onDone();
        } catch (error) {
          showError(error instanceof ApiRequestError ? error.message : 'Não deu para guardar.');
        }
      }}
    >
      <select
        aria-label="Meta"
        value={selected}
        onChange={(event) => setGoalId(event.target.value)}
        className="h-11 w-full rounded-xl border border-line bg-card px-3 text-sm"
      >
        {(goals ?? []).map((goal) => (
          <option key={goal.id} value={goal.id}>
            {goal.name}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Input
          inputMode="decimal"
          aria-label="Valor a guardar"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" loading={deposit.isPending}>
          Guardar
        </Button>
      </div>
    </form>
  );
}
