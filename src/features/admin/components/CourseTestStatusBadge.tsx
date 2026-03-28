type Props = {
  status?: "tested" | "issue_found" | "approved" | null;
};

export function CourseTestStatusBadge({ status }: Props) {
  if (!status) {
    return (
      <span className="inline-flex rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
        Nicht getestet
      </span>
    );
  }

  const cfg =
    status === "approved"
      ? { label: "✅ Freigegeben", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" }
      : status === "issue_found"
      ? { label: "❌ Problem", cls: "border-destructive/30 bg-destructive/10 text-destructive" }
      : { label: "🧪 Getestet", cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" };

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}
