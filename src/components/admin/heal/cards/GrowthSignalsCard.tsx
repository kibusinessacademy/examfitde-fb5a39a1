/**
 * GrowthSignalsCard
 * ─────────────────
 * Track 2.1 — Growth-Signal-SSOT mit 3 sauber getrennten Klassen.
 * Diagnose-only. KEIN Hard-Gate auf Customer-Safe / Sellable.
 *
 * Klassen:
 *  - growth_visible      → indexable / canonical / kein dead-end
 *  - growth_instrumented → pricing_view / checkout_started / conversion_events
 *  - growth_amplifiable  → blog / og / indexnow / internal_links / campaign / distribution
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
import { Eye, Activity, Megaphone, RefreshCw, TrendingUp } from "lucide-react";

type Summary = {
  total_published: number;
  growth_ready_v2: number;
  visible_ready: number; visible_partial: number; visible_missing: number;
  instrumented_ready: number; instrumented_partial: number; instrumented_missing: number;
  amplifiable_ready: number; amplifiable_partial: number; amplifiable_missing: number;
  sig_visible: Record<string, number>;
  sig_instrumented: Record<string, number>;
  sig_amplifiable: Record<string, number>;
  generated_at: string;
};

type PackageRow = {
  package_id: string;
  package_key: string | null;
  package_title: string | null;
  track: string | null;
  visible_status: "ready" | "partial" | "missing";
  instrumented_status: "ready" | "partial" | "missing";
  amplifiable_status: "ready" | "partial" | "missing";
  growth_ready_v2: boolean;
};

type ClassKey = "visible" | "instrumented" | "amplifiable";

const CLASS_META: Record<ClassKey, { label: string; icon: typeof Eye; hint: string }> = {
  visible:      { label: "growth_visible",      icon: Eye,       hint: "indexable + canonical + no dead-end" },
  instrumented: { label: "growth_instrumented", icon: Activity,  hint: "pricing_view + checkout_started + events" },
  amplifiable:  { label: "growth_amplifiable",  icon: Megaphone, hint: "blog + og + indexnow + links + campaign + distribution" },
};

function statusTone(s: string): "success" | "warning" | "destructive" | "secondary" {
  if (s === "ready") return "success";
  if (s === "partial") return "warning";
  if (s === "missing") return "destructive";
  return "secondary";
}

function Pill({ tone, children }: { tone: "success" | "warning" | "destructive" | "secondary"; children: React.ReactNode }) {
  const t = {
    success: "bg-success-bg-subtle text-success border-success/30",
    warning: "bg-warning-bg-subtle text-warning-foreground border-warning/30",
    destructive: "bg-destructive-bg-subtle text-destructive border-destructive/30",
    secondary: "bg-muted text-muted-foreground border-border",
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${t}`}>
      {children}
    </span>
  );
}

function ClassRow({
  cls, s,
}: {
  cls: ClassKey;
  s: Summary;
}) {
  const meta = CLASS_META[cls];
  const Icon = meta.icon;
  const ready = (s as any)[`${cls}_ready`] as number;
  const partial = (s as any)[`${cls}_partial`] as number;
  const missing = (s as any)[`${cls}_missing`] as number;
  const sigs = (s as any)[`sig_${cls}`] as Record<string, number>;
  const total = s.total_published;
  const pct = total > 0 ? Math.round((ready / total) * 100) : 0;

  return (
    <div className="rounded-md border border-border bg-card/50 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-semibold text-foreground">{meta.label}</div>
            <div className="text-[10px] text-muted-foreground">{meta.hint}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-foreground leading-none">{ready}<span className="text-xs text-muted-foreground font-normal"> / {total}</span></div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{pct}% ready</div>
        </div>
      </div>
      <div className="flex gap-1.5">
        <Pill tone="success">ready: {ready}</Pill>
        <Pill tone="warning">partial: {partial}</Pill>
        <Pill tone="destructive">missing: {missing}</Pill>
      </div>
      <div className="flex flex-wrap gap-1 pt-1 border-t border-border">
        {Object.entries(sigs).map(([k, v]) => {
          const tone: "success" | "warning" | "destructive" =
            v === total ? "success" : v === 0 ? "destructive" : "warning";
          return <Pill key={k} tone={tone}>{k}: {v}</Pill>;
        })}
      </div>
    </div>
  );
}

export function GrowthSignalsCard() {
  const [filter, setFilter] = useState<{ cls: ClassKey; status: string } | null>(null);

  const summaryQ = useQuery({
    queryKey: ["growth-signals-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_growth_signals_summary" as any);
      if (error) throw error;
      return data as Summary;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const pkgQ = useQuery({
    queryKey: ["growth-signals-packages", filter],
    enabled: !!filter,
    queryFn: async () => {
      const args: Record<string, string> = {};
      if (filter) args[`_${filter.cls}_status`] = filter.status;
      const { data, error } = await supabase.rpc(
        "admin_get_growth_signals_packages" as any,
        { ...args, _limit: 50 } as any,
      );
      if (error) throw error;
      return (data ?? []) as PackageRow[];
    },
    staleTime: 30_000,
  });

  const s = summaryQ.data;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              Growth-Signals v1 — 3-Klassen-SSOT
              <Badge variant="outline" className="text-[10px]">Track 2.1 · Diagnose-only</Badge>
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              visible / instrumented / amplifiable strikt getrennt. KEIN Hard-Gate auf Customer-Safe.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { summaryQ.refetch(); if (filter) pkgQ.refetch(); }} disabled={summaryQ.isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${summaryQ.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {summaryQ.isLoading && <Skeleton className="h-60 w-full" />}
        {summaryQ.error && (
          <div className="rounded-md border border-destructive/30 bg-destructive-bg-subtle p-3 text-xs text-destructive">
            Fehler: {(summaryQ.error as Error).message}
            <Button variant="outline" size="sm" className="ml-2 h-7" onClick={() => summaryQ.refetch()}>Retry</Button>
          </div>
        )}

        {s && (
          <>
            {/* Compound KPI */}
            <div className="rounded-md border border-warning/30 bg-warning-bg-subtle p-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-muted-foreground">growth_ready_v2 (alle 3 Klassen ready)</div>
                <div className="text-2xl font-bold text-foreground mt-0.5">
                  {s.growth_ready_v2} <span className="text-sm font-normal text-muted-foreground">/ {s.total_published} published</span>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground text-right max-w-[200px]">
                Diese Zahl ersetzt das alte Sprint-3-Flag `growth_ready` (das nur Amplifiable misst).
              </div>
            </div>

            {/* 3 class rows */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <ClassRow cls="visible" s={s} />
              <ClassRow cls="instrumented" s={s} />
              <ClassRow cls="amplifiable" s={s} />
            </div>

            {/* Drilldown */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-foreground">Drilldown:</span>
                <Select
                  value={filter?.cls ?? ""}
                  onValueChange={(v) => setFilter(v ? { cls: v as ClassKey, status: "" } : null)}
                >
                  <SelectTrigger className="h-7 w-40 text-xs"><SelectValue placeholder="Klasse" /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CLASS_META) as ClassKey[]).map(c => (
                      <SelectItem key={c} value={c} className="text-xs">{CLASS_META[c].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filter && (
                  <Select
                    value={filter.status}
                    onValueChange={(v) => setFilter({ ...filter, status: v })}
                  >
                    <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ready" className="text-xs">ready</SelectItem>
                      <SelectItem value="partial" className="text-xs">partial</SelectItem>
                      <SelectItem value="missing" className="text-xs">missing</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {filter && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFilter(null)}>Reset</Button>
                )}
              </div>

              {filter?.status && (
                <div className="rounded-md border border-border bg-card/50 max-h-80 overflow-y-auto">
                  {pkgQ.isLoading && <div className="p-3 text-xs text-muted-foreground">Lade…</div>}
                  {pkgQ.data && pkgQ.data.length === 0 && (
                    <div className="p-3 text-xs text-muted-foreground">Keine Pakete.</div>
                  )}
                  {pkgQ.data && pkgQ.data.map(p => (
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
                          <Pill tone={statusTone(p.visible_status)}>V:{p.visible_status}</Pill>
                          <Pill tone={statusTone(p.instrumented_status)}>I:{p.instrumented_status}</Pill>
                          <Pill tone={statusTone(p.amplifiable_status)}>A:{p.amplifiable_status}</Pill>
                          {p.growth_ready_v2 && <Pill tone="success">v2-READY</Pill>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-[10px] text-muted-foreground">
              Stand: {new Date(s.generated_at).toLocaleTimeString("de-DE")} · Track 2.1 · keine Auto-Repair
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
