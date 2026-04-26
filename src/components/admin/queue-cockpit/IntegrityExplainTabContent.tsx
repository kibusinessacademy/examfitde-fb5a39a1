/**
 * IntegrityExplainTabContent
 * ──────────────────────────
 * "Explain Mode" für Integrity-Gate-Failures + Audit-Marker-Review.
 *
 *  Linker Bereich: Liste blocked/building Pakete mit Integrity-Status
 *  Rechter Bereich (Detail): Drilldown
 *    - Welche Guards triggern? (deprecated_blueprints, lf_coverage, comp_coverage, pool_size)
 *    - Welche Artefakte fehlen? (exam_questions count, lf_coverage_pct, comp_coverage_pct)
 *    - Audit-Marker (approved_by, change_reason aller relevanten BP-Reaktivierungen)
 *    - Nächste empfohlene Repair-Schritte als Buttons:
 *        · Re-Trigger generate_exam_pool
 *        · Re-Trigger repair_exam_pool_lf_coverage
 *        · Re-Trigger repair_exam_pool_competency_coverage
 *        · Re-Trigger run_integrity_check
 *        · Rollback: WAVE-Revival rückgängig machen
 *
 * Daten via direkten Supabase-Queries (Echtdaten, keine Mocks).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Wrench,
  RefreshCcw,
  Search,
  History,
  PlayCircle,
} from "lucide-react";
import { toast } from "sonner";

type Pkg = {
  id: string;
  title: string;
  status: string;
  curriculum_id: string;
  track: string | null;
  integrity_passed: boolean | null;
  integrity_report: Record<string, unknown> | null;
};

type Diagnosis = {
  pool_q: number;
  total_lfs: number;
  pool_lfs_used: number;
  total_comps: number;
  pool_comps_used: number;
  bp_approved: number;
  bp_deprecated_wave: number;
  bp_deprecated_total: number;
  guards: Array<{
    code: string;
    severity: "high" | "warn" | "info";
    title: string;
    detail: string;
    repair_action: string | null;
  }>;
};

type AuditMarker = {
  id: string | number;
  action: string;
  scope: string | null;
  payload: Record<string, unknown>;
  created_at: string | null;
};

async function fetchIntegrityPackages(): Promise<Pkg[]> {
  const { data, error } = await supabase
    .from("course_packages")
    .select("id, title, status, curriculum_id, track, integrity_passed, integrity_report")
    .in("status", ["building", "blocked", "quality_gate_failed"])
    .eq("archived", false)
    .order("title");
  if (error) throw error;
  return (data ?? []) as Pkg[];
}

async function diagnosePackage(pkg: Pkg): Promise<Diagnosis> {
  // Pool-Größe + LFs/Comps benutzt
  const { data: poolRows } = await supabase
    .from("exam_questions")
    .select("learning_field_id, competency_id")
    .eq("curriculum_id", pkg.curriculum_id)
    .eq("status", "approved");

  const pool_q = poolRows?.length ?? 0;
  const pool_lfs_used = new Set(poolRows?.map((r) => r.learning_field_id).filter(Boolean)).size;
  const pool_comps_used = new Set(poolRows?.map((r) => r.competency_id).filter(Boolean)).size;

  // LFs total
  const { count: lfTotal } = await supabase
    .from("learning_fields")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", pkg.curriculum_id);
  const total_lfs = lfTotal ?? 0;

  // Comps total via LFs
  const { data: lfIds } = await supabase
    .from("learning_fields")
    .select("id")
    .eq("curriculum_id", pkg.curriculum_id);
  const ids = (lfIds ?? []).map((r) => r.id);
  const { count: compTotal } = ids.length
    ? await supabase
        .from("competencies")
        .select("id", { count: "exact", head: true })
        .in("learning_field_id", ids)
    : { count: 0 };
  const total_comps = compTotal ?? 0;

  // BPs
  const { data: bps } = await supabase
    .from("question_blueprints")
    .select("status, change_reason")
    .eq("curriculum_id", pkg.curriculum_id);

  const bp_approved = bps?.filter((b) => b.status === "approved").length ?? 0;
  const bp_deprecated_total = bps?.filter((b) => b.status === "deprecated").length ?? 0;
  const bp_deprecated_wave =
    bps?.filter(
      (b) =>
        b.status === "deprecated" &&
        typeof b.change_reason === "string" &&
        b.change_reason.startsWith("WAVE15A_POLLUTION_DEPRECATED"),
    ).length ?? 0;

  // Guards ableiten
  const guards: Diagnosis["guards"] = [];
  const isPlus = pkg.track === "EXAM_FIRST_PLUS";
  const poolTarget = isPlus ? 500 : 200;
  const lfTarget = total_lfs;
  const compTargetPct = isPlus ? 0.95 : 0.7;

  if (pool_q < poolTarget) {
    guards.push({
      code: "POOL_SIZE_BELOW_TARGET",
      severity: pool_q < poolTarget * 0.5 ? "high" : "warn",
      title: `Pool zu klein: ${pool_q}/${poolTarget}`,
      detail: `Track ${pkg.track}: Mindestpool ${poolTarget} Fragen erforderlich`,
      repair_action: "package_generate_exam_pool",
    });
  }
  if (pool_lfs_used < lfTarget) {
    guards.push({
      code: "LF_COVERAGE_GAP",
      severity: "high",
      title: `LF-Coverage-Lücke: ${pool_lfs_used}/${lfTarget} Lernfelder`,
      detail: `${lfTarget - pool_lfs_used} Lernfeld(er) ohne Fragen`,
      repair_action: "package_repair_exam_pool_lf_coverage",
    });
  }
  if (total_comps > 0 && pool_comps_used / total_comps < compTargetPct) {
    guards.push({
      code: "COMP_COVERAGE_GAP",
      severity: "warn",
      title: `Comp-Coverage-Lücke: ${pool_comps_used}/${total_comps} (${Math.round((pool_comps_used / total_comps) * 100)}%)`,
      detail: `Track ${pkg.track}: Mindestabdeckung ${Math.round(compTargetPct * 100)}% erforderlich`,
      repair_action: "package_repair_exam_pool_competency_coverage",
    });
  }
  if (bp_deprecated_wave > 0) {
    guards.push({
      code: "WAVE15A_DEPRECATED_BPS",
      severity: "high",
      title: `${bp_deprecated_wave} Blueprints durch WAVE15A deprecated`,
      detail: "Sicher reaktivierbar — Pool-Generation kann diese BPs nicht nutzen",
      repair_action: "wave_revoke",
    });
  }

  return {
    pool_q,
    total_lfs,
    pool_lfs_used,
    total_comps,
    pool_comps_used,
    bp_approved,
    bp_deprecated_wave,
    bp_deprecated_total,
    guards,
  };
}

async function fetchAuditMarkers(packageId: string): Promise<AuditMarker[]> {
  const { data, error } = await supabase
    .from("admin_actions")
    .select("id, action, scope, payload, created_at")
    .or(`scope.like.pipeline.%,action.like.forensic_heal_%`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  // client-side filter auf payload.packages oder payload.package_id
  return ((data ?? []) as AuditMarker[]).filter((a) => {
    const p = a.payload as Record<string, unknown>;
    if (p?.package_id === packageId) return true;
    const pkgs = p?.packages as Array<{ pkg_id?: string; id?: string }> | undefined;
    if (Array.isArray(pkgs)) {
      return pkgs.some((x) => x.pkg_id === packageId || x.id === packageId);
    }
    return a.action.startsWith("forensic_heal_global"); // global gilt für alle
  });
}

async function enqueueRepair(params: {
  package_id: string;
  curriculum_id: string;
  job_type: string;
}): Promise<void> {
  const { error } = await supabase.from("job_queue").insert({
    job_type: params.job_type,
    status: "pending",
    package_id: params.package_id,
    worker_pool: "default",
    priority: 5,
    payload: {
      package_id: params.package_id,
      curriculum_id: params.curriculum_id,
      step_key: params.job_type.replace("package_", ""),
    },
    meta: {
      origin: "explain_mode_manual_retrigger",
      enqueued_at: new Date().toISOString(),
    },
  });
  if (error) throw error;

  await supabase.from("admin_actions").insert({
    action: "explain_mode_manual_retrigger",
    scope: "pipeline.explain_mode.repair",
    payload: params as never,
  });
}

async function rollbackWaveRevival(curriculumId: string): Promise<void> {
  // Nur für reaktivierte BPs des Curriculums den Approval-Marker zurücknehmen.
  // Achtung: setzt status zurück auf deprecated mit ROLLBACK_-Marker.
  const { error } = await supabase
    .from("question_blueprints")
    .update({
      status: "deprecated",
      deprecated_at: new Date().toISOString(),
      change_reason: "ROLLBACK_2026-04-26: WAVE15A revival manuell zurückgenommen",
    })
    .eq("curriculum_id", curriculumId)
    .like("change_reason", "%REVIVED_2026-04-26%");
  if (error) throw error;

  await supabase.from("admin_actions").insert({
    action: "explain_mode_rollback_wave_revival",
    scope: "pipeline.explain_mode.rollback",
    payload: { curriculum_id: curriculumId } as never,
  });
}

function GuardBadge({ severity }: { severity: "high" | "warn" | "info" }) {
  if (severity === "high")
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" /> Blocker
      </Badge>
    );
  if (severity === "warn")
    return (
      <Badge variant="secondary" className="gap-1">
        <AlertTriangle className="h-3 w-3" /> Warning
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1">
      <CheckCircle2 className="h-3 w-3" /> Info
    </Badge>
  );
}

function PackageDetail({ pkg }: { pkg: Pkg }) {
  const qc = useQueryClient();
  const diag = useQuery({
    queryKey: ["explain-diag", pkg.id],
    queryFn: () => diagnosePackage(pkg),
  });
  const audit = useQuery({
    queryKey: ["explain-audit", pkg.id],
    queryFn: () => fetchAuditMarkers(pkg.id),
  });

  const reTrigger = useMutation({
    mutationFn: (job_type: string) =>
      enqueueRepair({
        package_id: pkg.id,
        curriculum_id: pkg.curriculum_id,
        job_type,
      }),
    onSuccess: (_, job_type) => {
      toast.success(`${job_type} eingereiht`, { description: `Paket: ${pkg.title}` });
      qc.invalidateQueries({ queryKey: ["explain-diag", pkg.id] });
      qc.invalidateQueries({ queryKey: ["explain-audit", pkg.id] });
    },
    onError: (e) => toast.error("Re-Trigger fehlgeschlagen", { description: String(e) }),
  });

  const rollback = useMutation({
    mutationFn: () => rollbackWaveRevival(pkg.curriculum_id),
    onSuccess: () => {
      toast.warning("WAVE-Revival zurückgenommen", { description: pkg.title });
      qc.invalidateQueries({ queryKey: ["explain-diag", pkg.id] });
      qc.invalidateQueries({ queryKey: ["explain-audit", pkg.id] });
    },
    onError: (e) => toast.error("Rollback fehlgeschlagen", { description: String(e) }),
  });

  if (diag.isLoading) return <Skeleton className="h-96" />;
  if (!diag.data) return <p className="text-sm text-muted-foreground">Keine Daten.</p>;

  const d = diag.data;
  const allClean = d.guards.length === 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">{pkg.title}</CardTitle>
              <CardDescription className="text-xs">
                {pkg.track} · {pkg.status} · {pkg.id.slice(0, 8)}
              </CardDescription>
            </div>
            {allClean ? (
              <Badge variant="default" className="gap-1 bg-emerald-600">
                <ShieldCheck className="h-3 w-3" /> Gate-clean
              </Badge>
            ) : (
              <Badge variant="destructive">{d.guards.length} Guard(s)</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Pool" value={d.pool_q} />
            <Stat label="LF-Cov" value={`${d.pool_lfs_used}/${d.total_lfs}`} />
            <Stat label="Comp-Cov" value={`${d.pool_comps_used}/${d.total_comps}`} />
            <Stat
              label="BPs (appr/depr)"
              value={`${d.bp_approved} / ${d.bp_deprecated_total}`}
            />
          </div>
        </CardContent>
      </Card>

      {d.guards.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Search className="h-4 w-4" /> Aktive Guards (Explain Mode)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {d.guards.map((g) => (
              <div key={g.code} className="border rounded-md p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <GuardBadge severity={g.severity} />
                      <code className="text-xs">{g.code}</code>
                    </div>
                    <p className="text-sm font-medium">{g.title}</p>
                    <p className="text-xs text-muted-foreground">{g.detail}</p>
                  </div>
                  {g.repair_action === "wave_revoke" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => rollback.mutate()}
                      disabled={rollback.isPending}
                    >
                      <History className="h-3.5 w-3.5 mr-1" /> Revival rollback
                    </Button>
                  ) : g.repair_action ? (
                    <Button
                      size="sm"
                      onClick={() => reTrigger.mutate(g.repair_action!)}
                      disabled={reTrigger.isPending}
                    >
                      <Wrench className="h-3.5 w-3.5 mr-1" /> Re-Trigger
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <PlayCircle className="h-4 w-4" /> Manuelle Repair-Schritte
            </CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ["explain-diag", pkg.id] });
                qc.invalidateQueries({ queryKey: ["explain-audit", pkg.id] });
              }}
            >
              <RefreshCcw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[
            "package_generate_exam_pool",
            "package_repair_exam_pool_lf_coverage",
            "package_repair_exam_pool_competency_coverage",
            "package_repair_exam_pool_quality",
            "package_validate_exam_pool",
            "package_run_integrity_check",
          ].map((jt) => (
            <Button
              key={jt}
              size="sm"
              variant="outline"
              onClick={() => reTrigger.mutate(jt)}
              disabled={reTrigger.isPending}
            >
              {jt.replace("package_", "")}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Audit-Marker
          </CardTitle>
          <CardDescription className="text-xs">
            Letzte 50 admin_actions, gefiltert auf dieses Paket / globale Heal-Aktionen
          </CardDescription>
        </CardHeader>
        <CardContent>
          {audit.isLoading ? (
            <Skeleton className="h-24" />
          ) : (audit.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Keine Audit-Einträge gefunden.</p>
          ) : (
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {audit.data!.map((a) => (
                  <div key={a.id} className="border rounded-md p-2 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <code className="font-medium">{a.action}</code>
                      <span className="text-muted-foreground">
                        {new Date(a.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-muted-foreground">{a.scope}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function IntegrityExplainTabContent() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["explain-pkgs"],
    queryFn: fetchIntegrityPackages,
    refetchInterval: 30_000,
  });

  const selected = list.data?.find((p) => p.id === selectedId) ?? list.data?.[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="h-4 w-4" /> Pakete im Gate
          </CardTitle>
          <CardDescription className="text-xs">
            building / blocked / quality_gate_failed
          </CardDescription>
        </CardHeader>
        <CardContent className="px-2">
          {list.isLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-1">
                {(list.data ?? []).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted/60 transition ${
                      (selected?.id === p.id) ? "bg-primary/10 text-primary" : ""
                    }`}
                  >
                    <div className="font-medium truncate">{p.title}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      <Badge variant="outline" className="px-1 h-4 text-[9px]">
                        {p.status}
                      </Badge>
                      {p.track && <span>{p.track}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <div>
        {selected ? (
          <PackageDetail pkg={selected} />
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Wähle links ein Paket, um Guards, Audit-Marker und Repair-Steps zu sehen.
            </CardContent>
          </Card>
        )}
      </div>
      <Separator className="lg:hidden" />
    </div>
  );
}
