/**
 * P6 — Semantic Graph Crawl Observatory Card (Admin/Diagnostics).
 *
 * Read-only health view + materialization history + "Materialisierung
 * anfordern" button. Talks only to admin RPCs — never to
 * semantic_graph_* tables directly.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Network, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface Health {
  published_snapshot_id: string | null;
  published_at: string | null;
  source_hash: string | null;
  snapshot_age_minutes: number | null;
  entity_count: number;
  edge_count: number;
  orphan_count: number;
  route_count: number;
  sitemap_route_count: number;
  sitemap_coverage_ratio: number | null;
  freshness_state: "fresh" | "stale" | "missing_snapshot" | "orphan_risk" | "sitemap_mismatch" | null;
  last_materialization_status: string | null;
  last_materialization_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  recommended_action: "none" | "run_materializer" | "inspect_orphans" | "regenerate_sitemap" | "check_materializer_error" | null;
}

interface HistoryRow {
  id: string;
  snapshot_id: string | null;
  source_hash: string;
  status: "started" | "skipped_unchanged" | "published" | "failed";
  entity_count: number;
  edge_count: number;
  orphan_count: number;
  route_count: number;
  sitemap_route_count: number;
  started_at: string;
  finished_at: string | null;
  error_code: string | null;
}

const FRESHNESS_TONE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  fresh: { label: "FRESH", variant: "default" },
  stale: { label: "STALE", variant: "secondary" },
  missing_snapshot: { label: "MISSING SNAPSHOT", variant: "destructive" },
  orphan_risk: { label: "ORPHAN RISK", variant: "destructive" },
  sitemap_mismatch: { label: "SITEMAP MISMATCH", variant: "destructive" },
};

const ACTION_HINT: Record<string, string> = {
  none: "Keine Aktion erforderlich.",
  run_materializer: "Empfohlen: Materialisierung anfordern.",
  inspect_orphans: "Empfohlen: Orphans untersuchen, bevor neu publiziert wird.",
  regenerate_sitemap: "Empfohlen: Sitemap regenerieren (Coverage < 100 %).",
  check_materializer_error: "Empfohlen: Letzten Fehler prüfen, dann erneut anfordern.",
};

function fmtDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function SemanticGraphCrawlHealthCard() {
  const qc = useQueryClient();
  const [requesting, setRequesting] = useState(false);

  const health = useQuery({
    queryKey: ["sgc-health"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as (n: string) => Promise<{ data: Health | null; error: { message: string } | null }>)(
        "admin_semantic_graph_crawl_health",
      );
      if (error) throw new Error(error.message);
      return data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const history = useQuery({
    queryKey: ["sgc-history"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as (n: string, p: { _limit: number }) => Promise<{ data: HistoryRow[] | null; error: { message: string } | null }>)(
        "admin_semantic_graph_materialization_history",
        { _limit: 20 },
      );
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const requestMaterialization = async () => {
    setRequesting(true);
    try {
      const { data, error } = await (supabase.rpc as unknown as (n: string, p: { _reason: string }) => Promise<{ data: { created?: boolean; reason?: string; job_id?: string } | null; error: { message: string } | null }>)(
        "admin_semantic_graph_request_materialization",
        { _reason: "manual_admin" },
      );
      if (error) throw new Error(error.message);
      if (data?.reason === "active_job_present") {
        toast.info("Materializer-Job läuft bereits in diesem 15-Min-Fenster.");
      } else if (data?.created) {
        toast.success("Materialisierung angefordert.");
      } else {
        toast.message("Anfrage akzeptiert.");
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sgc-health"] }),
        qc.invalidateQueries({ queryKey: ["sgc-history"] }),
      ]);
    } catch (e) {
      toast.error(`Anfrage fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setRequesting(false);
    }
  };

  const h = health.data;
  const tone = h?.freshness_state ? FRESHNESS_TONE[h.freshness_state] : undefined;
  const isHealthy = h?.freshness_state === "fresh";
  const recAction = h?.recommended_action ?? "none";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Network className="h-4 w-4 mt-0.5 text-text-secondary" />
          <div>
            <CardTitle className="text-base">Knowledge Graph — Crawl Observatory</CardTitle>
            <p className="text-xs text-text-tertiary mt-1">
              P6 — Freshness, Sitemap-Coverage und Materializer-Historie.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tone ? (
            <Badge variant={tone.variant} aria-label={`Freshness ${tone.label}`}>
              {isHealthy ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
              {tone.label}
            </Badge>
          ) : null}
          <Button size="sm" variant="outline" onClick={requestMaterialization} disabled={requesting} aria-label="Materialisierung anfordern">
            {requesting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Materialisierung anfordern
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {health.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-tertiary">
            <Loader2 className="h-3 w-3 animate-spin" /> Lade Health-Status…
          </div>
        ) : !h ? (
          <p className="text-sm text-text-tertiary">Keine Daten verfügbar.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Entities" value={h.entity_count} />
              <Stat label="Edges" value={h.edge_count} />
              <Stat label="Routes" value={h.route_count} />
              <Stat
                label="Sitemap-Coverage"
                value={h.sitemap_coverage_ratio == null ? "—" : `${Math.round(h.sitemap_coverage_ratio * 100)} %`}
                hint={`${h.sitemap_route_count} / ${h.route_count}`}
              />
              <Stat label="Orphans" value={h.orphan_count} tone={h.orphan_count > 0 ? "warn" : "ok"} />
              <Stat
                label="Snapshot-Alter"
                value={h.snapshot_age_minutes == null ? "—" : `${h.snapshot_age_minutes} min`}
              />
              <Stat label="Letzter Lauf" value={h.last_materialization_status ?? "—"} mono />
              <Stat label="Letzter Fehler" value={h.last_error_code ?? "—"} mono tone={h.last_error_code ? "warn" : undefined} />
            </div>
            <div className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-xs text-text-secondary">
              <span className="font-medium">Recommended Action:</span> {ACTION_HINT[recAction] ?? recAction}
            </div>
          </>
        )}

        <div>
          <div className="text-xs font-medium text-text-secondary mb-1.5">Letzte Materializer-Läufe</div>
          {history.isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : !history.data || history.data.length === 0 ? (
            <p className="text-xs text-text-tertiary">Noch keine Läufe protokolliert.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-text-tertiary">
                  <tr className="text-left">
                    <th className="py-1 pr-2">Start</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2 text-right">Ent.</th>
                    <th className="py-1 pr-2 text-right">Edges</th>
                    <th className="py-1 pr-2 text-right">Orph.</th>
                    <th className="py-1 pr-2">Dauer</th>
                    <th className="py-1 pr-2">Fehler</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((r) => (
                    <tr key={r.id} className="border-t border-border-subtle">
                      <td className="py-1 pr-2 font-mono text-text-secondary">{new Date(r.started_at).toISOString().slice(0, 19).replace("T", " ")}</td>
                      <td className="py-1 pr-2">
                        <Badge variant={r.status === "failed" ? "destructive" : r.status === "published" ? "default" : "secondary"} className="text-[10px]">
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.entity_count}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.edge_count}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.orphan_count}</td>
                      <td className="py-1 pr-2 text-text-tertiary">{fmtDuration(r.started_at, r.finished_at)}</td>
                      <td className="py-1 pr-2 font-mono text-text-tertiary">{r.error_code ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint, mono, tone }: { label: string; value: string | number; hint?: string; mono?: boolean; tone?: "ok" | "warn" }) {
  const toneClass = tone === "warn" ? "text-status-error" : tone === "ok" ? "text-status-success" : "text-text-primary";
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 ${toneClass} ${mono ? "font-mono" : ""}`}>{value}</div>
      {hint ? <div className="text-[10px] text-text-tertiary mt-0.5">{hint}</div> : null}
    </div>
  );
}
