type Props = {
  priority: "critical" | "warning" | "healthy";
};

export function TestPriorityBadge({ priority }: Props) {
  const cfg =
    priority === "critical"
      ? { label: "🔴 kritisch", cls: "border-destructive/30 bg-destructive/10 text-destructive" }
      : priority === "warning"
      ? { label: "🟡 aufmerksam", cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" }
      : { label: "🟢 stabil", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}
