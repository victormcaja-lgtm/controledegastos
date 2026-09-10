import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-display text-[15px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-2 text-[13px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
