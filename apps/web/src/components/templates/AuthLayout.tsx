import type { ReactNode } from 'react';

export interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-cream px-5 py-10">
      <main className="w-full max-w-[400px]">
        <div className="mb-7 text-center">
          <p className="font-display text-2xl font-bold tracking-[-0.03em]">Grana</p>
          <p className="mt-1 text-[13px] text-muted">controle financeiro pessoal</p>
        </div>

        <div className="rounded-[26px] border border-line bg-card px-6 py-7">
          <h1 className="font-display text-xl font-semibold tracking-[-0.02em]">{title}</h1>
          <p className="mt-1.5 mb-6 text-[13px] leading-relaxed text-muted">{subtitle}</p>
          {children}
        </div>

        {footer && <div className="mt-5 text-center text-xs text-muted">{footer}</div>}
      </main>
    </div>
  );
}
