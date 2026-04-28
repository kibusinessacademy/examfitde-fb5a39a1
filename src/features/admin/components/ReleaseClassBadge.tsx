import { Badge } from "@/components/ui/badge";
import type { ReleaseClass } from "@/features/admin/api/releaseClassificationApi";

const STYLES: Record<
  ReleaseClass | "unknown",
  { label: string; variant: "success" | "warning" | "danger" | "muted" }
> = {
  release_ok: { label: "✅ release_ok", variant: "success" },
  release_warn: { label: "⚠️ release_warn", variant: "warning" },
  release_block: { label: "🛑 release_block", variant: "danger" },
  unknown: { label: "— unklassifiziert", variant: "muted" },
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
      <Badge variant={s.variant}>{s.label}</Badge>
      {(codes ?? []).slice(0, 3).map((c) => (
        <span
          key={c}
          className="inline-flex rounded-md border border-border-subtle bg-surface-sunken px-1.5 py-0.5 text-[10px] font-mono text-text-tertiary"
        >
          {c}
        </span>
      ))}
      {(codes?.length ?? 0) > 3 && (
        <span className="text-[10px] text-text-tertiary">+{(codes?.length ?? 0) - 3}</span>
      )}
    </div>
  );
}
