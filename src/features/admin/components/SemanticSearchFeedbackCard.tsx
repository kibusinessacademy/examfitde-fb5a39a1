import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, BarChart3, EyeOff, Loader2, SearchCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

interface Summary {
  total_routes: number;
  performing_count: number;
  no_signal_count: number;
  impressions_no_clicks_count: number;
  not_in_sitemap_count: number;
  not_in_graph_count: number;
  total_impressions_28d: number;
  total_clicks_28d: number;
  avg_ctr_28d: number;
}

interface RouteRow {
  route_path: string;
  route_kind: string;
  route_key: string;
  entity_label: string;
  search_state: string;
  impressions_28d: number;
  clicks_28d: number;
  ctr_28d: number;
  avg_position_28d: number | null;
  recommended_action: string;
}

interface HealthPayload {
  summary: Summary;
  top_routes: RouteRow[];
  attention_routes: RouteRow[];
  error?: string;
}

const STATE_LABEL: Record<string, string> = {
  performing: "Performing",
  impressions_no_clicks: "Impressions ohne Klicks",
  no_search_signal: "Kein Suchsignal",
  not_in_sitemap: "Nicht in Sitemap",
  not_in_graph: "Nicht im Graph",
  needs_observation: "Beobachten",
};

const ACTION_LABEL: Record<string, string> = {
  none: "Keine Aktion",
  improve_snippet: "Snippet prüfen",
  wait_for_indexing: "Indexierung abwarten",
  check_sitemap: "Sitemap prüfen",
  check_graph_route: "Graph-Route prüfen",
  review_search_intent: "Suchintention prüfen",
};

function pct(n: number | null | undefined): string {
  if (n == null || !isFinite(Number(n))) return "—";
  return `${(Number(n) * 100).toFixed(1)} %`;
}

function pos(n: number | null | undefined): string {
  if (n == null || !isFinite(Number(n))) return "—";
  return Number(n).toFixed(1);
}

export function SemanticSearchFeedbackCard() {
  const qc = useQueryClient();
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const health = useQuery({
    queryKey: ["semantic-search-health"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as (n: string) => Promise<{ data: HealthPayload | null; error: { message: string } | null }>)(
        "admin_semantic_search_health",
      );
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data as HealthPayload;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const runImport = async () => {
    setImporting(true);
    try {
      const payload = JSON.parse(importText);
      const { data, error } = await (supabase.rpc as unknown as (n: string, p: { _payload: unknown }) => Promise<{ data: { imported?: number; rejected?: number; error?: string } | null; error: { message: string } | null }>)(
        "admin_import_semantic_search_metrics",
        { _payload: payload },
      );
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(`Search-Metriken importiert: ${data?.imported ?? 0} übernommen, ${data?.rejected ?? 0} verworfen.`);
      setImportText("");
      await qc.invalidateQueries({ queryKey: ["semantic-search-health"] });
    } catch (e) {
      toast.error(`Import fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  const summary = health.data?.summary;

  return (
    <Card data-semantic-search-feedback-card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <SearchCheck className="h-4 w-4 mt-0.5 text-text-secondary" />
          <div>
            <CardTitle className="text-base">Wissen-Routen — Search Feedback</CardTitle>
            <p className="text-xs text-text-tertiary mt-1">
              P7 — GSC-Feedback, Attention Queue und Indexability Evidence. Kein Auto-Rewrite.
            </p>
          </div>
        </div>
        <Badge variant="outline">RPC-only</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {health.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-tertiary">
            <Loader2 className="h-3 w-3 animate-spin" /> Lade Search Feedback…
          </div>
        ) : health.isError ? (
          <div className="rounded-md border border-status-error-border bg-status-error-bg-subtle px-3 py-2 text-sm text-status-error-fg">
            {(health.error as Error).message}
          </div>
        ) : summary ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Routen" value={summary.total_routes} icon={<BarChart3 className="h-3 w-3" />} />
              <Stat label="Mit Klicks" value={summary.performing_count} />
              <Stat label="Ohne Suchsignal" value={summary.no_signal_count} icon={<EyeOff className="h-3 w-3" />} />
              <Stat label="Imp. ohne Klicks" value={summary.impressions_no_clicks_count} />
              <Stat label="28d Impressions" value={summary.total_impressions_28d} />
              <Stat label="28d Clicks" value={summary.total_clicks_28d} />
              <Stat label="CTR 28d" value={pct(summary.avg_ctr_28d)} />
              <Stat label="Graph/Sitemap Drift" value={summary.not_in_graph_count + summary.not_in_sitemap_count} />
            </div>

            <RouteTable title="Attention Queue" rows={health.data?.attention_routes ?? []} />
            <RouteTable title="Top-Routen" rows={health.data?.top_routes ?? []} compact />
          </>
        ) : null}

        <div className="rounded-lg border border-border-subtle bg-surface-sunken p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-text-secondary">GSC JSON importieren</div>
              <p className="text-[11px] text-text-tertiary">Nur aggregierte `/wissen/...` Routen-Metriken. Keine Query-Dumps, keine Secrets.</p>
            </div>
            <Button size="sm" variant="outline" onClick={runImport} disabled={importing || !importText.trim()}>
              {importing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
              Import
            </Button>
          </div>
          <Textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='{"source":"gsc","rows":[{"route_path":"/wissen/beruf/industriekaufmann","date":"2026-05-20","impressions":120,"clicks":8,"avg_position":12.4}]}'
            className="font-mono text-xs min-h-[86px]"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-tertiary">
        {icon} {label}
      </div>
      <div className="text-sm font-semibold mt-0.5 text-text-primary tabular-nums">{value}</div>
    </div>
  );
}

function RouteTable({ title, rows, compact }: { title: string; rows: RouteRow[]; compact?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium text-text-secondary mb-1.5 flex items-center gap-1">
        <Activity className="h-3 w-3" /> {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-text-tertiary">Keine Einträge.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-subtle">
          <table className="w-full text-xs">
            <thead className="text-text-tertiary bg-surface-sunken">
              <tr className="text-left">
                <th className="py-1.5 px-2">Route</th>
                <th className="py-1.5 px-2">Status</th>
                <th className="py-1.5 px-2 text-right">Imp.</th>
                <th className="py-1.5 px-2 text-right">Clicks</th>
                <th className="py-1.5 px-2 text-right">CTR</th>
                {!compact ? <th className="py-1.5 px-2 text-right">Pos.</th> : null}
                {!compact ? <th className="py-1.5 px-2">Aktion</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${title}:${r.route_path}`} className="border-t border-border-subtle">
                  <td className="py-1.5 px-2 font-mono text-text-secondary max-w-[340px] truncate" title={r.route_path}>{r.route_path}</td>
                  <td className="py-1.5 px-2"><Badge variant={r.search_state === "performing" ? "default" : "secondary"} className="text-[10px]">{STATE_LABEL[r.search_state] ?? r.search_state}</Badge></td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.impressions_28d}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.clicks_28d}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{pct(r.ctr_28d)}</td>
                  {!compact ? <td className="py-1.5 px-2 text-right tabular-nums">{pos(r.avg_position_28d)}</td> : null}
                  {!compact ? <td className="py-1.5 px-2 text-text-tertiary">{ACTION_LABEL[r.recommended_action] ?? r.recommended_action}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
