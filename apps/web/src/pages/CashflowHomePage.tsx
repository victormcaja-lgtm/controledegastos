import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { formatMoney, parseBRLToCents, type CashflowEvent } from '@grana/shared';
import { Button } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { Input } from '@/components/atoms/Input';
import { Money } from '@/components/atoms/Money';
import { Spinner } from '@/components/atoms/Spinner';
import { EmptyState } from '@/components/atoms/EmptyState';
import { FormField } from '@/components/molecules/FormField';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { StatCard } from '@/components/molecules/StatCard';
import { BalanceChart } from '@/components/organisms/BalanceChart';
import { OverdueBillsList } from '@/components/organisms/OverdueBillsList';
import { useCashflow, useSettings, useUpdateSettings } from '@/application/hooks/queries';
import { useToast } from '@/application/toast/ToastProvider';
import { addDaysISO, dayLabel, localTodayISO, shortDate } from '@/application/dates';
import { ApiRequestError } from '@/infra/http/api-client';

const PAST_DAYS = 14;
const AHEAD_DAYS = 60;

/**
 * Tela inicial do saldo futuro: quanto tenho HOJE, quanto vou ter no fim do
 * mês e qual o dia mais apertado pela frente. Sem "fechar mês" — o saldo
 * continua de um mês para o outro.
 */
export function CashflowHomePage() {
  const today = localTodayISO();
  const from = addDaysISO(today, -PAST_DAYS);
  const to = addDaysISO(today, AHEAD_DAYS);

  const { data, isPending, isError } = useCashflow(from, to);
  const { data: settings } = useSettings();
  const hideCents = settings?.roundCents ?? false;

  if (isPending) return <Spinner />;
  if (isError || !data) {
    return (
      <EmptyState
        title="Não deu para carregar"
        description="Verifique sua conexão e tente de novo."
      />
    );
  }

  if (!data.configured) return <OpeningBalanceForm today={today} />;

  const upcoming = data.days
    .filter((day) => day.date > today && day.date <= addDaysISO(today, 7))
    .flatMap((day) =>
      day.events
        .filter((event) => event.kind !== 'DAILY_AVERAGE')
        .map((event) => ({ ...event, date: day.date })),
    );

  const negativeToday = data.todayBalanceCents < 0;

  return (
    <div className="px-5 pt-[22px] pb-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-display text-[22px] font-bold tracking-[-0.02em]">Seu saldo</h1>
        <Link to="/diario" className="text-[13px] font-medium text-green hover:underline">
          ver diário
        </Link>
      </div>

      <Card padding="lg">
        <p className="text-[13px] text-muted">Tenho hoje</p>
        <Money
          cents={data.todayBalanceCents}
          hideCents={hideCents}
          className={clsx(
            'mt-1.5 block font-display text-[46px] leading-[1.05] font-bold tracking-[-0.035em]',
            negativeToday && 'text-clay',
          )}
        />
        <p
          className={clsx(
            'mt-1.5 text-[13px]',
            data.firstNegativeDate ? 'text-clay' : 'text-green',
          )}
        >
          {data.firstNegativeDate
            ? `Atenção: pelo previsto, o saldo fica negativo em ${shortDate(data.firstNegativeDate)}.`
            : 'Pelo previsto, seu saldo não fica negativo nos próximos 60 dias.'}
        </p>

        <BalanceChart days={data.days} today={today} highlight={data.lowest} />
      </Card>

      <div className="mt-3.5 flex gap-3">
        <StatCard label="No fim do mês" cents={data.endOfMonthCents} hideCents={hideCents} />
        <StatCard
          label={data.lowest ? `Menor saldo (${shortDate(data.lowest.date)})` : 'Menor saldo'}
          cents={data.lowest?.balanceCents ?? data.todayBalanceCents}
          hideCents={hideCents}
        />
      </div>

      {data.overdueBills.length > 0 && (
        <Card className="mt-3.5 border-clay/40">
          <SectionHeader
            title="Em atraso"
            aside={
              <span className="text-clay">
                {formatMoney(
                  data.overdueBills.reduce((sum, bill) => sum + bill.amountCents, 0),
                  { hideCents },
                )}
              </span>
            }
          />
          <p className="mt-1 text-[12.5px] leading-relaxed text-soft">
            Conta não paga não some: ela acumula e já está descontada da sua previsão.
          </p>
          <OverdueBillsList bills={data.overdueBills} hideCents={hideCents} />
        </Card>
      )}

      <Card className="mt-3.5">
        <SectionHeader
          title="Próximos 7 dias"
          aside={
            <Link to="/posso-comprar" className="text-green hover:underline">
              posso comprar?
            </Link>
          }
        />
        {upcoming.length === 0 ? (
          <p className="py-4 text-[13px] text-muted">Nada previsto para esta semana.</p>
        ) : (
          <ul className="mt-1">
            {upcoming.map((event, index) => (
              <UpcomingRow
                key={`${event.date}-${index}`}
                event={event}
                today={today}
                hideCents={hideCents}
              />
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-4 px-1 text-[12px] leading-relaxed text-muted">
        A previsão considera entradas fixas, contas, faturas
        {data.dailyAverageCents > 0
          ? ` e um gasto médio de ${formatMoney(data.dailyAverageCents, { hideCents })} por dia`
          : ''}
        .{' '}
        <Link to="/ajustes" className="text-green hover:underline">
          Ajustar
        </Link>
      </p>
    </div>
  );
}

function UpcomingRow({
  event,
  today,
  hideCents,
}: {
  event: CashflowEvent & { date: string };
  today: string;
  hideCents: boolean;
}) {
  const income = event.amountCents > 0;
  return (
    <li className="flex items-center gap-3 border-b border-line-soft py-[11px] last:border-0">
      <div className="flex size-10 flex-col items-center justify-center rounded-xl bg-line-soft">
        <span className="font-display text-sm leading-none font-bold">
          {event.date.slice(8, 10)}
        </span>
        <span className="text-[9px] text-muted uppercase">{event.date.slice(5, 7)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{event.label}</p>
        <p className="text-[11.5px] text-muted">{dayLabel(event.date, today)}</p>
      </div>
      <Money
        cents={event.amountCents}
        hideCents={hideCents}
        signed={income}
        className={clsx('font-display text-[15px] font-semibold', income && 'text-green')}
      />
    </li>
  );
}

/** Primeiro acesso: sem saldo inicial não existe saldo futuro. */
function OpeningBalanceForm({ today }: { today: string }) {
  const { show, showError } = useToast();
  const update = useUpdateSettings();
  const [value, setValue] = useState('');

  async function save() {
    const cents = parseBRLToCents(value);
    if (cents === null) {
      showError('Digite quanto você tem na conta, por exemplo 1.250,00.');
      return;
    }
    try {
      await update.mutateAsync({ openingBalanceCents: cents, openingDate: today });
      show('Pronto! Seu saldo futuro está ligado.');
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para salvar.');
    }
  }

  return (
    <div className="px-5 pt-[22px] pb-6">
      <Card padding="lg">
        <h1 className="font-display text-[22px] font-bold tracking-[-0.02em]">
          Quanto você tem hoje na conta?
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-soft">
          A partir desse número o Grana mostra seu saldo dia a dia: o que já aconteceu e o que vem
          por aí (salário, contas, faturas). O que sobrar num mês passa para o seguinte, e conta não
          paga fica acumulando até você pagar.
        </p>

        <form
          className="mt-5 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FormField
            label="Saldo atual (R$)"
            hint="Some suas contas correntes. Se estiver no cheque especial, use o sinal de menos."
          >
            <Input
              inputMode="decimal"
              placeholder="1.250,00"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
          </FormField>
          <Button type="submit" size="lg" fullWidth loading={update.isPending}>
            Começar
          </Button>
          <p className="text-[11.5px] leading-relaxed text-muted">
            Lançamentos e contas de hoje em diante entram na conta. O que venceu antes de hoje já
            está dentro desse saldo.
          </p>
        </form>
      </Card>
    </div>
  );
}
