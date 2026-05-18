/**
 * PricingHealAuditCard — Pricing-Cluster Audit-Report
 * ─────────────────────────────────────────────────────
 * Zeigt:
 *  - Pricing-Lücken pro Track × Gap-Type (NO_PRODUCT_LINK / NO_ACTIVE_PRICE / STRIPE_PRICE_ID_MISSING)
 *  - Heal-Run-Log der letzten 7 Tage (Vorher/Nachher blocked_reason, success/partial/skipped)
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle2, RefreshCw, Search, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

const JOB_STATUS_TONE: Record<string, string> = {
  pending: "bg-status-bg-subtle text-status-info border-status-info/30",
  queued: "bg-status-bg-subtle text-status-info border-status-info/30",
  processing: "bg-status-warning-bg-subtle text-status-warning border-status-warning-border",
  running: "bg-status-warning-bg-subtle text-status-warning border-status-warning-border",
  completed: "bg-status-success-bg-subtle text-status-success border-status-success-border",
  failed: "bg-status-bg-subtle text-status-error border-status-error/30",
  cancelled: "bg-surface-subtle text-text-muted border-border-subtle",
};

function PackageDetailDialog({ packageId, onClose }: { packageId: string | null; onClose: () => void }) {
  const visible = !!packageId;
  const q = useQuery({
    queryKey: ["pricing-pkg-detail", packageId],
    enabled: visible,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_pricing_package_detail", { p_package_id: packageId! });
      if (error) throw error;
      return data as any;
    },
    // Live-Refresh nur bei sichtbarem Dialog + erfolgreich geladenem Datensatz.
    // Exponential-Backoff bei Fehlern: 10s → 20s → 40s → 80s → max 5min, stop nach 6 Fehlern.
    refetchInterval: (query) => {
      if (!visible) return false;
      const errs = query.state.errorUpdateCount ?? 0;
      if (errs >= 6) return false;
      if (errs > 0) return Math.min(10_000 * 2 ** errs, 300_000);
      return query.state.data ? 10_000 : false;
    },
    retry: (failureCount) => failureCount < 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
  });
  const d = q.data;
  const pkg = d?.package;
  const jobsAll: any[] = d?.auto_publish_jobs ?? [];
  const jobsRecent = jobsAll.slice(0, 10);
  const lastJob = jobsRecent[0];
  return (
    <Dialog open={!!packageId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            {pkg?.title ?? "Paket-Detail"}
            <Button
              variant="ghost" size="sm" className="h-6 w-6 p-0"
              onClick={() => q.refetch()} disabled={q.isFetching}
              title="Live-Status neu laden"
            >
              <RefreshCw className={`h-3 w-3 ${q.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </DialogTitle>
        </DialogHeader>
        {q.isLoading && <p className="text-xs text-text-muted">Lade…</p>}
        {d && (
          <div className="space-y-4 text-xs">
            {lastJob && (
              <div className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted text-[11px] uppercase tracking-wide">Letzter Auto-Publish-Job</span>
                  <Badge variant="outline" className={`text-xs ${JOB_STATUS_TONE[lastJob.status] ?? JOB_STATUS_TONE.pending}`}>
                    {lastJob.status}
                  </Badge>
                </div>
                <div className="mt-1 text-text-secondary">
                  {new Date(lastJob.created_at).toLocaleString("de-DE")} · Quelle: {lastJob.enqueue_source ?? "—"}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-text-muted">Status:</span> <Badge variant="outline">{pkg.status}</Badge></div>
              <div><span className="text-text-muted">Track:</span> {pkg.track_slug ?? "—"}</div>
              <div><span className="text-text-muted">Blocked:</span> {pkg.blocked_reason ?? "NULL"}</div>
              <div>
                <span className="text-text-muted">Stripe-Preis aktiv:</span>{" "}
                {pkg.has_active_stripe_price
                  ? <Badge className="bg-status-success-bg-subtle text-status-success border-status-success-border">JA</Badge>
                  : <Badge className="bg-status-bg-subtle text-status-error border-status-error/30">NEIN</Badge>}
              </div>
            </div>
            <div>
              <h5 className="font-semibold mb-1">Produkt-Preise ({d.prices.length})</h5>
              {d.prices.length === 0
                ? <p className="text-text-muted">Keine Preise.</p>
                : (
                  <table className="w-full">
                    <thead><tr className="text-text-muted border-b border-border-subtle">
                      <th className="text-left py-1">Betrag</th><th className="text-left py-1">Stripe ID</th><th className="text-left py-1">Aktiv</th>
                    </tr></thead>
                    <tbody>
                      {d.prices.map((p: any) => (
                        <tr key={p.id} className="border-b border-border-subtle/40">
                          <td className="py-1">{(p.amount_cents/100).toFixed(2)} {p.currency}</td>
                          <td className="py-1 font-mono text-[10px]">{p.stripe_price_id ?? "—"}</td>
                          <td className="py-1">{p.active ? "✓" : "✗"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
            <div>
              <h5 className="font-semibold mb-1">Heal-Runs (letzte {d.heal_runs.length})</h5>
              {d.heal_runs.length === 0
                ? <p className="text-text-muted">Keine Runs.</p>
                : (
                  <ul className="space-y-1">
                    {d.heal_runs.map((r: any) => (
                      <li key={r.id} className="border-b border-border-subtle/40 pb-1">
                        <div className="flex justify-between">
                          <span className="text-text-muted">{new Date(r.created_at).toLocaleString("de-DE")}</span>
                          <Badge variant="outline" className="text-[10px]">{r.result_status}</Badge>
                        </div>
                        <div className="text-text-muted">
                          ready: {String(r.ready_before)} → {String(r.ready_after)} · blocked: {r.blocked_before ?? "—"} → {pkg.blocked_reason ?? "NULL"} · job: {r.job_enqueued ? "✓" : "—"}
                          {r.reason && <> · <span className="italic">{r.reason}</span></>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
            <div>
              <h5 className="font-semibold mb-1">
                Auto-Publish-Jobs (letzte {jobsRecent.length}{jobsAll.length > jobsRecent.length ? ` von ${jobsAll.length}` : ""})
              </h5>
              {jobsRecent.length === 0
                ? <p className="text-text-muted">Keine Jobs.</p>
                : (
                  <table className="w-full">
                    <thead><tr className="text-text-muted border-b border-border-subtle">
                      <th className="text-left py-1">Wann</th>
                      <th className="text-left py-1">Status</th>
                      <th className="text-left py-1">Quelle</th>
                    </tr></thead>
                    <tbody>
                      {jobsRecent.map((j: any) => (
                        <tr key={j.id} className="border-b border-border-subtle/40">
                          <td className="py-1 whitespace-nowrap">{new Date(j.created_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</td>
                          <td className="py-1">
                            <Badge variant="outline" className={`text-[10px] ${JOB_STATUS_TONE[j.status] ?? JOB_STATUS_TONE.pending}`}>
                              {j.status}
                            </Badge>
                          </td>
                          <td className="py-1 text-text-muted">{j.enqueue_source ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              {q.isError && (
                <p className="text-[11px] text-status-error mt-1">
                  Fehler beim Live-Refresh — Backoff aktiv ({q.errorUpdateCount}/6).
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type GapRow = { track: string; gap_type: string; package_count: number; packages: Array<{ id: string; title: string; status: string }> };
type RunRow = {
  id: string; created_at: string; package_id: string; package_title: string | null;
  result_status: string; reason: string | null;
  blocked_before: string | null; blocked_after: string | null;
  ready_before: boolean | null; ready_after: boolean | null;
  inserted_price: boolean | null; job_enqueued: boolean | null;
};

const STATUS_TONE: Record<string, string> = {
  success: "bg-status-success-bg-subtle text-status-success border-status-success-border",
  partial: "bg-status-warning-bg-subtle text-status-warning border-status-warning-border",
  skipped: "bg-surface-subtle text-text-muted border-border-subtle",
  unknown: "bg-surface-subtle text-text-muted border-border-subtle",
};

export function PricingHealAuditCard() {
  const [expandedTrack, setExpandedTrack] = useState<string | null>(null);
  const [detailPkg, setDetailPkg] = useState<string | null>(null);
  const [filterCluster, setFilterCluster] = useState<string>("all");
  const [filterReason, setFilterReason] = useState<string>("all");
  const [filterPkg, setFilterPkg] = useState<string>("");

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
  const allRows = gapsQ.data?.by_track_gate ?? [];
  const reasonOptions = Array.from(new Set(allRows.map(r => r.gap_type))).sort();
  const trackOptions = Array.from(new Set(allRows.map(r => r.track))).sort();

  const filteredRows: GapRow[] = allRows
    .filter(r => filterCluster === "all" || r.track === filterCluster)
    .filter(r => filterReason === "all" || r.gap_type === filterReason)
    .map(r => ({
      ...r,
      packages: filterPkg
        ? r.packages.filter(p => p.title.toLowerCase().includes(filterPkg.toLowerCase()) || p.id.includes(filterPkg))
        : r.packages,
    }))
    .filter(r => r.packages.length > 0);

  const filteredTotal = filteredRows.reduce((s, r) => s + r.packages.length, 0);
  const runs = runsQ.data?.runs ?? [];
  const byTrack = new Map<string, GapRow[]>();
  filteredRows.forEach(r => {
    const arr = byTrack.get(r.track) ?? [];
    arr.push(r); byTrack.set(r.track, arr);
  });

  const exportCsv = () => {
    const header = ["track", "gap_type", "package_id", "package_title", "package_status"];
    const lines = [header.join(",")];
    filteredRows.forEach(r => r.packages.forEach(p => {
      const row = [r.track, r.gap_type, p.id, `"${(p.title ?? "").replace(/"/g, '""')}"`, p.status];
      lines.push(row.join(","));
    }));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `pricing-gaps-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

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
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={exportCsv} disabled={filteredTotal === 0} title="Gefilterte Lücken als CSV exportieren">
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost" size="sm"
            onClick={() => { gapsQ.refetch(); runsQ.refetch(); }}
            disabled={gapsQ.isFetching || runsQ.isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${gapsQ.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {totalGaps > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              <Select value={filterCluster} onValueChange={setFilterCluster}>
                <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Cluster" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Cluster</SelectItem>
                  {trackOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterReason} onValueChange={setFilterReason}>
                <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Reason" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Reasons</SelectItem>
                  {reasonOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                value={filterPkg}
                onChange={(e) => setFilterPkg(e.target.value)}
                placeholder="Paket-Titel oder ID…"
                className="h-8 text-xs flex-1 min-w-[180px]"
              />
            </div>
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
              Lücken nach Track × Gate {filteredTotal !== totalGaps && `(${filteredTotal}/${totalGaps} gefiltert)`}
            </h4>
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
                              <li key={p.id} className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => setDetailPkg(p.id)}
                                  className="flex items-center gap-1 truncate text-left hover:underline text-link"
                                >
                                  <Search className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{p.title}</span>
                                </button>
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
          </>
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
                    <tr
                      key={r.id}
                      className="border-b border-border-subtle/50 cursor-pointer hover:bg-surface-subtle"
                      onClick={() => setDetailPkg(r.package_id)}
                    >
                      <td className="py-1.5 pr-2 text-text-muted whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="py-1.5 pr-2 max-w-[200px] truncate text-link">{r.package_title ?? r.package_id.slice(0, 8)}</td>
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
      <PackageDetailDialog packageId={detailPkg} onClose={() => setDetailPkg(null)} />
    </Card>
  );
}
