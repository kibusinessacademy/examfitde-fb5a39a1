import { cn } from "@/lib/utils";
import type { ReleaseClass } from "@/features/admin/api/releaseClassificationApi";

const STYLES: Record<ReleaseClass | "unknown", { label: string; cls: string }> = {
  release_ok: {
    label: "✅ release_ok",
    cls: "border-success/40 bg-success/10 text-success",
  },
  release_warn: {
    label: "⚠️ release_warn",
    cls: "border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-400",
  },
  release_block: {
    label: "🛑 release_block",
    cls: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  unknown: {
    label: "— unklassifiziert",
    cls: "border-border bg-muted text-muted-foreground",
  },
};

export function ReleaseClassBadge({
  releaseClass,
  codes,
}: {
  releaseClass?: ReleaseClass | null;
  codes?: string[] | null;
}) {
  const key: ReleaseClass | "unknown" = releaseClass ?? "unknown";
  const s = STYLES[key];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", s.cls)}>
        {s.label}
      </span>
      {(codes ?? []).slice(0, 3).map((c) => (
        <span
          key={c}
          className="inline-flex rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
        >
          {c}
        </span>
      ))}
      {(codes?.length ?? 0) > 3 && (
        <span className="text-[10px] text-muted-foreground">+{(codes?.length ?? 0) - 3}</span>
      )}
    </div>
  );
}
