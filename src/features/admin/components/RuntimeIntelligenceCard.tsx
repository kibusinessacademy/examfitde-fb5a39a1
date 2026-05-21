import { useQuery } from "@tanstack/react-query";
import { Activity, TrendingDown, Clock, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface IntelligenceRow {
  action_key: string;
  severity: string | null;
  target_layer: string | null;
  is_destructive: boolean;
  is_enabled: boolean;
  runs_30d: number;
  runs_24h: number;
  success_30d: number;
  failed_30d: number;
  rolled_back_30d: number;
  cooldown_blocks_7d: number;
  failure_rate_pct: number;
  rollback_rate_pct: number;
  avg_duration_ms: number | null;
  last_failure_at: string | null;
  last_success_at: string | null;
  top_failure_reasons: Array<{ reason: string; count: number }>;
  cooldown_seconds: number | null;
  max_per_hour: number | null;
}

function statusTone(row: IntelligenceRow): { label: string; cls: string } {
  if (row.failure_rate_pct >= 25) return { label: "CRIT", cls: "bg-destructive text-destructive-foreground" };
  if (row.failure_rate_pct >= 10 || row.cooldown_blocks_7d >= 3) return { label: "WARN", cls: "bg-warning-bg-subtle text-warning" };
  if (row.runs_30d === 0) return { label: "IDLE", cls: "bg-muted text-muted-foreground" };
  return { label: "OK", cls: "bg-success-bg-subtle text-success" };
}

/**
 * Runtime Intelligence Card v1.3
 * Read-only. Aggregiert historische Action-Performance (Erfolg, Fehler,
 * Rollback, Cooldown-Blocks) + Top-Fehlergruende pro Action. Operator-first,
 * keine Mutationen.
 */
export default function RuntimeIntelligenceCard() {
  const q = useQuery({
    queryKey: ["runtime-intelligence"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_runtime_intelligence");
      if (error) throw error;
      return (data ?? []) as IntelligenceRow[];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" /> Action Intelligence
          <Badge variant="outline" className="text-[10px]">30d-Historie</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading && <Skeleton className="h-32 w-full" />}
        {q.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive-bg-subtle p-3 text-sm text-destructive">
            Fehler beim Laden: {(q.error as Error).message}
          </div>
        )}
        {q.data && q.data.length === 0 && (
          <p className="text-sm text-muted-foreground">Noch keine Runtime-Actions registriert.</p>
        )}
        {q.data?.map((row) => {
          const tone = statusTone(row);
          return (
            <div key={row.action_key} className="rounded-md border border-border bg-surface-1 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge className={tone.cls}>{tone.label}</Badge>
                <span className="font-mono text-sm font-medium">{row.action_key}</span>
                {row.severity && (
                  <Badge variant="outline" className="text-[10px] uppercase">{row.severity}</Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">{row.target_layer}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
                <Stat label="Runs 30d" value={row.runs_30d} />
                <Stat label="Erfolg" value={row.success_30d} />
                <Stat label="Fehler" value={row.failed_30d} tone={row.failed_30d > 0 ? "warn" : undefined} />
                <Stat label="Rollback" value={row.rolled_back_30d} tone={row.rolled_back_30d > 0 ? "warn" : undefined} />
                <Stat
                  label="Cooldown-Blocks 7d"
                  value={row.cooldown_blocks_7d}
                  tone={row.cooldown_blocks_7d >= 3 ? "warn" : undefined}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" /> Fehlerquote {row.failure_rate_pct}%
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Cooldown {row.cooldown_seconds ?? "—"}s · max/h {row.max_per_hour ?? "—"}
                </span>
                {row.avg_duration_ms != null && (
                  <span>⌀ {Math.round(row.avg_duration_ms)}ms</span>
                )}
              </div>
              {row.top_failure_reasons?.length > 0 && (
                <div className="mt-2 rounded border border-warning-bg-subtle bg-warning-bg-subtle/40 p-2">
                  <div className="mb-1 flex items-center gap-1 text-xs font-medium text-warning">
                    <AlertTriangle className="h-3 w-3" /> Top Fehlergruende
                  </div>
                  <ul className="space-y-0.5 text-xs">
                    {row.top_failure_reasons.slice(0, 3).map((f, i) => (
                      <li key={i} className="font-mono text-muted-foreground">
                        <span className="text-foreground">{f.count}×</span> {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warn" }) {
  return (
    <div className="rounded border border-border bg-background p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${tone === "warn" ? "text-warning" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
