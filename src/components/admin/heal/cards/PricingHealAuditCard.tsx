/**
 * PricingHealAuditCard — Pricing-Cluster Audit-Report
 * ─────────────────────────────────────────────────────
 * Zeigt:
 *  - Pricing-Lücken pro Track × Gap-Type (NO_PRODUCT_LINK / NO_ACTIVE_PRICE / STRIPE_PRICE_ID_MISSING)
 *  - Heal-Run-Log der letzten 7 Tage (Vorher/Nachher blocked_reason, success/partial/skipped)
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type GapRow = { track: string; gap_type: string; package_count: number; packages: Array<{ id: string; title: string; status: string }> };
type RunRow = {
  id: string; created_at: string; package_id: string; package_title: string | null;
  result_status: string; reason: string | null;
  blocked_before: string | null; blocked_after: string | null;
  ready_before: boolean | null; ready_after: boolean | null;
  inserted_price: boolean | null; job_enqueued: boolean | null;
};

const STATUS_TONE: Record<string, string> = {
  success: "bg-status-bg-subtle text-status-success border-status-success/30",
  partial: "bg-status-bg-subtle text-status-warning border-status-warning/30",
  skipped: "bg-surface-subtle text-text-muted border-border-subtle",
  unknown: "bg-surface-subtle text-text-muted border-border-subtle",
};

export function PricingHealAuditCard() {
  const [expandedTrack, setExpandedTrack] = useState<string | null>(null);

  const gapsQ = useQuery({
    queryKey: ["pricing-gap-by-track"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_pricing_gap_by_track");
      if (error) throw error;
      return data as { generated_at: string; total_gaps: number; by_track_gate: GapRow[] };
    },
    refetchInterval: 60_000,
  });

  const runsQ = useQuery({
    queryKey: ["pricing-heal-runs"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_pricing_heal_runs", { p_hours: 168 });
      if (error) throw error;
      return data as { generated_at: string; window_hours: number; runs: RunRow[] };
    },
    refetchInterval: 60_000,
  });

  const totalGaps = gapsQ.data?.total_gaps ?? 0;
  const runs = runsQ.data?.runs ?? [];
  const byTrack = new Map<string, GapRow[]>();
  (gapsQ.data?.by_track_gate ?? []).forEach(r => {
    const arr = byTrack.get(r.track) ?? [];
    arr.push(r); byTrack.set(r.track, arr);
  });

  return (
    <Card className="shadow-elev-1">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            {totalGaps === 0
              ? <CheckCircle2 className="h-4 w-4 text-status-success" />
              : <AlertCircle className="h-4 w-4 text-status-warning" />}
            Pricing-Cluster Audit
          </CardTitle>
          <p className="text-xs text-text-muted mt-1">
            {totalGaps === 0 ? "Keine Pricing-Lücken." : `${totalGaps} Pakete mit Pricing-Lücken`} · {runs.length} Heal-Runs (7 Tage)
          </p>
        </div>
        <Button
          variant="ghost" size="sm"
          onClick={() => { gapsQ.refetch(); runsQ.refetch(); }}
          disabled={gapsQ.isFetching || runsQ.isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${gapsQ.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {totalGaps > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Lücken nach Track × Gate</h4>
            {Array.from(byTrack.entries()).map(([track, rows]) => {
              const open = expandedTrack === track;
              const trackTotal = rows.reduce((s, r) => s + r.package_count, 0);
              return (
                <div key={track} className="border border-border-subtle rounded-md">
                  <button
                    type="button"
                    onClick={() => setExpandedTrack(open ? null : track)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-subtle"
                  >
                    <div className="flex items-center gap-2">
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <span className="font-medium text-sm">{track}</span>
                      <Badge variant="outline" className="text-xs">{trackTotal} Pakete</Badge>
                    </div>
                    <div className="flex gap-1">
                      {rows.map(r => (
                        <Badge key={r.gap_type} variant="outline" className="text-xs">
                          {r.gap_type}: {r.package_count}
                        </Badge>
                      ))}
                    </div>
                  </button>
                  {open && (
                    <div className="px-3 pb-3 space-y-2 border-t border-border-subtle">
                      {rows.map(r => (
                        <div key={r.gap_type} className="text-xs">
                          <div className="font-medium text-text-secondary mt-2 mb-1">{r.gap_type}</div>
                          <ul className="space-y-1">
                            {r.packages.map(p => (
                              <li key={p.id} className="flex items-center justify-between">
                                <span className="truncate">{p.title}</span>
                                <Badge variant="outline" className="text-xs ml-2 shrink-0">{p.status}</Badge>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Heal-Run-Log (7 Tage)</h4>
          {runs.length === 0 ? (
            <p className="text-xs text-text-muted">Keine Pricing-Heal-Runs im Zeitfenster.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-text-muted border-b border-border-subtle">
                    <th className="py-2 pr-2">Wann</th>
                    <th className="py-2 pr-2">Paket</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2">Ready</th>
                    <th className="py-2 pr-2">Blocked</th>
                    <th className="py-2 pr-2">Job</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 50).map(r => (
                    <tr key={r.id} className="border-b border-border-subtle/50">
                      <td className="py-1.5 pr-2 text-text-muted whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="py-1.5 pr-2 max-w-[200px] truncate">{r.package_title ?? r.package_id.slice(0, 8)}</td>
                      <td className="py-1.5 pr-2">
                        <Badge variant="outline" className={`text-xs ${STATUS_TONE[r.result_status] ?? STATUS_TONE.unknown}`}>
                          {r.result_status}
                        </Badge>
                      </td>
                      <td className="py-1.5 pr-2">
                        {r.ready_before === false && r.ready_after === true ? "✓ heilte" : r.ready_after ? "✓" : r.ready_before ? "—" : "✗"}
                      </td>
                      <td className="py-1.5 pr-2 text-text-muted">
                        {r.blocked_before ?? "—"} → {r.blocked_after ?? "NULL"}
                      </td>
                      <td className="py-1.5 pr-2">{r.job_enqueued ? "✓" : "—"}</td>
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
