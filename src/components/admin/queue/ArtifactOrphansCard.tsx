import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Bug, ChevronDown, Loader2, Trash2, Wand2, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

type SummaryRow = {
  cluster_key: string;
  table_name: string;
  reason: string;
  severity: string;
  orphan_count: number;
  distinct_curricula: number;
  distinct_packages: number;
};

type DetailRow = {
  table_name: string;
  artifact_id: string;
  curriculum_id: string | null;
  package_id: string | null;
  reason: string;
  severity: string;
  curriculum_exists: boolean;
  package_exists: boolean;
  package_status: string | null;
  backfill_possible: boolean;
  suggested_package_id: string | null;
};

type AuditRow = {
  id: string;
  table_name: string;
  curriculum_id: string | null;
  package_id: string | null;
  chunk_size: number | null;
  rows_updated: number;
  duration_ms: number | null;
  triggers_disabled: string[] | null;
  triggers_restored: boolean;
  error_message: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

const SEVERITY_LABEL: Record<string, { label: string; cls: string }> = {
  hard_orphan: { label: "Hard Orphan", cls: "bg-destructive/10 text-destructive border-destructive/30" },
  backfillable: { label: "Backfillable", cls: "bg-warning/10 text-warning border-warning/30" },
  inspect: { label: "Inspect", cls: "bg-muted text-muted-foreground border-border" },
};

export default function ArtifactOrphansCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const summaryQ = useQuery({
    queryKey: ["artifact-orphans-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_artifact_orphans_summary" as any);
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
    },
    refetchInterval: 60_000,
  });

  const detailQ = useQuery({
    queryKey: ["artifact-orphans-detail", tableFilter, severityFilter],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_artifact_orphans_detail" as any, {
        p_table: tableFilter,
        p_severity: severityFilter,
        p_limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as DetailRow[];
    },
  });

  const auditQ = useQuery({
    queryKey: ["backfill-chunk-audit"],
    enabled: showAudit,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_backfill_chunk_audit" as any, { p_limit: 50 });
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const dryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_cleanup_artifact_orphans" as any, {
        p_table: tableFilter,
        p_max: 500,
        p_dry_run: true,
      });
      if (error) throw error;
      return data as { table_name: string; deleted_count: number }[];
    },
    onSuccess: (rows) => {
      const total = rows?.reduce((s, r) => s + (r.deleted_count ?? 0), 0) ?? 0;
      toast({
        title: "Dry-Run abgeschlossen",
        description: `Würde ${total} Hard-Orphan Datensätze löschen (Tabellen: ${rows?.filter(r => r.deleted_count > 0).map(r => `${r.table_name}=${r.deleted_count}`).join(", ") || "keine"}).`,
      });
    },
    onError: (e: Error) => toast({ title: "Dry-Run Fehler", description: e.message, variant: "destructive" }),
  });

  const sweep = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_cleanup_artifact_orphans" as any, {
        p_table: tableFilter,
        p_max: 500,
        p_dry_run: false,
      });
      if (error) throw error;
      return data as { table_name: string; deleted_count: number }[];
    },
    onSuccess: (rows) => {
      const total = rows?.reduce((s, r) => s + (r.deleted_count ?? 0), 0) ?? 0;
      toast({ title: "Sweep ausgeführt", description: `${total} Datensätze gelöscht & protokolliert.` });
      qc.invalidateQueries({ queryKey: ["artifact-orphans-summary"] });
      qc.invalidateQueries({ queryKey: ["artifact-orphans-detail"] });
    },
    onError: (e: Error) => toast({ title: "Sweep Fehler", description: e.message, variant: "destructive" }),
  });

  const total = summaryQ.data?.reduce((s, r) => s + Number(r.orphan_count ?? 0), 0) ?? 0;
  const hardTotal = summaryQ.data?.filter(r => r.severity === "hard_orphan").reduce((s, r) => s + Number(r.orphan_count ?? 0), 0) ?? 0;
  const backfillTotal = summaryQ.data?.filter(r => r.severity === "backfillable").reduce((s, r) => s + Number(r.orphan_count ?? 0), 0) ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full p-3 flex items-center justify-between hover:bg-muted/30 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-warning" />
          <div className="text-left">
            <h2 className="text-sm font-semibold text-foreground">Artifact Orphans</h2>
            <p className="text-[10px] text-muted-foreground">v_artifact_orphans · Konsistenz-Check</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {summaryQ.isLoading ? (
            <Skeleton className="h-5 w-16" />
          ) : (
            <>
              <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
                {hardTotal} hard
              </Badge>
              <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                {backfillTotal} backfill
              </Badge>
              <Badge variant="outline" className="text-[10px]">{total} total</Badge>
            </>
          )}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="border-t border-border p-3 space-y-3">
          {/* Filter */}
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant={severityFilter === null ? "secondary" : "outline"}
              className="h-7 text-[11px]" onClick={() => setSeverityFilter(null)}>
              Alle Severities
            </Button>
            {(["hard_orphan", "backfillable", "inspect"] as const).map(s => (
              <Button key={s} size="sm" variant={severityFilter === s ? "secondary" : "outline"}
                className="h-7 text-[11px]" onClick={() => setSeverityFilter(s)}>
                {SEVERITY_LABEL[s].label}
              </Button>
            ))}
            <div className="w-px bg-border mx-1" />
            <Button size="sm" variant={tableFilter === null ? "secondary" : "outline"}
              className="h-7 text-[11px]" onClick={() => setTableFilter(null)}>
              Alle Tabellen
            </Button>
            {Array.from(new Set(summaryQ.data?.map(r => r.table_name) ?? [])).map(t => (
              <Button key={t} size="sm" variant={tableFilter === t ? "secondary" : "outline"}
                className="h-7 text-[11px]" onClick={() => setTableFilter(t)}>
                {t}
              </Button>
            ))}
          </div>

          {/* Aktionen */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs"
              disabled={dryRun.isPending} onClick={() => dryRun.mutate()}>
              {dryRun.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Wand2 className="h-3 w-3 mr-1.5" />}
              Dry-Run (würde löschen)
            </Button>
            <Button size="sm" variant="outline"
              className="h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
              disabled={sweep.isPending || hardTotal === 0}
              onClick={() => {
                if (confirm(`Sweep ausführen? Es werden bis zu 500 hard_orphan Datensätze gelöscht (${tableFilter ?? "alle Tabellen"}).`)) {
                  sweep.mutate();
                }
              }}>
              {sweep.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Trash2 className="h-3 w-3 mr-1.5" />}
              Sweep ausführen
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs ml-auto"
              onClick={() => setShowAudit(s => !s)}>
              <ClipboardList className="h-3 w-3 mr-1.5" />
              Backfill-Audit {showAudit ? "ausblenden" : "anzeigen"}
            </Button>
          </div>

          {/* Summary */}
          {summaryQ.data && summaryQ.data.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2">Tabelle</th>
                    <th className="text-left p-2">Reason</th>
                    <th className="text-left p-2">Severity</th>
                    <th className="text-right p-2">Anzahl</th>
                    <th className="text-right p-2">Curricula</th>
                    <th className="text-right p-2">Pakete</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryQ.data.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2 font-mono">{r.table_name}</td>
                      <td className="p-2">{r.reason}</td>
                      <td className="p-2">
                        <Badge variant="outline" className={cn("text-[10px]", SEVERITY_LABEL[r.severity]?.cls)}>
                          {SEVERITY_LABEL[r.severity]?.label ?? r.severity}
                        </Badge>
                      </td>
                      <td className="p-2 text-right font-semibold">{r.orphan_count}</td>
                      <td className="p-2 text-right">{r.distinct_curricula}</td>
                      <td className="p-2 text-right">{r.distinct_packages}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {summaryQ.data?.length === 0 && (
            <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-xs text-success flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Keine Orphans erkannt — System konsistent.
            </div>
          )}

          {/* Detail */}
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer p-2 text-xs font-medium hover:bg-muted/30">
              Detail ({detailQ.data?.length ?? 0} Zeilen)
            </summary>
            <div className="p-2 max-h-96 overflow-auto">
              {detailQ.isLoading && <Skeleton className="h-24 w-full" />}
              {detailQ.data && detailQ.data.length > 0 && (
                <table className="w-full text-[10px]">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-1">Tabelle</th>
                      <th className="text-left p-1">Artifact</th>
                      <th className="text-left p-1">Curriculum</th>
                      <th className="text-left p-1">Package</th>
                      <th className="text-left p-1">Reason</th>
                      <th className="text-left p-1">Sev</th>
                      <th className="text-left p-1">Curr?</th>
                      <th className="text-left p-1">Pkg?</th>
                      <th className="text-left p-1">Status</th>
                      <th className="text-left p-1">Backfill?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailQ.data.map(r => (
                      <tr key={r.artifact_id} className="border-t border-border">
                        <td className="p-1 font-mono">{r.table_name}</td>
                        <td className="p-1 font-mono">{r.artifact_id.slice(0, 8)}</td>
                        <td className="p-1 font-mono">{r.curriculum_id?.slice(0, 8) ?? "—"}</td>
                        <td className="p-1 font-mono">{r.package_id?.slice(0, 8) ?? "—"}</td>
                        <td className="p-1">{r.reason}</td>
                        <td className="p-1">{r.severity}</td>
                        <td className="p-1">{r.curriculum_exists ? "✓" : "✗"}</td>
                        <td className="p-1">{r.package_exists ? "✓" : "✗"}</td>
                        <td className="p-1">{r.package_status ?? "—"}</td>
                        <td className="p-1">{r.backfill_possible ? "✓" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </details>

          {/* Backfill-Audit */}
          {showAudit && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="bg-muted/50 p-2 text-xs font-medium">Backfill Chunk Audit (letzte 50)</div>
              <div className="max-h-72 overflow-auto">
                {auditQ.isLoading && <Skeleton className="h-24 w-full m-2" />}
                {auditQ.data && (
                  <table className="w-full text-[10px]">
                    <thead className="bg-muted/30 sticky top-0">
                      <tr>
                        <th className="text-left p-1">Zeit</th>
                        <th className="text-left p-1">Tabelle</th>
                        <th className="text-right p-1">Rows</th>
                        <th className="text-right p-1">ms</th>
                        <th className="text-left p-1">Triggers off</th>
                        <th className="text-left p-1">Restored</th>
                        <th className="text-left p-1">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditQ.data.map(a => (
                        <tr key={a.id} className="border-t border-border">
                          <td className="p-1">{new Date(a.created_at).toLocaleString("de-DE")}</td>
                          <td className="p-1 font-mono">{a.table_name}</td>
                          <td className="p-1 text-right font-semibold">{a.rows_updated}</td>
                          <td className="p-1 text-right">{a.duration_ms ?? "—"}</td>
                          <td className="p-1">{a.triggers_disabled?.length ?? 0}</td>
                          <td className="p-1">{a.triggers_restored ? "✓" : "✗"}</td>
                          <td className="p-1 text-destructive">{a.error_message?.slice(0, 60) ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
