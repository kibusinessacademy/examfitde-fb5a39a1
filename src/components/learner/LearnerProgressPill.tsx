/**
 * Glass-Pill für Fortschritt — `x % • a/b Lektionen`.
 *
 * Rein präsentational. Akzeptiert progress (0..1) ODER completed/total.
 */
import { cn } from "@/lib/utils";

interface Props {
  progress?: number;
  completedCount?: number;
  totalCount?: number;
  glass?: boolean;
  className?: string;
}

export function LearnerProgressPill({
  progress,
  completedCount,
  totalCount,
  glass = false,
  className,
}: Props) {
  const ratio =
    typeof progress === "number"
      ? Math.max(0, Math.min(1, progress))
      : typeof completedCount === "number" && typeof totalCount === "number" && totalCount > 0
      ? Math.max(0, Math.min(1, completedCount / totalCount))
      : undefined;

  if (ratio === undefined) return null;
  const pct = Math.round(ratio * 100);

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-medium",
        glass
          ? "bg-background/60 backdrop-blur-md border border-border/60 text-foreground"
          : "bg-muted text-foreground",
        className,
      )}
      aria-label={`Fortschritt ${pct} Prozent`}
    >
      <span>{pct}%</span>
      {typeof completedCount === "number" && typeof totalCount === "number" && (
        <span className="text-muted-foreground whitespace-nowrap">
          {completedCount}/{totalCount} Lektionen
        </span>
      )}
    </div>
  );
}
