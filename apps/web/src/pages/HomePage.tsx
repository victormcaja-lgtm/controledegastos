import { Link } from 'react-router-dom';
import { formatMoney } from '@grana/shared';
import { Card } from '@/components/atoms/Card';
import { Money } from '@/components/atoms/Money';
import { Spinner } from '@/components/atoms/Spinner';
import { EmptyState } from '@/components/atoms/EmptyState';
import { MonthSwitcher } from '@/components/molecules/MonthSwitcher';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { StatCard } from '@/components/molecules/StatCard';
import { WeeklyChart } from '@/components/organisms/WeeklyChart';
import { useDashboard, useSettings } from '@/application/hooks/queries';
import { useMonth } from '@/application/month/useMonth';

export function HomePage() {
  const { month, setMonth } = useMonth();
  const { data, isPending, isError } = useDashboard(month);
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

  const negative = data.leftoverCents < 0;

  return (
    <div className="px-5 pt-[22px] pb-6">
      <MonthSwitcher
        month={month}
        onChange={setMonth}
        subtitle={data.isCurrentMonth ? 'mês atual' : 'previsão'}
      />

      {/* Cartão principal: o número que responde "posso gastar?" */}
      <Card padding="lg">
        <p className="text-[13px] text-muted">Deve sobrar no fim do mês</p>
        <Money
          cents={data.leftoverCents}
          hideCents={hideCents}
          className="mt-1.5 block font-display text-[46px] leading-[1.05] font-bold tracking-[-0.035em]"
        />
        <p className={`mt-1.5 text-[13px] ${negative ? 'text-clay' : 'text-green'}`}>
          {negative
            ? 'Atenção: as contas passam o que entra.'
            : data.isCurrentMonth
              ? 'Depois de pagar tudo que já está previsto.'
              : 'Previsão com as fixas + sua média de gastos.'}
        </p>

        {/* Barra composta: já gastei / a pagar / sobra */}
        <div
          className="mt-[18px] flex h-2.5 gap-0.5 overflow-hidden rounded-md bg-line-soft"
          role="img"
          aria-label={`Já gastei ${formatMoney(data.spentCents)}, a pagar ${formatMoney(
            data.billsDueCents,
          )}, sobra ${formatMoney(Math.max(0, data.leftoverCents))}`}
        >
          <div className="bg-ink" style={{ width: `${data.bars.spentPercent}%` }} />
          <div className="bg-stone" style={{ width: `${data.bars.duePercent}%` }} />
          <div className="bg-mint" style={{ width: `${data.bars.leftoverPercent}%` }} />
        </div>

        <div className="mt-3 flex flex-wrap gap-3.5 text-xs text-soft">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full bg-ink" />
            Já gastei <Money cents={data.spentCents} hideCents={hideCents} />
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full bg-stone" />
            A pagar <Money cents={data.billsDueCents} hideCents={hideCents} />
          </span>
        </div>
      </Card>

      <div className="mt-3.5 flex gap-3">
        <StatCard label="Entrou" cents={data.incomeCents} hideCents={hideCents} />
        {settings?.showDailyAllowance === false ? (
          <StatCard label="Pode gastar por dia" cents={0} muted />
        ) : (
          <StatCard
            label="Pode gastar por dia"
            cents={data.dailyAllowanceCents}
            hideCents={hideCents}
          />
        )}
      </div>

      <Card className="mt-3.5">
        <SectionHeader title="Suas semanas" aside="gasto por semana" />
        <WeeklyChart weeks={data.weeks} />
        <p className="mt-3.5 text-[12.5px] leading-relaxed text-soft">{data.weekNote}</p>
      </Card>

      <Card className="mt-3.5">
        <SectionHeader
          title="Vence em breve"
          aside={
            <Link to="/contas" className="text-green hover:underline">
              ver tudo
            </Link>
          }
        />

        {data.upcomingBills.length === 0 ? (
          <p className="py-4 text-[13px] text-muted">Nenhuma conta em aberto neste mês. 🎉</p>
        ) : (
          <ul className="mt-1">
            {data.upcomingBills.map((bill) => (
              <li
                key={bill.id}
                className="flex items-center gap-3 border-b border-line-soft py-[11px] last:border-0"
              >
                <div className="flex size-10 flex-col items-center justify-center rounded-xl bg-line-soft">
                  <span className="font-display text-sm leading-none font-bold">
                    {String(bill.dueDay).padStart(2, '0')}
                  </span>
                  <span className="text-[9px] text-muted uppercase">
                    {bill.dueDate.slice(5, 7)}
                  </span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{bill.name}</p>
                  <p className="text-[11.5px] text-muted">{bill.whenLabel}</p>
                </div>
                <Money
                  cents={bill.amountCents}
                  hideCents={hideCents}
                  className="font-display text-[15px] font-semibold"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
