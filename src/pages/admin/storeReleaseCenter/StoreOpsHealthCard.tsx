// STORE.OPS.KPI.OS.1 — Admin Card
// Read-only KPI snapshot for StoreOps.
// Read-only. No store-publishing controls of any kind.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Activity, RefreshCw } from "lucide-react";

const RISK_COLOR: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "outline",
  medium: "secondary",
  high: "default",
  critical: "destructive",
};

export function StoreOpsHealthCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["store-ops-kpi-latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_ops_kpi_snapshots" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  async function evaluate() {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("evaluate-store-ops-kpi", { body: {} });
      if (error) throw error;
      toast.success("StoreOps KPI neu berechnet.");
      await qc.invalidateQueries({ queryKey: ["store-ops-kpi-latest"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const s = data?.summary ?? {};
  const bottlenecks = (data?.bottlenecks ?? []) as Array<any>;
  const topBlockers = (data?.top_blockers ?? []) as Array<{ code: string; count: number }>;
  const topRej = (data?.top_rejection_reasons ?? []) as Array<{ reason: string; count: number }>;
  const recActions = (data?.recommended_actions ?? []) as Array<any>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" /> StoreOps Health
        </CardTitle>
        <Button size="sm" variant="outline" onClick={evaluate} disabled={busy}>
          <RefreshCw className={`h-4 w-4 mr-1 ${busy ? "animate-spin" : ""}`} />
          KPI neu berechnen
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Noch kein Snapshot. Bitte „KPI neu berechnen“ klicken.</p>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div>
                <div className="text-3xl font-bold">{data.health_score}</div>
                <div className="text-xs text-muted-foreground">Health Score</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm flex-1">
                <Stat label="Review Ready" value={s.review_ready_count} />
                <Stat label="Blocked" value={s.blocked_count} />
                <Stat label="Build Success" value={`${Math.round((s.build_success_rate ?? 0) * 100)}%`} />
                <Stat label="Manifeste" value={s.total_manifests} />
              </div>
            </div>

            <Section title="Missing Assets">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">Listings: {s.missing_listing_count ?? 0}</Badge>
                <Badge variant="outline">Screenshots: {s.missing_screenshots_count ?? 0}</Badge>
                <Badge variant="outline">Privacy: {s.missing_privacy_count ?? 0}</Badge>
                <Badge variant="outline">Support: {s.missing_support_count ?? 0}</Badge>
              </div>
            </Section>

            {topBlockers.length > 0 && (
              <Section title="Top Blockers">
                <ul className="text-sm space-y-1">
                  {topBlockers.map((b) => (
                    <li key={b.code} className="flex justify-between">
                      <span className="font-mono">{b.code}</span>
                      <Badge variant="secondary">{b.count}</Badge>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {topRej.length > 0 && (
              <Section title="Top Rejection Reasons">
                <ul className="text-sm space-y-1">
                  {topRej.map((r) => (
                    <li key={r.reason} className="flex justify-between">
                      <span className="font-mono">{r.reason}</span>
                      <Badge variant="destructive">{r.count}</Badge>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {bottlenecks.length > 0 && (
              <Section title="Bottlenecks">
                <ul className="text-sm space-y-1">
                  {bottlenecks.map((b) => (
                    <li key={b.kind} className="flex justify-between items-center">
                      <span>{b.kind}</span>
                      <span className="flex items-center gap-2">
                        <Badge variant={RISK_COLOR[b.severity] ?? "outline"}>{b.severity}</Badge>
                        <span className="text-xs text-muted-foreground">{b.affected_count} Manifest(e)</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {recActions.length > 0 && (
              <Section title="Recommended Actions">
                <ul className="text-sm space-y-1">
                  {recActions.map((a) => (
                    <li key={a.action}>
                      <span className="font-medium">{a.action}</span>{" "}
                      <span className="text-muted-foreground">— {a.reason}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-lg font-semibold">{String(value ?? 0)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
      {children}
    </div>
  );
}
