import { useEffect, useRef } from 'react';
import { Button } from '@/components/atoms/Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Diálogo de confirmação em cima do `<dialog>` nativo: foco preso, Esc fecha e
 * leitor de tela anuncia — tudo isso de graça, sem biblioteca de modal.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(360px,90vw)] rounded-[22px] border border-line bg-card p-5 text-ink backdrop:bg-ink/40"
    >
      <h2 className="font-display text-base font-semibold">{title}</h2>
      {description && <p className="mt-2 text-[13px] leading-relaxed text-soft">{description}</p>}
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" fullWidth onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          fullWidth
          loading={loading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
