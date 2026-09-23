import { clsx } from 'clsx';
import { forwardRef, type InputHTMLAttributes } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  const invalid = props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  return (
    <input
      ref={ref}
      {...props}
      className={clsx(
        'h-11 w-full rounded-xl border bg-card px-3 text-sm text-ink outline-none',
        'placeholder:text-muted',
        invalid ? 'border-clay' : 'border-line focus:border-green',
        className,
      )}
    />
  );
});
