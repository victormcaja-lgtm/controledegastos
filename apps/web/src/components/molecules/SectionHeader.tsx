import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  title: string;
  aside?: ReactNode;
}

export function SectionHeader({ title, aside }: SectionHeaderProps) {
  return (
    <div className="flex w-full items-baseline justify-between gap-3">
      <h2 className="font-display text-[15px] font-semibold">{title}</h2>
      {aside && <div className="text-xs text-muted">{aside}</div>}
    </div>
  );
}
