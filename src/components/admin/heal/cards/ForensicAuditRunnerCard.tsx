/**
 * ForensicAuditRunnerCard
 * ───────────────────────
 * Tiefenforensisches Drift-Audit über 3 Klassen (queued_no_jobs,
 * ssot_step_drift, stale_processing). Liefert pro Klasse:
 * - Summary mit Severity (P0/P1/P2/info)
 * - Detail-Ansicht (Top 100, paginierbar via Limit-Param)
 * - Dry-Run + Real-Run Repair (Cap default 10)
 * - Export CSV/JSON pro Klasse
 *
 * Schema-Drift-Alarm: Wenn die Detail-RPC eine bekannte Schema-Version-Drift
 * meldet (Klasse `schema_drift`), wird ein P0-Toast + Cockpit-Banner gezeigt.
 */
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertTriangle, Beaker, Download, Play, RefreshCw, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

type DriftClass = "queued_no_jobs" | "ssot_step_drift" | "stale_processing";
type Severity = "P0" | "P1" | "P2" | "info";

interface ClassSummary {
  class: DriftClass;
  count: number;
  severity: Severity;
  description: string;
}
interface SummaryResponse {
  generated_at: string;
  classes: ClassSummary[];
}
interface DetailResponse {
  class: DriftClass;
  rows: Record<string, unknown>[];
}
interface RepairResponse {
  ok: boolean;
  class: DriftClass;
  dry_run: boolean;
  cap: number;
  processed: number;
  details: Array<Record<string, unknown>>;
}

const SEVERITY_META: Record<Severity, { label: string; cls: string }> = {
  P0: { label: "P0", cls: "bg-destructive-bg-subtle text-destructive border-destructive/40" },
  P1: { label: "P1", cls: "bg-warning-bg-subtle text-warning border-warning/40" },
  P2: { label: "P2", cls: "bg-primary/10 text-primary border-primary/30" },
  info: { label: "OK", cls: "bg-success-bg-subtle text-success border-success/30" },
};

const CLASS_LABEL: Record<DriftClass, string> = {
  queued_no_jobs: "Queued ohne Job",
  ssot_step_drift: "SSOT-Step-Drift",
  stale_processing: "Stale Processing",
};

function downloadFile(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k));
      return acc;
    }, new Set()),
  );
  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
}

export function ForensicAuditRunnerCard() {
  const qc = useQueryClient();
  const [activeClass, setActiveClass] = useState<DriftClass>("queued_no_jobs");
  const [cap, setCap] = useState<number>(10);
  const [alarmedFor, setAlarmedFor] = useState<Set<string>>(new Set());

  const summary = useQuery({
    queryKey: ["forensic-audit-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_forensic_audit_summary" as any);
      if (error) throw error;
      return data as unknown as SummaryResponse;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // P0-Alarmierung: einmal pro Klasse+Bucket toasten
  useEffect(() => {
    const cls = summary.data?.classes ?? [];
    cls.forEach((c) => {
      if (c.severity === "P0") {
        const key = `${c.class}:${c.count}`;
        if (!alarmedFor.has(key)) {
          toast.error(`Schema/Drift P0: ${CLASS_LABEL[c.class]} (${c.count})`, {
            description: c.description,
          });
          setAlarmedFor((prev) => new Set(prev).add(key));
        }
      }
    });
  }, [summary.data, alarmedFor]);

  const detail = useQuery({
    queryKey: ["forensic-audit-detail", activeClass],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_forensic_audit_detail" as any,
        { p_class: activeClass, p_limit: 200 },
      );
      if (error) throw error;
      return data as unknown as DetailResponse;
    },
    refetchInterval: 60_000,
  });

  const repair = useMutation({
    mutationFn: async ({ dryRun }: { dryRun: boolean }) => {
      const { data, error } = await supabase.rpc(
        "admin_repair_forensic_drift" as any,
        { p_class: activeClass, p_dry_run: dryRun, p_cap: cap },
      );
      if (error) throw error;
      return data as unknown as RepairResponse;
    },
    onSuccess: (res) => {
      toast[res.dry_run ? "info" : "success"](
        `${res.dry_run ? "Dry-Run" : "Repair"} ${CLASS_LABEL[res.class]}`,
        { description: `${res.processed} / Cap ${res.cap}` },
      );
      qc.invalidateQueries({ queryKey: ["forensic-audit-summary"] });
      qc.invalidateQueries({ queryKey: ["forensic-audit-detail", activeClass] });
    },
    onError: (e: Error) => toast.error("Repair fehlgeschlagen", { description: e.message }),
  });

  const rows = detail.data?.rows ?? [];
  const activeSummary = useMemo(
    () => summary.data?.classes.find((c) => c.class === activeClass),
    [summary.data, activeClass],
  );
  const hasP0 = (summary.data?.classes ?? []).some((c) => c.severity === "P0");

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Beaker className="h-4 w-4 text-primary" />
            Forensic Runner
            {hasP0 && (
              <Badge className={cn("ml-2", SEVERITY_META.P0.cls)}>
                <AlertTriangle className="h-3 w-3 mr-1" />
                P0 aktiv
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["forensic-audit-summary"] });
              qc.invalidateQueries({ queryKey: ["forensic-audit-detail"] });
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Summary-Grid */}
        {summary.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {(summary.data?.classes ?? []).map((c) => {
              const m = SEVERITY_META[c.severity];
              return (
                <button
                  key={c.class}
                  onClick={() => setActiveClass(c.class)}
                  className={cn(
                    "rounded-md border p-2 text-left transition-all",
                    activeClass === c.class ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-semibold text-foreground truncate">{CLASS_LABEL[c.class]}</span>
                    <Badge variant="outline" className={cn("h-4 px-1.5 text-[9px]", m.cls)}>
                      {m.label}
                    </Badge>
                  </div>
                  <div className="text-xl font-bold tabular-nums mt-1 text-foreground">{c.count}</div>
                </button>
              );
            })}
          </div>
        )}

        {/* Tab-Detail */}
        <Tabs value={activeClass} onValueChange={(v) => setActiveClass(v as DriftClass)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="queued_no_jobs" className="text-[10px]">Queued/Job</TabsTrigger>
            <TabsTrigger value="ssot_step_drift" className="text-[10px]">SSOT-Drift</TabsTrigger>
            <TabsTrigger value="stale_processing" className="text-[10px]">Stale Proc.</TabsTrigger>
          </TabsList>
          <TabsContent value={activeClass} className="space-y-3 pt-3">
            <div className="text-xs text-muted-foreground">
              {activeSummary?.description ?? "—"}
            </div>

            {/* Aktionen */}
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                Cap
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={cap}
                  onChange={(e) => setCap(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
                  className="w-14 h-7 rounded-md border border-border bg-background px-2 text-xs"
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={repair.isPending || rows.length === 0}
                onClick={() => repair.mutate({ dryRun: true })}
              >
                <Beaker className="h-3 w-3 mr-1" />
                Dry-Run
              </Button>
              <Button
                size="sm"
                disabled={repair.isPending || rows.length === 0}
                onClick={() => repair.mutate({ dryRun: false })}
              >
                <Play className="h-3 w-3 mr-1" />
                Repair (max {cap})
              </Button>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={rows.length === 0}
                  onClick={() => downloadFile(`forensic-${activeClass}.csv`, "text/csv", rowsToCsv(rows))}
                >
                  <Download className="h-3 w-3 mr-1" />
                  CSV
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={rows.length === 0}
                  onClick={() =>
                    downloadFile(
                      `forensic-${activeClass}.json`,
                      "application/json",
                      JSON.stringify({ class: activeClass, generated_at: new Date().toISOString(), rows }, null, 2),
                    )
                  }
                >
                  <Download className="h-3 w-3 mr-1" />
                  JSON
                </Button>
              </div>
            </div>

            {/* Detail-Tabelle */}
            {detail.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : rows.length === 0 ? (
              <div className="rounded-md border border-success/30 bg-success-bg-subtle p-3 text-xs text-success flex items-center gap-2">
                <Shield className="h-3.5 w-3.5" />
                Keine Drifts in dieser Klasse — sauber.
              </div>
            ) : (
              <div className="max-h-[280px] overflow-auto rounded-md border border-border">
                <table className="w-full text-[10px]">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      {Object.keys(rows[0]).map((k) => (
                        <th key={k} className="text-left px-2 py-1 font-semibold text-foreground">
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-border hover:bg-muted/20">
                        {Object.keys(rows[0]).map((k) => (
                          <td key={k} className="px-2 py-1 font-mono truncate max-w-[200px]" title={String(r[k] ?? "")}>
                            {r[k] == null ? "—" : typeof r[k] === "object" ? JSON.stringify(r[k]) : String(r[k])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 50 && (
                  <div className="px-2 py-1 text-[10px] text-muted-foreground">
                    … {rows.length - 50} weitere — nutze CSV/JSON-Export für Vollansicht.
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export default ForensicAuditRunnerCard;
