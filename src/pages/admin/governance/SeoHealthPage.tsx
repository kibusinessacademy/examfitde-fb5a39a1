import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Flame, Download, RefreshCw, Link2, AlertTriangle, GitBranch, Search } from "lucide-react";

type Severity = "critical" | "high" | "medium" | "low";

interface ActionItem {
  code: string; severity: Severity; target: string; metric: number;
  detail: string; recommendation: string;
}
interface ReadinessGap {
  package_id: string; package_title: string; missing: string[];
  thin_content: number; orphaned_pillars: number; pending_spokes: number;
  pending_blogs: number; suggested_unaccepted_links: number;
}
interface Projection {
  generated_at: string;
  projector_version: string;
  totals: {
    packages_total: number; packages_customer_safe: number; packages_intent_healthy: number;
    packages_dead_end: number; canonical_drift_critical: number;
    bridge_candidates_total: number; bridge_ready_to_link: number; bridge_duplicates: number;
    orphans_total: number; orphans_no_inbound: number; orphans_no_outbound: number;
    suggested_links_unaccepted: number; customer_safe_rate: number;
  };
  action_queue: ActionItem[];
  readiness_gaps_top: ReadinessGap[];
  bridge_layer_matrix: { source_layer: string; target_layer: string; ready: number; blocked_dupe: number }[];
  orphan_by_role: { node_role: string; no_inbound: number; no_outbound: number }[];
  dead_end_reasons: { reason: string; count: number; sample_package_id: string | null }[];
}

const SEV_VARIANT: Record<Severity, "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive", high: "default", medium: "secondary", low: "outline",
};
const ACTION_LABEL: Record<string, string> = {
  CANONICAL_DRIFT: "Canonical-Drift",
  DEAD_END_PACKAGE: "SEO-Dead-End",
  READINESS_GAP: "Readiness-Lücke",
  ORPHAN_NO_INBOUND: "Orphan (kein Inbound)",
  ORPHAN_NO_OUTBOUND: "Orphan (kein Outbound)",
  BRIDGE_READY: "Bridge bereit",
  BRIDGE_DUPLICATE: "Bridge-Duplikate",
  PILLAR_ORPHANED: "Pillar ohne Spokes",
  THIN_CONTENT_RISK: "Thin Content",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

function csvDownload(rows: any[], filename: string) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function SeoHealthPage() {
  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["seo-health"],
    queryFn: async (): Promise<Projection> => {
      const { data, error } = await supabase.functions.invoke("evaluate-seo-health", { body: {} });
      if (error) throw error;
      if (!data?.projection) throw new Error("Keine Projektion erhalten");
      return data.projection as Projection;
    },
    refetchInterval: 90_000,
  });

  const t = data?.totals;
  const criticalCount = useMemo(
    () => data?.action_queue.filter((a) => a.severity === "critical").length ?? 0,
    [data],
  );

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">SEO Health Cockpit</h1>
            <p className="text-muted-foreground">
              Deterministische Projektion über bestehende SEO-SSOT-Views. Read-only, kein Eingriff in Bridges, Indexer oder Render.
              Auto-Refresh 90 s.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch().then(() => toast.success("Aktualisiert"))} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lade SEO-Projektion …
        </div>
      ) : !data ? (
        <Card><CardContent className="pt-6 text-destructive">Konnte SEO-Health nicht laden.</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Card><CardContent className="pt-6">
              <div className="text-xs text-muted-foreground">Pakete</div>
              <div className="text-2xl font-bold">{t!.packages_total}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-xs text-muted-foreground">Customer-Safe</div>
              <div className={`text-2xl font-bold ${t!.customer_safe_rate >= 0.5 ? "text-green-600" : "text-destructive"}`}>
                {t!.packages_customer_safe} <span className="text-sm font-normal">({pct(t!.customer_safe_rate)})</span>
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-xs text-muted-foreground">Dead-Ends</div>
              <div className={`text-2xl font-bold ${t!.packages_dead_end > 0 ? "text-destructive" : ""}`}>{t!.packages_dead_end}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-xs text-muted-foreground">Canonical-Drift</div>
              <div className={`text-2xl font-bold ${t!.canonical_drift_critical > 0 ? "text-destructive" : ""}`}>{t!.canonical_drift_critical}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-xs text-muted-foreground">Bridges ready</div>
              <div className="text-2xl font-bold text-green-600">{t!.bridge_ready_to_link}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-xs text-muted-foreground">Orphans</div>
              <div className={`text-2xl font-bold ${t!.orphans_no_inbound > 0 ? "text-amber-600" : ""}`}>
                {t!.orphans_total} <span className="text-sm font-normal">({t!.orphans_no_inbound} ohne Inbound)</span>
              </div>
            </CardContent></Card>
          </div>

          {data.action_queue.length > 0 && (
            <Card className="border-amber-500/50">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Flame className="h-4 w-4 text-amber-500" />
                  Action Queue — {data.action_queue.length} priorisierte Hebel ({criticalCount} kritisch)
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => csvDownload(data.action_queue, "seo-actions.csv")}>
                  <Download className="mr-2 h-4 w-4" /> CSV
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.action_queue.map((a, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                      <div className="text-xl font-bold text-muted-foreground w-6 pt-0.5">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={SEV_VARIANT[a.severity]} className="uppercase text-[10px]">{a.severity}</Badge>
                          <span className="font-medium text-sm">{ACTION_LABEL[a.code] ?? a.code}</span>
                          <code className="text-xs text-muted-foreground truncate max-w-md">{a.target}</code>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">{a.detail}</div>
                        <div className="text-xs text-foreground/80 mt-1">→ {a.recommendation}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Search className="h-4 w-4" /> Top Readiness-Lücken (Top 20)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.readiness_gaps_top.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Alle Pakete sind ready. 🎉</div>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Paket</TableHead>
                      <TableHead className="text-right">Lücken</TableHead>
                      <TableHead className="text-right">Thin</TableHead>
                      <TableHead className="text-right">Links offen</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {data.readiness_gaps_top.map((g) => (
                        <TableRow key={g.package_id}>
                          <TableCell className="font-medium text-xs max-w-[14rem] truncate" title={g.package_title}>{g.package_title}</TableCell>
                          <TableCell className="text-right tabular-nums">{g.missing.length}</TableCell>
                          <TableCell className="text-right tabular-nums">{g.thin_content}</TableCell>
                          <TableCell className="text-right tabular-nums">{g.suggested_unaccepted_links}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4" /> Dead-End-Gründe
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.dead_end_reasons.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Keine Dead-Ends.</div>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Grund</TableHead>
                      <TableHead>Beispiel-Paket</TableHead>
                      <TableHead className="text-right">Anzahl</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {data.dead_end_reasons.map((d) => (
                        <TableRow key={d.reason}>
                          <TableCell className="font-medium text-sm">{d.reason}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[10rem]">{d.sample_package_id}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-4 w-4" /> Bridge-Matrix (Layer→Layer)
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => csvDownload(data.bridge_layer_matrix, "seo-bridge-matrix.csv")}>
                  <Download className="mr-2 h-4 w-4" /> CSV
                </Button>
              </CardHeader>
              <CardContent>
                {data.bridge_layer_matrix.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Keine Bridge-Kandidaten.</div>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Quelle</TableHead>
                      <TableHead>Ziel</TableHead>
                      <TableHead className="text-right">Ready</TableHead>
                      <TableHead className="text-right">Dupes</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {data.bridge_layer_matrix.map((b) => (
                        <TableRow key={`${b.source_layer}>${b.target_layer}`}>
                          <TableCell className="font-mono text-xs">{b.source_layer}</TableCell>
                          <TableCell className="font-mono text-xs">{b.target_layer}</TableCell>
                          <TableCell className="text-right tabular-nums text-green-600">{b.ready}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{b.blocked_dupe}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="h-4 w-4" /> Orphans nach Node-Rolle
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.orphan_by_role.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Keine Orphans erkannt.</div>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Rolle</TableHead>
                      <TableHead className="text-right">Kein Inbound</TableHead>
                      <TableHead className="text-right">Kein Outbound</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {data.orphan_by_role.map((o) => (
                        <TableRow key={o.node_role}>
                          <TableCell className="font-medium text-sm">{o.node_role}</TableCell>
                          <TableCell className="text-right tabular-nums">{o.no_inbound}</TableCell>
                          <TableCell className="text-right tabular-nums">{o.no_outbound}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="text-xs text-muted-foreground text-right">
            Projector {data.projector_version} · generiert {new Date(data.generated_at).toLocaleString("de-DE")} ·
            UI-Snapshot {new Date(dataUpdatedAt).toLocaleTimeString("de-DE")}
          </div>
        </>
      )}
    </div>
  );
}
