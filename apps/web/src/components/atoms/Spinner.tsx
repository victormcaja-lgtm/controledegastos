export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center py-10">
      <span
        aria-hidden
        className="size-6 animate-spin rounded-full border-2 border-pebble border-t-ink"
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
