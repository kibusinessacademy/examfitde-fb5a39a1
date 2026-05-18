/**
 * PricingIntegrityCard — Revenue/Conversion-Guard.
 *
 * Aggregiert die drei Drift-Indikatoren aus v_pricing_integrity_check
 * und zeigt sie als Ampel (green / yellow / red) im Growth-Cockpit.
 *
 * Zielzustand: alle drei Werte = 0 → green.
 *  - published_without_price > 0 → red (Revenue-Blocker)
 *  - sonst > 0 → yellow (Datenhygiene)
 */
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type IntegrityRow = {
  published_without_price: number;
  duplicate_product_cases: number;
  manual_review_cases: number;
  total_published_packages: number;
  status: "green" | "yellow" | "red";
  checked_at: string;
};

async function fetchPricingIntegrity(): Promise<IntegrityRow | null> {
  const { data, error } = await supabase
    .from("v_pricing_integrity_check" as never)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as IntegrityRow | null) ?? null;
}

const STATUS_STYLES = {
  green: {
    Icon: CheckCircle2,
    label: "Green",
    iconClass: "text-success",
    badgeClass: "bg-status-success-bg-subtle text-status-success-foreground border-status-success-border",
  },
  yellow: {
    Icon: AlertTriangle,
    label: "Yellow",
    iconClass: "text-warning",
    badgeClass: "bg-status-warning-bg-subtle text-status-warning-foreground border-status-warning-border",
  },
  red: {
    Icon: AlertCircle,
    label: "Red",
    iconClass: "text-destructive",
    badgeClass: "bg-status-danger-subtle text-status-danger-foreground border-status-danger/30",
  },
} as const;

export default function PricingIntegrityCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["pricing-integrity-check"],
    queryFn: fetchPricingIntegrity,
    refetchInterval: 5 * 60 * 1000,
  });

  const status = (data?.status ?? "green") as keyof typeof STATUS_STYLES;
  const style = STATUS_STYLES[status];
  const StatusIcon = style.Icon;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <StatusIcon className={`h-4 w-4 ${style.iconClass}`} />
            Pricing Integrity
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Revenue-Guard für published Packages — Drift-Erkennung gegen{" "}
            <code className="text-[10px]">v_pricing_backfill_dryrun</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${style.badgeClass}`}>
            {style.label}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Metric
            label="Published"
            value={data?.total_published_packages ?? "–"}
            tone="neutral"
            loading={isLoading}
          />
          <Metric
            label="Without Price"
            value={data?.published_without_price ?? "–"}
            tone={data && data.published_without_price > 0 ? "danger" : "ok"}
            loading={isLoading}
          />
          <Metric
            label="Duplicates"
            value={data?.duplicate_product_cases ?? "–"}
            tone={data && data.duplicate_product_cases > 0 ? "warning" : "ok"}
            loading={isLoading}
          />
          <Metric
            label="Manual Review"
            value={data?.manual_review_cases ?? "–"}
            tone={data && data.manual_review_cases > 0 ? "warning" : "ok"}
            loading={isLoading}
          />
        </div>

        {data && data.status !== "green" && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-xs text-muted-foreground">
              Drift erkannt — Pricing-Backfill prüfen.
            </p>
            <Button asChild size="sm" variant="outline">
              <a href="/admin/heal" target="_blank" rel="noreferrer">
                Pricing Backfill prüfen
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: number | string;
  tone: "ok" | "warning" | "danger" | "neutral";
  loading?: boolean;
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
      ? "text-warning"
      : tone === "ok"
      ? "text-success"
      : "text-foreground";
  return (
    <div className="rounded-md border border-border/60 bg-surface-subtle px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${toneClass}`}>
        {loading ? "…" : value}
      </div>
    </div>
  );
}
