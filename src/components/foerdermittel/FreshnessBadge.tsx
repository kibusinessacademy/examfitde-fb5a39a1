import { Radar, ShieldCheck, AlertTriangle, HelpCircle, type LucideIcon } from "lucide-react";
import type { FreshnessStatus } from "@/lib/foerdermittel/types";
import { FRESHNESS_LABEL } from "@/lib/foerdermittel/freshness";

const STYLES: Record<FreshnessStatus, { tone: string; Icon: LucideIcon }> = {
  fresh: {
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    Icon: ShieldCheck,
  },
  watch: {
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    Icon: Radar,
  },
  stale: {
    tone: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
    Icon: AlertTriangle,
  },
  unknown: {
    tone: "bg-muted text-muted-foreground border-border",
    Icon: HelpCircle,
  },
};

export function FreshnessBadge({
  status,
  size = "sm",
}: {
  status: FreshnessStatus;
  size?: "xs" | "sm";
}) {
  const { tone, Icon } = STYLES[status];
  const sz = size === "xs" ? "text-[10px] px-1.5 py-0.5 gap-1" : "text-xs px-2 py-0.5 gap-1.5";
  const iconSz = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${tone} ${sz}`}
      aria-label={`Aktualität: ${FRESHNESS_LABEL[status]}`}
    >
      <Icon className={iconSz} aria-hidden />
      {FRESHNESS_LABEL[status]}
    </span>
  );
}
