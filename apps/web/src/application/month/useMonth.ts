import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { currentMonthRef, isValidMonthRef, type MonthRef } from '@grana/shared';

/**
 * A competência selecionada vive na URL (`?mes=2026-09`), não em estado local.
 *
 * Três ganhos concretos: o usuário pode compartilhar/favoritar um mês
 * específico, o botão "voltar" do navegador funciona como ele espera, e a
 * seleção sobrevive a um F5.
 */
export function useMonth(): { month: MonthRef; setMonth: (month: MonthRef) => void } {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get('mes');
  const month = raw && isValidMonthRef(raw) ? raw : currentMonthRef();

  const setMonth = useCallback(
    (next: MonthRef) => {
      const params = new URLSearchParams(searchParams);
      if (next === currentMonthRef()) params.delete('mes');
      else params.set('mes', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return { month, setMonth };
}
