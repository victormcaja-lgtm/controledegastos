import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  formatMoney,
  parseBRLToCents,
  type PaymentMethod,
  type SimulationResult,
} from '@grana/shared';
import { Button } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { Chip } from '@/components/atoms/Chip';
import { Input } from '@/components/atoms/Input';
import { FormField } from '@/components/molecules/FormField';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { StatCard } from '@/components/molecules/StatCard';
import { BalanceChart } from '@/components/organisms/BalanceChart';
import {
  useCards,
  useCategories,
  useCreateCardPurchase,
  useCreateTransaction,
  useSettings,
  useSimulatePurchase,
} from '@/application/hooks/queries';
import { useToast } from '@/application/toast/ToastProvider';
import { addDaysISO, localTodayISO, shortDate } from '@/application/dates';
import { ApiRequestError } from '@/infra/http/api-client';

/**
 * "Posso comprar?": mostra o impacto de uma compra no saldo ANTES de ela
 * acontecer — o menor saldo pela frente, com e sem a compra.
 */
export function SimulatePage() {
  const navigate = useNavigate();
  const today = localTodayISO();
  const { show, showError } = useToast();
  const { data: cards } = useCards();
  const { data: categories } = useCategories();
  const { data: settings } = useSettings();
  const simulate = useSimulatePurchase();
  const createTransaction = useCreateTransaction();
  const createPurchase = useCreateCardPurchase();
  const hideCents = settings?.roundCents ?? false;

  const [value, setValue] = useState('');
  const [installments, setInstallments] = useState(1);
  const [method, setMethod] = useState<PaymentMethod>('ACCOUNT');
  const [cardId, setCardId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);

  const activeCards = (cards ?? []).filter((card) => card.active);
  const expenseCategories = useMemo(
    () => (categories ?? []).filter((c) => c.kind === 'EXPENSE' && !c.archivedAt),
    [categories],
  );
  const selectedCategory = categoryId ?? expenseCategories[0]?.id ?? null;
  const amountCents = parseBRLToCents(value);

  async function run() {
    if (!amountCents || amountCents <= 0) {
      showError('Digite o valor da compra.');
      return;
    }
    if (method === 'CARD' && !cardId) {
      showError('Escolha o cartão.');
      return;
    }
    // Parcelado vai longe: mostra pelo menos até a última parcela (limite da API: 400 dias).
    const horizon = Math.min(395, Math.max(90, installments * 31 + 40));
    try {
      const response = await simulate.mutateAsync({
        from: today,
        to: addDaysISO(today, horizon),
        today,
        amountCents,
        installments,
        date,
        method,
        ...(method === 'CARD' && cardId ? { cardId } : {}),
      });
      setResult(response);
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para simular.');
    }
  }

  async function confirm() {
    if (!amountCents || !selectedCategory) return;
    try {
      if (method === 'CARD' && cardId) {
        await createPurchase.mutateAsync({
          cardId,
          data: {
            amountCents,
            installments,
            purchasedOn: date,
            categoryId: selectedCategory,
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        });
      } else {
        await createTransaction.mutateAsync({
          type: 'EXPENSE',
          amountCents,
          categoryId: selectedCategory,
          occurredOn: date,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      }
      show(`Compra de ${formatMoney(amountCents)} registrada`);
      navigate('/');
    } catch (error) {
      showError(error instanceof ApiRequestError ? error.message : 'Não deu para registrar.');
    }
  }

  const canConfirm = method === 'CARD' || installments === 1;

  return (
    <div className="px-5 pt-[22px] pb-6">
      <h1 className="mb-1 font-display text-[22px] font-bold tracking-[-0.02em]">Posso comprar?</h1>
      <p className="mb-4 text-[13px] text-soft">
        Veja como a compra mexe no seu saldo antes de passar o cartão.
      </p>

      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <div className="flex gap-3">
            <FormField label="Valor (R$)" className="flex-1">
              <Input
                inputMode="decimal"
                placeholder="1.200,00"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setResult(null);
                }}
              />
            </FormField>
            <FormField label="Parcelas" className="w-24">
              <Input
                type="number"
                min={1}
                max={48}
                value={installments}
                onChange={(event) => {
                  setInstallments(Math.min(48, Math.max(1, Number(event.target.value) || 1)));
                  setResult(null);
                }}
              />
            </FormField>
          </div>

          <div>
            <p className="mb-1.5 text-[13px] font-medium text-soft">Pagar com</p>
            <div className="flex flex-wrap gap-2">
              <Chip
                label="Conta / Pix"
                selected={method === 'ACCOUNT'}
                onClick={() => {
                  setMethod('ACCOUNT');
                  setResult(null);
                }}
              />
              {activeCards.map((card) => (
                <Chip
                  key={card.id}
                  label={card.name}
                  selected={method === 'CARD' && cardId === card.id}
                  onClick={() => {
                    setMethod('CARD');
                    setCardId(card.id);
                    setResult(null);
                  }}
                />
              ))}
              <Chip label="+ cartão" dashed onClick={() => navigate('/cartoes')} />
            </div>
          </div>

          <FormField label="Quando">
            <Input
              type="date"
              value={date}
              min={today}
              onChange={(event) => {
                setDate(event.target.value || today);
                setResult(null);
              }}
            />
          </FormField>

          <Button type="submit" fullWidth loading={simulate.isPending}>
            Simular
          </Button>
        </form>
      </Card>

      {result && (
        <>
          <Card className={clsx('mt-3.5', result.fits ? 'border-green/40' : 'border-clay/50')}>
            <p
              className={clsx(
                'font-display text-[17px] font-semibold',
                result.fits ? 'text-green' : 'text-clay',
              )}
            >
              {result.fits ? 'Cabe no seu saldo' : 'Vai apertar'}
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-soft">{result.verdict}</p>

            <BalanceChart
              days={result.before.days}
              compare={result.after.days}
              today={today}
              highlight={result.after.lowest}
            />
            <div className="mt-2 flex gap-4 text-[11.5px] text-muted">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-4 bg-green" /> sem a compra
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-4 bg-clay" /> com a compra
              </span>
            </div>
          </Card>

          <div className="mt-3.5 flex gap-3">
            <StatCard
              label="Menor saldo hoje"
              cents={result.before.lowest?.balanceCents ?? result.before.todayBalanceCents}
              hideCents={hideCents}
            />
            <StatCard
              label={
                result.after.lowest
                  ? `Com a compra (${shortDate(result.after.lowest.date)})`
                  : 'Com a compra'
              }
              cents={result.after.lowest?.balanceCents ?? result.after.todayBalanceCents}
              hideCents={hideCents}
            />
          </div>

          <Card className="mt-3.5">
            <SectionHeader title="Vai comprar?" />
            {canConfirm ? (
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {expenseCategories.map((category) => (
                    <Chip
                      key={category.id}
                      label={category.name}
                      dotColor={category.color}
                      selected={category.id === selectedCategory}
                      onClick={() => setCategoryId(category.id)}
                    />
                  ))}
                </div>
                <Input
                  placeholder="O que é? (opcional)"
                  aria-label="Descrição da compra"
                  maxLength={140}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
                <Button
                  fullWidth
                  loading={createPurchase.isPending || createTransaction.isPending}
                  onClick={() => void confirm()}
                >
                  Registrar compra
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-soft">
                Parcelado no boleto ou carnê? Cadastre em{' '}
                <Link to="/contas" className="text-green hover:underline">
                  Contas
                </Link>{' '}
                como conta fixa com {installments} parcelas.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
