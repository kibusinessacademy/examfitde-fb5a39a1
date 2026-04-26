/**
 * Healing Wizard Tab — geführte Job-Heilung mit Live-Timeline,
 * Artifact-Consistency, 503-Diagnose und Force-Run Audit-Log.
 *
 * Architektur:
 *  - Pre-Flight: admin_artifact_consistency_check
 *  - Step Reset: admin_safe_step_reset (atomic, mit Pflicht-Begründung)
 *  - Timeline: admin_get_job_state_timeline
 *  - 503 Diagnose: admin_diagnose_503_summary
 *  - Audit: admin_log_force_run + Live-View aus force_run_audit_log
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Stethoscope,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  RefreshCw,
  ShieldCheck,
  History,
  PackageCheck,
  ServerCrash,
} from "lucide-react";
import { toast } from "sonner";

// ───────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────
type ArtifactRow = {
  artifact_key: string;
  expected_min: number;
  actual_count: number;
  status: "ok" | "missing" | "partial";
  related_step: string;
  hint: string;
};

type TimelineRow = {
  occurred_at: string;
  event_type: "guardrail" | "job_event" | "step_finalize";
  source: string;
  step_key: string | null;
  job_id: string | null;
  job_type: string | null;
  status_from: string | null;
  status_to: string | null;
  details: Record<string, unknown>;
};

type Diag503Row = {
  job_type: string;
  edge_function: string;
  http_503_count: number;
  affected_packages: number;
  sample_error: string | null;
  oldest_at: string;
  newest_at: string;
  copy_paste_summary: string;
};

type ForceRunAudit = {
  id: string;
  created_at: string;
  action: string;
  job_id: string | null;
  package_id: string | null;
  edge_function: string | null;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
};

const STATUS_TONE: Record<ArtifactRow["status"], string> = {
  ok: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  missing: "bg-destructive/10 text-destructive border-destructive/30",
  partial: "bg-amber-500/10 text-amber-600 border-amber-500/30",
};

// ───────────────────────────────────────────────────────────
// Sub-Components
// ───────────────────────────────────────────────────────────
function ArtifactConsistencyPanel({ packageId }: { packageId: string }) {
  const q = useQuery({
    queryKey: ["artifact-consistency", packageId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_artifact_consistency_check" as any, {
        p_package_id: packageId,
      });
      if (error) throw error;
      return (data ?? []) as ArtifactRow[];
    },
    enabled: !!packageId,
  });

  if (!packageId) return null;
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.error)
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{(q.error as Error).message}</AlertDescription>
      </Alert>
    );

  const data = q.data ?? [];
  const issues = data.filter((d) => d.status !== "ok");

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <PackageCheck className="h-4 w-4" />
            Artefakt-Konsistenz · Pre-Flight Check
          </CardTitle>
          <Badge variant={issues.length === 0 ? "secondary" : "destructive"} className="text-[10px]">
            {issues.length === 0 ? "alles ok" : `${issues.length} Lücke(n)`}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Prüft Artefakte (lessons / minicheck_questions / exam_questions / blueprints / competencies) gegen Soll-Werte
          bevor du Steps zurücksetzt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {data.map((r) => (
          <div
            key={r.artifact_key}
            className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-md border bg-card text-xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className={`px-1.5 py-0.5 rounded border font-medium ${STATUS_TONE[r.status]}`}>
                {r.status}
              </span>
              <code className="font-mono">{r.artifact_key}</code>
              <span className="text-muted-foreground">
                {r.actual_count} / {r.expected_min}
              </span>
            </div>
            <div className="flex items-center gap-2 min-w-0 text-right">
              <span className="text-muted-foreground truncate">{r.hint}</span>
              <Badge variant="outline" className="text-[9px] font-mono">
                {r.related_step}
              </Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TimelinePanel({ packageId }: { packageId: string }) {
  const q = useQuery({
    queryKey: ["job-state-timeline", packageId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_job_state_timeline" as any, {
        p_package_id: packageId,
      });
      if (error) throw error;
      return (data ?? []) as TimelineRow[];
    },
    enabled: !!packageId,
    refetchInterval: 8000,
  });

  if (!packageId) return null;
  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.error)
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{(q.error as Error).message}</AlertDescription>
      </Alert>
    );

  const rows = q.data ?? [];
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" />
            Live-State Timeline
            <Badge variant="outline" className="text-[10px] font-mono">
              {rows.length}
            </Badge>
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => q.refetch()}
            className="h-7 text-[11px]"
          >
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        </div>
        <CardDescription className="text-xs">
          Letzte 200 Ereignisse: Guard-Entscheidungen, Job-Lifecycle, Step-Finalisierungen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-72 pr-2">
          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <div key={i} className="text-[11px] flex items-start gap-2 p-2 rounded border bg-muted/30">
                <span className="text-muted-foreground font-mono shrink-0 w-32">
                  {new Date(r.occurred_at).toLocaleString("de-DE")}
                </span>
                <Badge
                  variant={
                    r.event_type === "guardrail"
                      ? "destructive"
                      : r.event_type === "step_finalize"
                        ? "default"
                        : "secondary"
                  }
                  className="text-[9px] shrink-0"
                >
                  {r.event_type}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.step_key && (
                      <code className="font-mono text-[10px] px-1 py-0.5 rounded bg-primary/10">
                        {r.step_key}
                      </code>
                    )}
                    {r.job_type && (
                      <code className="font-mono text-[10px] px-1 py-0.5 rounded bg-muted">
                        {r.job_type}
                      </code>
                    )}
                    {(r.status_from || r.status_to) && (
                      <span className="text-muted-foreground">
                        {r.status_from ?? "—"} → <strong>{r.status_to ?? "—"}</strong>
                      </span>
                    )}
                    {(r.details as any)?.guard_key && (
                      <Badge variant="outline" className="text-[9px]">
                        guard: {(r.details as any).guard_key}
                      </Badge>
                    )}
                  </div>
                  {(r.details as any)?.last_error && (
                    <div className="text-destructive mt-0.5 truncate">
                      {(r.details as any).last_error}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-8">
                Keine Ereignisse für dieses Paket gefunden.
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function HealingWizard({ packageId }: { packageId: string }) {
  const qc = useQueryClient();
  const [stepKey, setStepKey] = useState("");
  const [jobType, setJobType] = useState("");
  const [reason, setReason] = useState("");
  const [createJob, setCreateJob] = useState(true);

  const reset = useMutation({
    mutationFn: async () => {
      const t0 = performance.now();
      const { data, error } = await supabase.rpc("admin_safe_step_reset" as any, {
        p_package_id: packageId,
        p_step_key: stepKey,
        p_reason: reason,
        p_cascade_dependent: false,
        p_create_fresh_job: createJob,
        p_job_type: jobType || null,
      });
      const dur = Math.round(performance.now() - t0);
      // mirror to audit log even if rpc internally logs (defense in depth)
      await supabase.rpc("admin_log_force_run" as any, {
        p_action: "wizard_safe_step_reset",
        p_job_id: (data as any)?.new_job_id ?? null,
        p_package_id: packageId,
        p_edge_function: jobType || null,
        p_http_status: error ? 500 : 200,
        p_error_code: error ? "rpc_error" : null,
        p_error_message: error ? error.message : null,
        p_request_payload: { step_key: stepKey, reason, create_job: createJob },
        p_response_payload: data ?? null,
        p_duration_ms: dur,
      });
      if (error) throw error;
      return data as { ok: boolean; step_updated: number; new_job_id?: string };
    },
    onSuccess: (d) => {
      toast.success(
        `Reset OK · steps:${d.step_updated}${d.new_job_id ? ` · job:${d.new_job_id.slice(0, 8)}…` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["job-state-timeline", packageId] });
      qc.invalidateQueries({ queryKey: ["artifact-consistency", packageId] });
      qc.invalidateQueries({ queryKey: ["force-run-audit"] });
      setReason("");
    },
    onError: (e: any) => toast.error(`Reset fehlgeschlagen: ${e.message}`),
  });

  const canRun = packageId && stepKey.length > 0 && reason.length >= 5;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Job-Healing Wizard · Safe Reset
        </CardTitle>
        <CardDescription className="text-xs">
          Setzt einen Step korrekt mit <code className="text-[10px]">allow_regression=true</code> +{" "}
          <code className="text-[10px]">allow_regression_by=admin_manual</code> zurück und legt optional einen frischen
          Recovery-Job an. Audit erfolgt automatisch.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Step-Key</label>
            <Input
              value={stepKey}
              onChange={(e) => setStepKey(e.target.value)}
              placeholder="z. B. generate_lesson_minichecks"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Job-Type (optional)</label>
            <Input
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              placeholder="z. B. package_generate_lesson_minichecks"
              className="font-mono text-xs"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">Begründung (mind. 5 Zeichen)</label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="z. B. HOLLOW_ARTIFACTS: 0 minicheck_questions bei 300 lessons"
            className="text-xs min-h-[60px]"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={createJob}
              onChange={(e) => setCreateJob(e.target.checked)}
            />
            Frischen Recovery-Job anlegen
          </label>
          <Button
            size="sm"
            disabled={!canRun || reset.isPending}
            onClick={() => reset.mutate()}
            className="gap-1.5"
          >
            {reset.isPending ? <Activity className="h-3.5 w-3.5 animate-pulse" /> : <Stethoscope className="h-3.5 w-3.5" />}
            Safe-Reset ausführen
          </Button>
        </div>
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle className="text-xs">Wizard-Reihenfolge</AlertTitle>
          <AlertDescription className="text-[11px]">
            1. Artefakt-Check oben prüfen → 2. Step + Reason eintragen → 3. Safe-Reset →
            4. Timeline beobachten (Guard-Event <code>regression_permitted</code>) → 5. Audit-Eintrag verifizieren.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

function Diagnose503Panel() {
  const q = useQuery({
    queryKey: ["diag-503"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_diagnose_503_summary" as any, {
        p_hours: 24,
      });
      if (error) throw error;
      return (data ?? []) as Diag503Row[];
    },
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ServerCrash className="h-4 w-4" />
            HTTP-503 Diagnosetafel · 24h
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={() => q.refetch()} className="h-7 text-[11px]">
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        </div>
        <CardDescription className="text-xs">
          Aggregierte HTTP-503 nach Edge/Job-Type. Klick auf <Copy className="inline h-3 w-3" /> kopiert
          eine fertige Fehlerbeschreibung.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (q.data?.length ?? 0) === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            Keine 503-Treffer in den letzten 24h. ✅
          </div>
        ) : (
          <div className="space-y-1.5">
            {q.data!.map((r) => (
              <div key={r.job_type} className="text-[11px] flex items-center gap-2 p-2 rounded border bg-muted/30">
                <Badge variant="destructive" className="text-[9px] font-mono">
                  503 × {r.http_503_count}
                </Badge>
                <code className="font-mono">{r.edge_function}</code>
                <span className="text-muted-foreground">{r.affected_packages} Pakete</span>
                <span className="ml-auto text-muted-foreground truncate max-w-md">
                  {r.sample_error || "(kein Fehlertext)"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => {
                    navigator.clipboard.writeText(r.copy_paste_summary);
                    toast.success("Fehlerbeschreibung kopiert");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ForceRunAuditPanel({ packageFilter }: { packageFilter: string }) {
  const [actionFilter, setActionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const q = useQuery({
    queryKey: ["force-run-audit", packageFilter, actionFilter, statusFilter],
    queryFn: async () => {
      let qb = supabase
        .from("force_run_audit_log" as any)
        .select("id,created_at,action,job_id,package_id,edge_function,http_status,error_code,error_message,duration_ms")
        .order("created_at", { ascending: false })
        .limit(100);
      if (packageFilter) qb = qb.eq("package_id", packageFilter);
      if (actionFilter) qb = qb.ilike("action", `%${actionFilter}%`);
      if (statusFilter) qb = qb.eq("http_status", parseInt(statusFilter, 10));
      const { data, error } = await qb;
      if (error) throw error;
      return (data ?? []) as unknown as ForceRunAudit[];
    },
    refetchInterval: 15_000,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Force-Run Audit-Log
          </CardTitle>
          <div className="flex items-center gap-1">
            <Input
              placeholder="action filter"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="h-7 text-xs w-32"
            />
            <Input
              placeholder="HTTP"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value.replace(/[^\d]/g, ""))}
              className="h-7 text-xs w-16"
            />
            <Button size="sm" variant="ghost" onClick={() => q.refetch()} className="h-7 text-[11px]">
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs">
          Jeder Force-Run / Heal-Aufruf wird hier mit Job-ID, Edge-Funktion, HTTP-Status und Fehler protokolliert.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <ScrollArea className="h-64">
            <div className="space-y-1">
              {(q.data ?? []).map((r) => (
                <div key={r.id} className="text-[11px] flex items-center gap-2 p-1.5 rounded border bg-card">
                  <span className="text-muted-foreground font-mono shrink-0 w-28">
                    {new Date(r.created_at).toLocaleTimeString("de-DE")}
                  </span>
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    {r.action}
                  </Badge>
                  {r.edge_function && (
                    <code className="font-mono text-[10px] truncate max-w-[160px]">{r.edge_function}</code>
                  )}
                  {r.http_status != null && (
                    <Badge
                      variant={r.http_status >= 400 ? "destructive" : "secondary"}
                      className="text-[9px] font-mono"
                    >
                      {r.http_status}
                    </Badge>
                  )}
                  {r.duration_ms != null && (
                    <span className="text-muted-foreground">{r.duration_ms}ms</span>
                  )}
                  {r.error_message && (
                    <span className="text-destructive truncate ml-auto max-w-[280px]">{r.error_message}</span>
                  )}
                </div>
              ))}
              {(q.data ?? []).length === 0 && (
                <div className="text-xs text-muted-foreground py-6 text-center">
                  Keine Audit-Einträge für aktuelle Filter.
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────
export function HealingWizardTabContent() {
  const [packageId, setPackageId] = useState("");

  // Optional: list of recent packages with broken steps, as quick-pick
  const recent = useQuery({
    queryKey: ["healing-recent-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_packages")
        .select("id,title,status,blocked_reason")
        .or("status.eq.building,blocked_reason.not.is.null")
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            Paket auswählen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            value={packageId}
            onChange={(e) => setPackageId(e.target.value.trim())}
            placeholder="package_id (UUID)"
            className="font-mono text-xs"
          />
          {(recent.data ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {recent.data!.map((p: any) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={packageId === p.id ? "default" : "outline"}
                  className="h-6 text-[10px] gap-1"
                  onClick={() => setPackageId(p.id)}
                >
                  {p.title}
                  {p.blocked_reason && (
                    <Badge variant="destructive" className="text-[8px] ml-1">
                      blocked
                    </Badge>
                  )}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {packageId && (
        <>
          <ArtifactConsistencyPanel packageId={packageId} />
          <HealingWizard packageId={packageId} />
          <TimelinePanel packageId={packageId} />
          <Separator />
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Diagnose503Panel />
        <ForceRunAuditPanel packageFilter={packageId} />
      </div>
    </div>
  );
}

export default HealingWizardTabContent;
