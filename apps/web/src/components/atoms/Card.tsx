import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Card escuro em destaque (usado na meta principal). */
  tone?: 'light' | 'dark';
  padding?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export function Card({ tone = 'light', padding = 'md', className, children, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={clsx(
        'rounded-[22px] border',
        tone === 'dark' ? 'bg-ink border-ink text-surface' : 'bg-card border-line text-ink',
        { sm: 'p-4', md: 'px-5 py-[18px]', lg: 'px-5 py-[22px]' }[padding],
        className,
      )}
    >
      {children}
    </div>
  );
}
