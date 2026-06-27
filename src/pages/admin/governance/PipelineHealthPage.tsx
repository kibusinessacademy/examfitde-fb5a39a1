import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Flame, Download, RefreshCw, AlertOctagon, AlertTriangle, Activity } from "lucide-react";

type Severity = "critical" | "high" | "medium";
type Health = "green" | "yellow" | "red";

interface ActionItem {
  code: string; job_type: string; severity: Severity; metric: number; detail: string;
}
interface JobTypeKpi {
  job_type: string; total: number; completed: number; failed: number; cancelled: number;
  pending: number; processing: number; blocked: number;
  success_rate: number; cancel_ratio: number; fail_ratio: number;
  avg_fail_attempts: number; last_activity: string | null; health: Health;
}
interface Projection {
  generated_at: string;
  projector_version: string;
  totals: {
    job_types: number; pending: number; processing: number; completed: number;
    failed: number; cancelled: number; blocked: number; success_rate: number;
    dlq_unresolved: number; stuck_running: number;
  };
  job_types: JobTypeKpi[];
  action_queue: ActionItem[];
  dlq_by_category: { category: string; count: number; sample_job_type: string }[];
  stuck_top: { id: string; job_type: string; worker_pool: string | null; running_for_seconds: number; attempts: number }[];
}

const SEV_VARIANT: Record<Severity, "destructive" | "default" | "secondary"> = {
  critical: "destructive", high: "default", medium: "secondary",
};
const HEALTH_VARIANT: Record<Health, "default" | "secondary" | "destructive"> = {
  green: "default", yellow: "secondary", red: "destructive",
};
const ACTION_LABEL: Record<string, string> = {
  STUCK_RUNNING: "Hängender Job",
  CANCEL_LOOP: "Cancel-Loop",
  HIGH_FAIL_RATE: "Hohe Fehlerrate",
  STALE_PENDING: "Pending überaltert",
  BLOCKED_BACKLOG: "Blocked-Stau",
  DLQ_BACKLOG: "Dead-Letter Stau",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
const fmtSec = (s: number) => s >= 3600 ? `${Math.round(s / 360) / 10}h` : `${Math.round(s / 60)}min`;

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

export default function PipelineHealthPage() {
  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["pipeline-health"],
    queryFn: async (): Promise<Projection> => {
      const { data, error } = await supabase.functions.invoke("evaluate-pipeline-health", { body: {} });
      if (error) throw error;
      if (!data?.projection) throw new Error("Keine Projektion erhalten");
      return data.projection as Projection;
    },
    refetchInterval: 60_000,
  });

  const t = data?.totals;
  const redCount = useMemo(() => data?.job_types.filter((k) => k.health === "red").length ?? 0, [data]);

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Pipeline Health Cockpit</h1>
            <p className="text-muted-foreground">
              Deterministische Projektion über bestehende Job-SSOT-Views. Read-only, kein Eingriff in Worker oder Queue.
              Auto-Refresh 60 s.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch().then(() => toast.success("Aktualisiert"))} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lade Pipeline-Projektion …</div>
      ) : !data ? (
        <Card><CardContent className="pt-6 text-destructive">Konnte Pipeline-Health nicht laden.</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Job-Types</div><div className="text-2xl font-bold">{t!.job_types}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Pending</div><div className="text-2xl font-bold">{t!.pending}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Processing</div><div className="text-2xl font-bold">{t!.processing}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Success-Rate</div><div className={`text-2xl font-bold ${t!.success_rate >= 0.7 ? "text-green-600" : "text-destructive"}`}>{pct(t!.success_rate)}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">DLQ unresolved</div><div className={`text-2xl font-bold ${t!.dlq_unresolved > 0 ? "text-amber-600" : ""}`}>{t!.dlq_unresolved}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Stuck running</div><div className={`text-2xl font-bold ${t!.stuck_running > 0 ? "text-destructive" : ""}`}>{t!.stuck_running}</div></CardContent></Card>
          </div>

          {data.action_queue.length > 0 && (
            <Card className="border-amber-500/50">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Flame className="h-4 w-4 text-amber-500" />
                  Action Queue — {data.action_queue.length} priorisierte Hebel
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => csvDownload(data.action_queue, "pipeline-actions.csv")}>
                  <Download className="mr-2 h-4 w-4" /> CSV
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.action_queue.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                      <div className="text-xl font-bold text-muted-foreground w-6">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant={SEV_VARIANT[a.severity]} className="uppercase text-[10px]">{a.severity}</Badge>
                          <span className="font-medium text-sm">{ACTION_LABEL[a.code] ?? a.code}</span>
                          <code className="text-xs text-muted-foreground truncate">{a.job_type}</code>
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">{a.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><AlertOctagon className="h-4 w-4" /> Top 10 hängende Jobs</CardTitle></CardHeader>
              <CardContent>
                {data.stuck_top.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Keine Jobs überhängen aktuell die SLA. 👌</div>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Job-Type</TableHead><TableHead>Pool</TableHead>
                      <TableHead className="text-right">Läuft seit</TableHead><TableHead className="text-right">Versuche</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {data.stuck_top.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono text-xs">{s.job_type}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{s.worker_pool ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtSec(s.running_for_seconds)}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.attempts}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" /> Dead-Letter nach Kategorie</CardTitle></CardHeader>
              <CardContent>
                {data.dlq_by_category.length === 0 ? (
                  <div className="text-sm text-muted-foreground">DLQ ist leer.</div>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Kategorie</TableHead><TableHead>Beispiel Job-Type</TableHead><TableHead className="text-right">Anzahl</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {data.dlq_by_category.map((d) => (
                        <TableRow key={d.category}>
                          <TableCell className="font-medium">{d.category}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{d.sample_job_type}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4" /> Job-Types nach Health ({redCount} rot)
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => csvDownload(data.job_types, "pipeline-job-types.csv")}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Job-Type</TableHead><TableHead>Health</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="text-right">Success</TableHead>
                    <TableHead className="text-right">Cancel</TableHead>
                    <TableHead className="text-right">Fail</TableHead>
                    <TableHead className="text-right">Blocked</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.job_types.map((k) => (
                      <TableRow key={k.job_type}>
                        <TableCell className="font-mono text-xs max-w-xs truncate">{k.job_type}</TableCell>
                        <TableCell><Badge variant={HEALTH_VARIANT[k.health]}>{k.health}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{k.total}</TableCell>
                        <TableCell className="text-right tabular-nums">{k.pending}</TableCell>
                        <TableCell className={`text-right tabular-nums ${k.success_rate >= 0.7 ? "text-green-600" : "text-muted-foreground"}`}>{pct(k.success_rate)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${k.cancel_ratio > 0.5 ? "text-destructive" : "text-muted-foreground"}`}>{pct(k.cancel_ratio)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${k.fail_ratio > 0.2 ? "text-destructive" : "text-muted-foreground"}`}>{pct(k.fail_ratio)}</TableCell>
                        <TableCell className="text-right tabular-nums">{k.blocked}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="text-xs text-muted-foreground text-right">
            Projector {data.projector_version} · generiert {new Date(data.generated_at).toLocaleString("de-DE")} ·
            UI-Snapshot {new Date(dataUpdatedAt).toLocaleTimeString("de-DE")}
          </div>
        </>
      )}
    </div>
  );
}
