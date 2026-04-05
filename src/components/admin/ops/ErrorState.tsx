export function ErrorState({ label = "Fehler beim Laden." }: { label?: string }) {
  return <div className="p-4 text-sm text-destructive">{label}</div>;
}
