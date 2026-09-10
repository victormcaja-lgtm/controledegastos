import { clsx } from 'clsx';
import { forwardRef, type InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      {...props}
      aria-invalid={invalid || undefined}
      className={clsx(
        'h-11 w-full rounded-xl border bg-card px-3 text-sm text-ink outline-none',
        'placeholder:text-muted',
        invalid ? 'border-clay' : 'border-line focus:border-green',
        className,
      )}
    />
  );
});
