import { Badge } from "@/components/ui/badge";
import type { BundleRiskTier } from "@/lib/berufs-ki/outcome";

const TONE: Record<BundleRiskTier, string> = {
  LOW: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  MEDIUM: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  HIGH: "bg-destructive/10 text-destructive border-destructive/30",
};

export function BundleRiskBadge({ tier }: { tier?: BundleRiskTier | null }) {
  if (!tier) return null;
  return <Badge variant="outline" className={TONE[tier]}>Risk · {tier}</Badge>;
}
