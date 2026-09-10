import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Money } from './Money';

describe('<Money />', () => {
  it('formata centavos como moeda pt-BR', () => {
    render(<Money cents={214_90} />);
    expect(screen.getByText('R$ 214,90')).toBeInTheDocument();
  });

  it('respeita o ajuste de arredondar centavos', () => {
    render(<Money cents={214_90} hideCents />);
    expect(screen.getByText('R$ 215')).toBeInTheDocument();
  });

  it('usa o sinal de menos tipográfico em valores negativos', () => {
    render(<Money cents={-1_050} />);
    expect(screen.getByText('−R$ 10,50')).toBeInTheDocument();
  });

  it('mostra o sinal de mais quando pedido', () => {
    render(<Money cents={1_050} signed />);
    expect(screen.getByText('+R$ 10,50')).toBeInTheDocument();
  });

  it('separa milhar no padrão brasileiro', () => {
    render(<Money cents={1_234_567} />);
    expect(screen.getByText('R$ 12.345,67')).toBeInTheDocument();
  });
});
