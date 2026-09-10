import { Card } from '@/components/atoms/Card';
import { Money } from '@/components/atoms/Money';
import { Spinner } from '@/components/atoms/Spinner';
import { EmptyState } from '@/components/atoms/EmptyState';
import { MonthSwitcher } from '@/components/molecules/MonthSwitcher';
import { MoreTabs } from '@/components/organisms/MoreTabs';
import { useCategoryReport, useSettings } from '@/application/hooks/queries';
import { useMonth } from '@/application/month/useMonth';

export function ReportPage() {
  const { month, setMonth } = useMonth();
  const { data, isPending } = useCategoryReport(month);
  const { data: settings } = useSettings();
  const hideCents = settings?.roundCents ?? false;

  return (
    <div className="px-5 pt-[22px] pb-6">
      <MoreTabs />
      <MonthSwitcher month={month} onChange={setMonth} />

      {isPending || !data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <EmptyState
          title="Sem gastos neste mês"
          description="Assim que houver lançamentos ou contas fixas, o relatório aparece aqui."
        />
      ) : (
        <>
          <Card>
            <p className="text-[13px] text-muted">
              Comprometido em {data.monthLabel.toLowerCase()}
            </p>
            <Money
              cents={data.totalCents}
              hideCents={hideCents}
              className="mt-1 block font-display text-[32px] font-bold tracking-[-0.03em]"
            />

            <ul className="mt-5 flex flex-col gap-3.5">
              {data.items.map((item) => (
                <li key={item.categoryId ?? item.name}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2.5 rounded-full"
                        style={{ background: item.color }}
                      />
                      {item.name}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <Money
                        cents={item.totalCents}
                        hideCents={hideCents}
                        className="font-display font-semibold"
                      />
                      <span className="w-9 text-right text-[11.5px] text-muted">
                        {item.percent}%
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line-soft">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${item.relativeWidth}%`, background: item.color }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="mt-3.5">
            <p className="text-[12.5px] leading-relaxed text-soft">{data.comparison}</p>
          </Card>
        </>
      )}
    </div>
  );
}
