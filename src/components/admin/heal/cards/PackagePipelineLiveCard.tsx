/**
 * PackagePipelineLiveCard — Live-Ansicht Pipeline pro Paket
 * Zeigt Job-States, Blocker, DAG-Predecessors aus v_package_pipeline_live (via RPC).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PipelineRow {
  package_id: string;
  title: string;
  pkg_status: string;
  gate_class: string | null;
  in_quarantine: boolean;
  approved_questions: number;
  steps: Array<{ step_key: string; status: string; attempts: number; last_error: string | null; updated_at: string }> | null;
  active_jobs: Array<{ job_type: string; status: string; attempts: number; last_error: string | null }> | null;
  failed_jobs_total: number;
  last_job_activity: string | null;
}

const statusTone = (s: string): string => {
  if (s === "done" || s === "completed" || s === "skipped") return "bg-status-success-bg-subtle text-success border-success/20";
  if (s === "failed" || s === "blocked") return "bg-status-error-bg-subtle text-danger border-danger/20";
  if (s === "processing" || s === "running") return "bg-status-info-bg-subtle text-info border-info/20";
  return "bg-surface-sunken text-muted-foreground border-border";
};

export function PackagePipelineLiveCard() {
  const [filter, setFilter] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["pipeline-live", filter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_package_pipeline_live" as any, {
        p_package_id: null,
        p_limit: 50,
      });
      if (error) throw error;
      return data as PipelineRow[];
    },
    refetchInterval: 15000,
  });

  const rows = (data ?? []).filter(r =>
    !filter || r.title?.toLowerCase().includes(filter.toLowerCase()) || r.package_id.includes(filter)
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Pipeline Live (Top 50)
            <Badge variant="outline" className="ml-2">Refresh 15s</Badge>
          </CardTitle>
          <Input
            placeholder="Titel oder Package-ID …"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-xs h-8"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
        {isLoading && <Skeleton className="h-32 w-full" />}
        {!isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Keine Pakete in Pipeline.</p>
        )}
        {rows.map((r) => (
          <div key={r.package_id} className="border rounded-md p-3 bg-card hover:bg-muted/30 transition-colors">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{r.title}</div>
                <div className="text-xs text-muted-foreground font-mono">{r.package_id.slice(0, 8)}</div>
              </div>
              <div className="flex items-center gap-1 flex-wrap justify-end">
                {r.in_quarantine && (
                  <Badge className="bg-status-error-bg-subtle text-danger border-danger/20 gap-1">
                    <ShieldAlert className="h-3 w-3" />Quarantäne
                  </Badge>
                )}
                <Badge variant="outline">{r.pkg_status}</Badge>
                {r.gate_class && <Badge variant="outline">gate: {r.gate_class}</Badge>}
                <Badge variant="outline">{r.approved_questions} Q</Badge>
                {r.failed_jobs_total > 0 && (
                  <Badge className="bg-status-warning-bg-subtle text-warning border-warning/20 gap-1">
                    <AlertTriangle className="h-3 w-3" />{r.failed_jobs_total} failed
                  </Badge>
                )}
              </div>
            </div>
            {r.steps && r.steps.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {r.steps.slice(0, 12).map((s, i) => (
                  <span
                    key={`${s.step_key}-${i}`}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${statusTone(s.status)}`}
                    title={`${s.step_key}: ${s.status} (attempts ${s.attempts})${s.last_error ? '\n'+s.last_error : ''}`}
                  >
                    {s.step_key}
                  </span>
                ))}
              </div>
            )}
            {r.active_jobs && r.active_jobs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {r.active_jobs.slice(0, 8).map((j, i) => (
                  <span
                    key={i}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${statusTone(j.status)}`}
                    title={j.last_error ?? ''}
                  >
                    {j.job_type}:{j.status}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
