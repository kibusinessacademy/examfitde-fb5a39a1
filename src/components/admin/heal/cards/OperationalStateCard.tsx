/**
 * OperationalStateCard
 * ────────────────────
 * Sprint 3 (S3) — Dach-SSOT für 7 Operational-Dimensionen.
 * Diagnose-only. Verzehrt `admin_get_operational_state_summary()`
 * + `admin_get_operational_state_packages()`.
 *
 * Wichtig: customer_safe bleibt eigene Wahrheit und wird NICHT
 * durch ein überbreites Dach-Gate entwertet.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Layers, ShieldCheck, AlertTriangle, Sparkles, Building2, RefreshCw } from "lucide-react";

type Summary = {
  total: number;
  customer_safe: number;
  ops_attention: number;
  growth_ready: number;
  enterprise_ready: number;
  by_build: Record<string, number>;
  by_governance: Record<string, number>;
  by_commerce: Record<string, number>;
  by_customer: Record<string, number>;
  by_seo: Record<string, number>;
  by_b2b: Record<string, number>;
  by_ops: Record<string, number>;
  generated_at: string;
};

type PackageRow = {
  package_id: string;
  package_key: string | null;
  package_title: string | null;
  track: string | null;
  build_state: string;
  governance_state: string;
  commerce_state: string;
  customer_state: string;
  seo_state: string;
  b2b_state: string;
  ops_state: string;
  customer_safe: boolean;
  ops_attention_required: boolean;
  growth_ready: boolean;
  enterprise_ready: boolean;
};

type DimKey = "build" | "governance" | "commerce" | "customer" | "seo" | "b2b" | "ops";

const DIM_LABEL: Record<DimKey, string> = {
  build: "Build",
  governance: "Governance",
  commerce: "Commerce",
  customer: "Customer",
  seo: "SEO",
  b2b: "B2B",
  ops: "Ops",
};

function badgeToneFor(dim: DimKey, value: string): "success" | "warning" | "destructive" | "secondary" {
  const greens = new Set(["published", "approved", "ready", "customer_safe", "complete", "enterprise_ready", "clean"]);
  const reds = new Set(["failed", "blocked", "bronze", "gap"]);
  const yellows = new Set(["review", "partial", "minimal", "enterprise_partial", "b2c_only", "stuck", "locked", "repairable", "building", "queued"]);
  if (greens.has(value)) return "success";
  if (reds.has(value)) return "destructive";
  if (yellows.has(value)) return "warning";
  return "secondary";
}

function Pill({ tone, children }: { tone: "success" | "warning" | "destructive" | "secondary"; children: React.ReactNode }) {
  const toneClass = {
    success: "bg-success-bg-subtle text-success border-success/30",
    warning: "bg-warning-bg-subtle text-warning-foreground border-warning/30",
    destructive: "bg-destructive-bg-subtle text-destructive border-destructive/30",
    secondary: "bg-muted text-muted-foreground border-border",
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

function DimRow({ dim, dist }: { dim: DimKey; dist: Record<string, number> | undefined }) {
  const entries = Object.entries(dist ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-border last:border-0">
      <div className="w-24 shrink-0 text-xs font-medium text-foreground">{DIM_LABEL[dim]}</div>
      <div className="flex flex-wrap gap-1.5 flex-1">
        {entries.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">—</span>
        ) : (
          entries.map(([k, v]) => (
            <Pill key={k} tone={badgeToneFor(dim, k)}>
              {k}: {v}
            </Pill>
          ))
        )}
      </div>
    </div>
  );
}

export function OperationalStateCard() {
  const [drilldown, setDrilldown] = useState<{ dim: DimKey; value: string } | null>(null);

  const summaryQ = useQuery({
    queryKey: ["operational-state-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_operational_state_summary" as any);
      if (error) throw error;
      return data as Summary;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const packagesQ = useQuery({
    queryKey: ["operational-state-packages", drilldown],
    enabled: !!drilldown,
    queryFn: async () => {
      const filterArg: Record<string, string> = {};
      if (drilldown) filterArg[`_${drilldown.dim}`] = drilldown.value;
      const { data, error } = await supabase.rpc(
        "admin_get_operational_state_packages" as any,
        { ...filterArg, _limit: 50 } as any,
      );
      if (error) throw error;
      return (data ?? []) as PackageRow[];
    },
    staleTime: 30_000,
  });

  const s = summaryQ.data;
  const isLoading = summaryQ.isLoading;
  const isError = !!summaryQ.error;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-primary" />
              Operational State v1 — Dach-SSOT
              <Badge variant="outline" className="text-[10px]">S3 · Diagnose-only</Badge>
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              7 Dimensionen: Build / Governance / Commerce / Customer / SEO / B2B / Ops.
              customer_safe bleibt eigene Wahrheit.
            </CardDescription>
          </div>
          <Button
            variant="ghost" size="sm"
            onClick={() => { summaryQ.refetch(); if (drilldown) packagesQ.refetch(); }}
            disabled={summaryQ.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${summaryQ.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && <Skeleton className="h-40 w-full" />}
        {isError && (
          <div className="rounded-md border border-destructive/30 bg-destructive-bg-subtle p-3 text-xs text-destructive">
            Fehler beim Laden: {(summaryQ.error as Error).message}
            <Button variant="outline" size="sm" className="ml-2 h-7" onClick={() => summaryQ.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {s && (
          <>
            {/* Compound Flags Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-md border border-success/30 bg-success-bg-subtle p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <ShieldCheck className="h-3 w-3" /> customer_safe
                </div>
                <div className="text-lg font-bold text-foreground mt-0.5">
                  {s.customer_safe} <span className="text-xs text-muted-foreground font-normal">/ {s.total}</span>
                </div>
              </div>
              <div className="rounded-md border border-warning/30 bg-warning-bg-subtle p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <AlertTriangle className="h-3 w-3" /> ops_attention
                </div>
                <div className="text-lg font-bold text-foreground mt-0.5">
                  {s.ops_attention} <span className="text-xs text-muted-foreground font-normal">/ {s.total}</span>
                </div>
              </div>
              <div className="rounded-md border border-border bg-card p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3" /> growth_ready
                </div>
                <div className="text-lg font-bold text-foreground mt-0.5">
                  {s.growth_ready} <span className="text-xs text-muted-foreground font-normal">/ {s.total}</span>
                </div>
              </div>
              <div className="rounded-md border border-border bg-card p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Building2 className="h-3 w-3" /> enterprise_ready
                </div>
                <div className="text-lg font-bold text-foreground mt-0.5">
                  {s.enterprise_ready} <span className="text-xs text-muted-foreground font-normal">/ {s.total}</span>
                </div>
              </div>
            </div>

            {/* Dimension Distribution */}
            <div className="rounded-md border border-border bg-card/50 p-3">
              <div className="text-xs font-semibold text-foreground mb-2">Dimension-Verteilung</div>
              <DimRow dim="build"      dist={s.by_build} />
              <DimRow dim="governance" dist={s.by_governance} />
              <DimRow dim="commerce"   dist={s.by_commerce} />
              <DimRow dim="customer"   dist={s.by_customer} />
              <DimRow dim="seo"        dist={s.by_seo} />
              <DimRow dim="b2b"        dist={s.by_b2b} />
              <DimRow dim="ops"        dist={s.by_ops} />
            </div>

            {/* Drilldown */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-foreground">Drilldown:</span>
                <Select
                  value={drilldown?.dim ?? ""}
                  onValueChange={(v) => setDrilldown(v ? { dim: v as DimKey, value: "" } : null)}
                >
                  <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="Dimension" /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DIM_LABEL) as DimKey[]).map((d) => (
                      <SelectItem key={d} value={d} className="text-xs">{DIM_LABEL[d]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {drilldown && (
                  <Select
                    value={drilldown.value}
                    onValueChange={(v) => setDrilldown({ ...drilldown, value: v })}
                  >
                    <SelectTrigger className="h-7 w-40 text-xs"><SelectValue placeholder="Status…" /></SelectTrigger>
                    <SelectContent>
                      {Object.keys((s as any)[`by_${drilldown.dim}`] ?? {}).map((k) => (
                        <SelectItem key={k} value={k} className="text-xs">{k}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {drilldown && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDrilldown(null)}>
                    Reset
                  </Button>
                )}
              </div>

              {drilldown?.value && (
                <div className="rounded-md border border-border bg-card/50 max-h-80 overflow-y-auto">
                  {packagesQ.isLoading && <div className="p-3 text-xs text-muted-foreground">Lade…</div>}
                  {packagesQ.data && packagesQ.data.length === 0 && (
                    <div className="p-3 text-xs text-muted-foreground">Keine Pakete in dieser Kombination.</div>
                  )}
                  {packagesQ.data && packagesQ.data.map((p) => (
                    <div key={p.package_id} className="px-3 py-2 border-b border-border last:border-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-foreground truncate">
                            {p.package_title ?? p.package_key ?? p.package_id.slice(0, 8)}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono truncate">
                            {p.track} · {p.package_id.slice(0, 8)}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-wrap justify-end shrink-0">
                          <Pill tone={badgeToneFor("build", p.build_state)}>{p.build_state}</Pill>
                          <Pill tone={badgeToneFor("governance", p.governance_state)}>{p.governance_state}</Pill>
                          <Pill tone={badgeToneFor("commerce", p.commerce_state)}>{p.commerce_state}</Pill>
                          <Pill tone={badgeToneFor("customer", p.customer_state)}>{p.customer_state}</Pill>
                          <Pill tone={badgeToneFor("seo", p.seo_state)}>{p.seo_state}</Pill>
                          <Pill tone={badgeToneFor("b2b", p.b2b_state)}>{p.b2b_state}</Pill>
                          <Pill tone={badgeToneFor("ops", p.ops_state)}>{p.ops_state}</Pill>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-[10px] text-muted-foreground">
              Stand: {new Date(s.generated_at).toLocaleTimeString("de-DE")} · Sprint 3 · Diagnose-only
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
