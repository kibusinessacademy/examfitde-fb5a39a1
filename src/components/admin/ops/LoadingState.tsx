export function LoadingState({ label = "Lade Daten…" }: { label?: string }) {
  return <div className="p-4 text-sm text-muted-foreground">{label}</div>;
}
