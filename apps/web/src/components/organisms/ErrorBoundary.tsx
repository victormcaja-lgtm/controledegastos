import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Última linha de defesa da interface.
 *
 * Sem isso, um erro de render em qualquer componente apaga a tela inteira e o
 * usuário fica olhando para o branco, sem saber o que aconteceu.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Aqui entra o Sentry (ou outro APM) quando você quiser observabilidade.
    console.error('Erro não tratado na interface:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center bg-cream px-6">
        <div className="max-w-sm text-center">
          <p className="font-display text-xl font-semibold">Algo quebrou por aqui</p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Recarregue a página. Se continuar acontecendo, avise o administrador.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 h-11 rounded-2xl bg-ink px-5 text-sm font-semibold text-surface"
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
