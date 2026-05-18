/**
 * PlatformIntegrityCard — Master-Health über alle Domain-Guards.
 *
 * Aggregiert pricing/funnel/seo_publish aus v_platform_integrity zu einer
 * Master-Ampel. Schlechteste Sub-Ampel gewinnt.
 */
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, AlertCircle, RefreshCw, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type Status = "green" | "yellow" | "red";

type Row = {
  pricing_status: Status;
  published_without_price: number;
  total_published_packages: number;
  funnel_status: Status;
  tracking_completeness_pct: number;
  events_total_7d: number;
  published_without_seo_page: number;
  seo_publish_status: Status;
  platform_status: Status;
  checked_at: string;
};

async function fetchPlatformIntegrity(): Promise<Row | null> {
  const { data, error } = await supabase
    .from("v_platform_integrity" as never)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as Row | null) ?? null;
}

const STYLES: Record<Status, { Icon: typeof CheckCircle2; label: string; iconClass: string; badgeClass: string }> = {
  green: {
    Icon: CheckCircle2, label: "Green", iconClass: "text-success",
    badgeClass: "bg-status-success-bg-subtle text-status-success-foreground border-status-success-border",
  },
  yellow: {
    Icon: AlertTriangle, label: "Yellow", iconClass: "text-warning",
    badgeClass: "bg-status-warning-bg-subtle text-status-warning-foreground border-status-warning-border",
  },
  red: {
    Icon: AlertCircle, label: "Red", iconClass: "text-destructive",
    badgeClass: "bg-status-error-subtle text-status-error-foreground border-status-error/30",
  },
};

export default function PlatformIntegrityCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["platform-integrity"],
    queryFn: fetchPlatformIntegrity,
    refetchInterval: 5 * 60 * 1000,
  });

  const status = (data?.platform_status ?? "green") as Status;
  const style = STYLES[status];
  const Icon = style.Icon;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <Layers className={`h-4 w-4 ${style.iconClass}`} />
            Platform Integrity
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Master-Health · Publish · Pricing · Funnel
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${style.badgeClass}`}>
            <Icon className="h-3 w-3 mr-1" />
            {style.label}
          </Badge>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Domain
            label="SEO-Publish"
            status={data?.seo_publish_status ?? "green"}
            metric={data ? `${data.published_without_seo_page} ohne Page` : "–"}
            sub={data ? `${data.total_published_packages} published` : ""}
            loading={isLoading}
          />
          <Domain
            label="Pricing"
            status={data?.pricing_status ?? "green"}
            metric={data ? `${data.published_without_price} ohne Preis` : "–"}
            sub={data ? `${data.total_published_packages} published` : ""}
            loading={isLoading}
          />
          <Domain
            label="Funnel"
            status={data?.funnel_status ?? "green"}
            metric={data ? `${data.tracking_completeness_pct}% pkg_id` : "–"}
            sub={data ? `${data.events_total_7d} Events / 7d` : ""}
            loading={isLoading}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Domain({
  label, status, metric, sub, loading,
}: {
  label: string; status: Status; metric: string; sub: string; loading?: boolean;
}) {
  const style = STYLES[status];
  const Icon = style.Icon;
  return (
    <div className="rounded-md border border-border/60 bg-surface-subtle px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${style.iconClass}`} />
      </div>
      <div className="text-sm font-semibold tabular-nums text-foreground mt-0.5">
        {loading ? "…" : metric}
      </div>
      <div className="text-[10px] text-muted-foreground truncate">{sub}</div>
    </div>
  );
}
