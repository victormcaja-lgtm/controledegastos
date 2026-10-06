import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { formatMoney, type CashflowDay, type CashflowEvent } from '@grana/shared';
import { Button } from '@/components/atoms/Button';
import { Money } from '@/components/atoms/Money';
import { Spinner } from '@/components/atoms/Spinner';
import { EmptyState } from '@/components/atoms/EmptyState';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { useCashflow, useDeleteTransaction, useSettings } from '@/application/hooks/queries';
import { useToast } from '@/application/toast/ToastProvider';
import { addDaysISO, dayLabel, localTodayISO } from '@/application/dates';

const STEP_DAYS = 30;
// A API aceita até 400 dias por consulta: 300 para trás + 90 para frente.
const MAX_PAST_DAYS = 300;
const MAX_AHEAD_DAYS = 90;

const KIND_LABEL: Partial<Record<CashflowEvent['kind'], string>> = {
  INCOME: 'entrada fixa',
  BILL: 'conta fixa',
  BILL_OVERDUE: 'em atraso',
  CARD_INVOICE: 'fatura',
  GOAL_DEPOSIT: 'meta',
};

/**
 * Diário: o dinheiro dia a dia, com o saldo ao fim de cada dia. O que já
 * aconteceu embaixo, o que vem por aí em cima — e hoje no meio.
 */
export function DiaryPage() {
  const today = localTodayISO();
  const [pastDays, setPastDays] = useState(STEP_DAYS);
  const [aheadDays, setAheadDays] = useState(STEP_DAYS);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const { show } = useToast();
  const { data: settings } = useSettings();
  const remove = useDeleteTransaction();
  const { data, isPending, isFetching } = useCashflow(
    addDaysISO(today, -pastDays),
    addDaysISO(today, aheadDays),
  );
  const hideCents = settings?.roundCents ?? false;

  if (isPending) return <Spinner />;
  if (!data) return null;

  if (!data.configured) {
    return (
      <EmptyState
        title="Informe seu saldo primeiro"
        description="Na tela inicial, diga quanto você tem hoje na conta para o diário começar."
      />
    );
  }

  const todayDay = data.days.find((day) => day.date === today);
  const ahead = data.days.filter(
    (day) => day.date > today && day.events.some((event) => event.kind !== 'DAILY_AVERAGE'),
  );
  const past = data.days
    .filter((day) => day.date < today && day.events.length > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const reachedOpening = data.openingDate !== null && data.days[0]?.date === data.openingDate;

  return (
    <div className="px-5 pt-[22px] pb-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-display text-[22px] font-bold tracking-[-0.02em]">Diário</h1>
        <Link to="/lancar" className="text-[13px] font-medium text-green hover:underline">
          + lançar
        </Link>
      </div>

      {data.dailyAverageCents > 0 && (
        <p className="mb-3 text-[12px] text-muted">
          Os dias à frente já descontam o gasto médio de{' '}
          {formatMoney(data.dailyAverageCents, { hideCents })} por dia.
        </p>
      )}

      <Section title="Vem por aí">
        {ahead.length === 0 ? (
          <p className="px-1 text-[13px] text-muted">Nada previsto no período.</p>
        ) : (
          ahead.map((day) => (
            <DayCard key={day.date} day={day} today={today} hideCents={hideCents} />
          ))
        )}
        {aheadDays < MAX_AHEAD_DAYS && (
          <Button
            variant="ghost"
            size="sm"
            loading={isFetching}
            onClick={() => setAheadDays((value) => Math.min(value + STEP_DAYS, MAX_AHEAD_DAYS))}
          >
            ver mais à frente
          </Button>
        )}
      </Section>

      {todayDay && (
        <DayCard
          day={todayDay}
          today={today}
          hideCents={hideCents}
          highlight
          onDelete={setToDelete}
        />
      )}

      <Section title="Já aconteceu">
        {past.length === 0 ? (
          <p className="px-1 text-[13px] text-muted">Nenhum lançamento no período.</p>
        ) : (
          past.map((day) => (
            <DayCard
              key={day.date}
              day={day}
              today={today}
              hideCents={hideCents}
              onDelete={setToDelete}
            />
          ))
        )}
        {!reachedOpening && pastDays < MAX_PAST_DAYS && (
          <Button
            variant="ghost"
            size="sm"
            loading={isFetching}
            onClick={() => setPastDays((value) => Math.min(value + STEP_DAYS, MAX_PAST_DAYS))}
          >
            carregar dias anteriores
          </Button>
        )}
      </Section>

      <ConfirmDialog
        open={toDelete !== null}
        title="Apagar este lançamento?"
        description="Ele sai do saldo e dos relatórios. Não dá para desfazer."
        confirmLabel="Apagar"
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          await remove.mutateAsync(toDelete);
          setToDelete(null);
          show('Lançamento apagado');
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="my-4 flex flex-col gap-3">
      <h2 className="px-1 text-[12px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function DayCard({
  day,
  today,
  hideCents,
  highlight = false,
  onDelete,
}: {
  day: CashflowDay;
  today: string;
  hideCents: boolean;
  highlight?: boolean;
  onDelete?: (transactionId: string) => void;
}) {
  const events = day.events.filter((event) => event.kind !== 'DAILY_AVERAGE');
  const negative = day.balanceCents < 0;

  return (
    <article
      className={clsx(
        'rounded-[22px] border px-5 py-4',
        highlight ? 'border-ink bg-card' : 'border-line bg-card',
        day.projected && 'opacity-80',
      )}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-sm font-semibold">{dayLabel(day.date, today)}</h3>
        <span className="text-[11.5px] text-muted">
          saldo{' '}
          <Money
            cents={day.balanceCents}
            hideCents={hideCents}
            className={clsx('font-semibold', negative ? 'text-clay' : 'text-ink')}
          />
        </span>
      </header>

      {events.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-muted">Nada lançado hoje ainda.</p>
      ) : (
        <ul className="mt-1">
          {events.map((event, index) => {
            const income = event.amountCents > 0;
            return (
              <li
                key={`${event.kind}-${event.refId ?? 'x'}-${index}`}
                className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={clsx(
                      'truncate text-sm font-medium',
                      event.kind === 'BILL_OVERDUE' && 'text-clay',
                    )}
                  >
                    {event.label}
                  </p>
                  <p className="text-[11px] text-muted">
                    {event.projected ? 'previsto' : 'realizado'}
                    {KIND_LABEL[event.kind] ? ` · ${KIND_LABEL[event.kind]}` : ''}
                  </p>
                </div>
                <Money
                  cents={event.amountCents}
                  hideCents={hideCents}
                  signed={income}
                  className={clsx(
                    'font-display text-[15px] font-semibold',
                    income ? 'text-green' : 'text-ink',
                  )}
                />
                {onDelete && event.kind === 'TRANSACTION' && event.refId && (
                  <button
                    type="button"
                    aria-label={`Apagar ${event.label}`}
                    onClick={() => onDelete(event.refId!)}
                    className="px-1 text-muted transition-colors hover:text-clay"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
