/**
 * LxiPublishBlockMonitorCard
 * ──────────────────────────────────────────────────────────────────────
 * Monitoring für Phase-2 Hard-Block (matrix-aware effective gates).
 * Quelle: admin_get_lxi_publish_block_summary(p_hours).
 * Schwellen pro (track,gate) konfigurierbar via Tabelle lxi_block_thresholds.
 * Heal-Aktion pro Cluster via admin_heal_lxi_block_cluster(track,gate,hours).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldAlert, AlertTriangle, Wrench, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Severity = "ok" | "warning" | "critical";

interface SeverityCluster { track: string; gate: string; count: number; severity: Severity }
interface TopCluster { package_id: string; track: string; attempts: number; last_attempt: string }
interface Summary {
  window_hours: number;
  total_blocks: number;
  by_track: Record<string, number>;
  by_gate: Record<string, number>;
  top_clusters: TopCluster[];
  trend_hourly: Array<{ hour_bucket: string; blocks: number }>;
  severity_per_cluster: SeverityCluster[];
  global_severity: Severity;
  generated_at: string;
}

const fmtTime = (s: string) =>
  new Date(s).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const sevVariant = (s: Severity) =>
  s === "critical" ? "destructive" : s === "warning" ? "secondary" : "outline";

export function LxiPublishBlockMonitorCard() {
  const [hours, setHours] = useState("24");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["lxi-publish-block-summary", hours],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_lxi_publish_block_summary" as never,
        { p_hours: Number(hours) } as never,
      );
      if (error) throw error;
      return data as unknown as Summary;
    },
    refetchInterval: 60_000,
  });

  const heal = useMutation({
    mutationFn: async (vars: { track: string; gate: string }) => {
      const { data, error } = await supabase.rpc(
        "admin_heal_lxi_block_cluster" as never,
        { p_track: vars.track, p_gate: vars.gate, p_hours: Number(hours), p_limit: 20 } as never,
      );
      if (error) throw error;
      return data as { dispatched: number; skipped: number };
    },
    onSuccess: (res, vars) => {
      toast.success(`Heal: ${vars.track}/${vars.gate}`, {
        description: `${res.dispatched} dispatched · ${res.skipped} skipped`,
      });
      qc.invalidateQueries({ queryKey: ["lxi-publish-block-summary"] });
    },
    onError: (e: Error) => toast.error(`Heal fehlgeschlagen: ${e.message}`),
  });

  const severity: Severity = data?.global_severity ?? "ok";
  const total = data?.total_blocks ?? 0;
  const peak = (data?.trend_hourly ?? []).reduce((m, t) => Math.max(m, t.blocks), 0);

  return (
    <Card className="border-border-subtle">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            LXI Publish-Block Monitor (matrix-aware)
            <Badge variant={sevVariant(severity)} className="text-[10px]">
              {severity === "ok" ? "stable" : severity}
            </Badge>
          </CardTitle>
          <Select value={hours} onValueChange={setHours}>
            <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Letzte 1h</SelectItem>
              <SelectItem value="6">Letzte 6h</SelectItem>
              <SelectItem value="24">Letzte 24h</SelectItem>
              <SelectItem value="72">Letzte 72h</SelectItem>
              <SelectItem value="168">Letzte 7d</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Gesamt-Blocks" value={total} />
              <Stat label="Peak / Stunde" value={peak} />
              <Stat label="Top-Cluster" value={data?.top_clusters?.length ?? 0} />
            </div>

            {total === 0 ? (
              <div className="text-xs text-muted-foreground py-4 text-center">
                ✅ Keine Hard-Block-Events im Fenster ({hours}h).
              </div>
            ) : (
              <>
                <Section title="Severity per Track × Gate (Schwellen aus lxi_block_thresholds)">
                  <div className="space-y-1">
                    {(data?.severity_per_cluster ?? []).map((c) => (
                      <div key={`${c.track}-${c.gate}`}
                           className="flex items-center justify-between gap-2 border border-border-subtle rounded px-2 py-1 text-[11px]">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <Badge variant={sevVariant(c.severity)} className="text-[10px]">{c.severity}</Badge>
                          <Badge variant="outline" className="text-[10px] font-mono">{c.track}</Badge>
                          <span className="font-mono text-muted-foreground truncate">{c.gate}</span>
                          <Badge variant="secondary" className="text-[10px]">{c.count}×</Badge>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] shrink-0"
                          disabled={heal.isPending}
                          onClick={() => heal.mutate({ track: c.track, gate: c.gate })}
                        >
                          {heal.isPending && heal.variables?.track === c.track && heal.variables?.gate === c.gate
                            ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            : <Wrench className="h-3 w-3 mr-1" />}
                          Heal jetzt
                        </Button>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Top-Cluster (häufigste Pakete)">
                  <div className="space-y-1">
                    {(data?.top_clusters ?? []).map((c) => (
                      <div key={c.package_id}
                           className="text-[11px] flex items-center justify-between gap-2 border border-border-subtle rounded px-2 py-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="destructive" className="text-[10px]">{c.attempts}×</Badge>
                          <Badge variant="outline" className="text-[10px]">{c.track}</Badge>
                          <span className="font-mono text-muted-foreground truncate">{c.package_id}</span>
                        </div>
                        <span className="font-mono text-muted-foreground shrink-0">{fmtTime(c.last_attempt)}</span>
                      </div>
                    ))}
                  </div>
                </Section>

                {severity === "critical" && (
                  <div className="flex items-start gap-2 rounded border border-destructive/40 bg-surface-sunken p-2 text-xs">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <span>
                      Critical-Schwelle überschritten. Prüfe Producer-Phantom-Publishes oder echte Content-Lücken.
                      Schwellen anpassbar in <code className="font-mono">lxi_block_thresholds</code>.
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border-subtle p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
