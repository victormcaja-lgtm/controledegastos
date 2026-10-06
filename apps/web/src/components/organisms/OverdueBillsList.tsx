import { useState } from 'react';
import { formatMoney, monthNameShort, parseBRLToCents, type OverdueBill } from '@grana/shared';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { Money } from '@/components/atoms/Money';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { useSettleBill } from '@/application/hooks/queries';
import { useToast } from '@/application/toast/ToastProvider';
import { shortDate } from '@/application/dates';
import { ApiRequestError } from '@/infra/http/api-client';

export interface OverdueBillsListProps {
  bills: OverdueBill[];
  hideCents?: boolean;
}

/**
 * Contas vencidas e não pagas. Elas ACUMULAM: continuam aqui (e puxando o
 * saldo para baixo) até receber baixa ou um "não vou pagar".
 */
export function OverdueBillsList({ bills, hideCents = false }: OverdueBillsListProps) {
  const { show, showError } = useToast();
  const settle = useSettleBill();
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [customValue, setCustomValue] = useState('');
  const [toWaive, setToWaive] = useState<OverdueBill | null>(null);

  const keyOf = (bill: OverdueBill) => `${bill.billId}|${bill.month}`;

  async function pay(bill: OverdueBill, amountCents?: number) {
    try {
      await settle.mutateAsync({
        id: bill.billId,
        month: bill.month,
        ...(amountCents ? { amountCents } : {}),
      });
      show(`${bill.name} de ${monthNameShort(bill.month)} paga`);
      setCustomFor(null);
      setCustomValue('');
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para dar baixa.');
    }
  }

  return (
    <>
      <ul className="mt-1">
        {bills.map((bill) => {
          const key = keyOf(bill);
          return (
            <li key={key} className="border-b border-line-soft py-3 last:border-0">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-xl bg-clay/15 text-clay">
                  <span className="font-display text-sm leading-none font-bold">
                    {bill.dueDate.slice(8, 10)}
                  </span>
                  <span className="text-[9px] uppercase">{monthNameShort(bill.month)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {bill.name}
                    {bill.totalInstallments !== null && (
                      <span className="ml-1.5 text-[11px] font-normal text-faint">
                        · {bill.installmentNumber}/{bill.totalInstallments}
                      </span>
                    )}
                  </p>
                  <p className="text-[11.5px] text-clay">
                    venceu {shortDate(bill.dueDate)} · {bill.daysLate} dia
                    {bill.daysLate === 1 ? '' : 's'} de atraso
                  </p>
                </div>
                <Money
                  cents={bill.amountCents}
                  hideCents={hideCents}
                  className="font-display text-[15px] font-semibold"
                />
              </div>

              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  loading={settle.isPending && settle.variables?.id === bill.billId}
                  onClick={() => void pay(bill)}
                >
                  Paguei {formatMoney(bill.amountCents, { hideCents })}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCustomFor(customFor === key ? null : key)}
                >
                  Outro valor
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setToWaive(bill)}>
                  Não vou pagar
                </Button>
              </div>

              {customFor === key && (
                <form
                  className="mt-2.5 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const cents = parseBRLToCents(customValue);
                    if (!cents || cents <= 0) {
                      showError('Informe o valor pago.');
                      return;
                    }
                    void pay(bill, cents);
                  }}
                >
                  <Input
                    inputMode="decimal"
                    placeholder="Valor com juros (R$)"
                    aria-label={`Valor pago de ${bill.name}`}
                    value={customValue}
                    onChange={(event) => setCustomValue(event.target.value)}
                  />
                  <Button type="submit" loading={settle.isPending}>
                    Salvar
                  </Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={toWaive !== null}
        title={toWaive ? `Não vai pagar ${toWaive.name}?` : ''}
        description="A conta deste mês sai do atraso e da previsão sem mexer no seu saldo. Use para conta negociada ou cancelada."
        confirmLabel="Não vou pagar"
        loading={settle.isPending}
        onConfirm={async () => {
          if (!toWaive) return;
          try {
            await settle.mutateAsync({ id: toWaive.billId, month: toWaive.month, waived: true });
            show(`${toWaive.name} dispensada`);
          } catch (error) {
            showError(error instanceof ApiRequestError ? error.message : 'Não deu para salvar.');
          } finally {
            setToWaive(null);
          }
        }}
        onCancel={() => setToWaive(null)}
      />
    </>
  );
}
