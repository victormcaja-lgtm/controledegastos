import { Card } from '@/components/atoms/Card';
import { Money } from '@/components/atoms/Money';

export interface StatCardProps {
  label: string;
  cents: number;
  hideCents?: boolean;
  muted?: boolean;
}

export function StatCard({ label, cents, hideCents, muted = false }: StatCardProps) {
  return (
    <Card padding="sm" className="flex-1">
      <p className="text-xs text-muted">{label}</p>
      <Money
        cents={cents}
        hideCents={hideCents ?? false}
        className={`mt-[3px] block font-display text-xl font-semibold tracking-[-0.02em] ${
          muted ? 'text-muted' : 'text-ink'
        }`}
      />
    </Card>
  );
}
