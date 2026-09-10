import { clsx } from 'clsx';
import { useId, type ReactElement, cloneElement } from 'react';

export interface FormFieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; invalid?: boolean }>;
  className?: string;
}

/**
 * Liga rótulo, campo, dica e mensagem de erro pelos ids corretos.
 * Fazer isso uma vez, aqui, é mais barato do que revisar acessibilidade em
 * quinze formulários diferentes.
 */
export function FormField({ label, error, hint, children, className }: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-soft">
        {label}
      </label>
      {cloneElement(children, {
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        invalid: Boolean(error),
      })}
      {hint && !error && (
        <p id={hintId} className="text-[11.5px] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-[11.5px] font-medium text-clay">
          {error}
        </p>
      )}
    </div>
  );
}
