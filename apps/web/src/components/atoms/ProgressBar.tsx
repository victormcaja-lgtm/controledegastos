import { clsx } from 'clsx';

export interface ProgressBarProps {
  /** 0 a 100. */
  percent: number;
  label?: string;
  className?: string;
  trackClassName?: string;
  barClassName?: string;
}

export function ProgressBar({
  percent,
  label,
  className,
  trackClassName = 'bg-line-soft',
  barClassName = 'bg-ink',
}: ProgressBarProps) {
  const safe = Math.min(100, Math.max(0, percent));
  return (
    <div
      role="progressbar"
      aria-valuenow={safe}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(label ? { 'aria-label': label } : {})}
      className={clsx('h-[10px] w-full overflow-hidden rounded-md', trackClassName, className)}
    >
      <div
        className={clsx('h-full rounded-md transition-[width] duration-500', barClassName)}
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}
