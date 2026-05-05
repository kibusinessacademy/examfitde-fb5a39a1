/**
 * HealStatusCard — Heal-Status pro Kurs/Track
 *
 * - Zeigt Aggregat pro Track (geheilt / failed / pending / running)
 * - Drill-down: Pakete mit Heal-Status, Zeitstempel, Skip-Begründung
 * - Per-Step-Retry-Buttons für fehlgeschlagene Step-Keys
 * - Auto-Heal-Plan (Dry-Run / Execute) mit Job-Block-Check & Skip-Reason
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Activity, AlertTriangle, CheckCircle2, Clock, PauseCircle, Play, RefreshCw, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { CopyButton } from "@/components/admin/shared/CopyButton";
import { PackageActionsMenu } from "@/components/admin/shared/PackageActionsMenu";

type TrackRow = {
  track: string;
  packages_total: number;
  pkg_healed: number;
  pkg_failed: number;
  pkg_with_failed_steps: number;
  pkg_jobs_running: number;
  pkg_untouched: number;
  last_heal_at: string | null;
};

type PackageRow = {
  package_id: string;
  package_title: string | null;
  track: string | null;
  package_status: string | null;
  blocked_reason: string | null;
  heals_success: number;
  heals_skipped: number;
  heals_failed: number;
  heals_total: number;
  last_heal_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_skip_at: string | null;
  last_reason: string | null;
  last_action_type: string | null;
  failed_steps: number;
  queued_steps: number;
  running_steps: number;
  failed_step_keys: string[];
  active_jobs: number;
  heal_state:
    | "jobs_running"
    | "has_failed_steps"
    | "last_heal_failed"
    | "healed"
    | "no_heal_history"
    | "pending";
};

type AutoHealRow = {
  package_id: string;
  package_title: string | null;
  track: string | null;
  action: string;
  step_keys: string[] | null;
  active_jobs: number;
  skip_reason: string | null;
  applied: boolean;
};

const STATE_BADGE: Record<PackageRow["heal_state"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  healed:           { label: "Geheilt",         variant: "default"     },
  has_failed_steps: { label: "Failed Steps",    variant: "destructive" },
  last_heal_failed: { label: "Heal fehlgeschl.", variant: "destructive" },
  jobs_running:     { label: "Jobs laufen",     variant: "secondary"   },
  no_heal_history:  { label: "Unberührt",       variant: "outline"     },
  pending:          { label: "Pending",         variant: "outline"     },
};

function fmt(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

const STALE_LOG_CUTOFF_MS = 24 * 60 * 60 * 1000;

function isStale(ts: string | null): boolean {
  if (!ts) return false;
  return Date.now() - new Date(ts).getTime() > STALE_LOG_CUTOFF_MS;
}

export function HealStatusCard() {
  const qc = useQueryClient();
  const [trackFilter, setTrackFilter] = useState<string>("ALL");
  const [stateFilter, setStateFilter] = useState<string>("ALL");
  const [autoHealResult, setAutoHealResult] = useState<AutoHealRow[] | null>(null);

  const tracksQ = useQuery({
    queryKey: ["heal-status", "tracks"],
    queryFn: async (): Promise<TrackRow[]> => {
      const { data, error } = await supabase
        .from("v_admin_heal_status_by_track" as never)
        .select("*")
        .order("packages_total", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TrackRow[];
    },
    refetchInterval: 30_000,
  });

  const pkgsQ = useQuery({
    queryKey: ["heal-status", "packages", trackFilter, stateFilter],
    queryFn: async (): Promise<PackageRow[]> => {
      let q = supabase
        .from("v_admin_heal_status_per_package" as never)
        .select("*")
        .order("last_heal_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (trackFilter !== "ALL") q = q.eq("track", trackFilter);
      if (stateFilter !== "ALL") q = q.eq("heal_state", stateFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PackageRow[];
    },
    refetchInterval: 30_000,
  });

  const retryStepM = useMutation({
    mutationFn: async (vars: { packageId: string; stepKey: string }) => {
      const { data, error } = await supabase.rpc("admin_retry_failed_step" as never, {
        p_package_id: vars.packageId,
        p_step_key: vars.stepKey,
        p_reason: "ui_per_step_retry",
      } as never);
      if (error) throw error;
      return data as { ok: boolean; skipped?: boolean; reason?: string; active_jobs?: number };
    },
    onSuccess: (res, vars) => {
      if (res?.skipped) {
        toast.warning(`Skip: ${res.reason ?? "unknown"}`, {
          description: `${vars.stepKey} — ${res.active_jobs ?? 0} aktive Jobs`,
        });
      } else if (res?.ok) {
        toast.success(`Step ${vars.stepKey} retry angestoßen`);
      } else {
        toast.error(`Retry fehlgeschlagen: ${res?.reason ?? "unknown"}`);
      }
      qc.invalidateQueries({ queryKey: ["heal-status"] });
    },
    onError: (e: Error) => toast.error(`Fehler: ${e.message}`),
  });

  const autoHealM = useMutation({
    mutationFn: async (vars: { dryRun: boolean; max: number }) => {
      const { data, error } = await supabase.rpc("admin_auto_heal_remaining" as never, {
        p_max_packages: vars.max,
        p_dry_run: vars.dryRun,
      } as never);
      if (error) throw error;
      return (data ?? []) as unknown as AutoHealRow[];
    },
    onSuccess: (rows, vars) => {
      setAutoHealResult(rows);
      const skipped = rows.filter((r) => r.action === "skip").length;
      const applied = rows.filter((r) => r.applied).length;
      toast.success(
        vars.dryRun
          ? `Dry-Run: ${rows.length} Kandidaten · ${skipped} würden übersprungen`
          : `Ausgeführt: ${applied} geheilt · ${skipped} pausiert`,
      );
      qc.invalidateQueries({ queryKey: ["heal-status"] });
    },
    onError: (e: Error) => toast.error(`Auto-Heal-Fehler: ${e.message}`),
  });

  const trackOptions = ["ALL", ...(tracksQ.data?.map((t) => t.track) ?? [])];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Heal-Status pro Kurs/Track
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => qc.invalidateQueries({ queryKey: ["heal-status"] })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Track-Aggregat */}
        {tracksQ.isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {(tracksQ.data ?? []).map((t) => (
              <button
                key={t.track}
                onClick={() => setTrackFilter(t.track)}
                className={`text-left rounded-md border p-2 hover:bg-muted/50 transition ${
                  trackFilter === t.track ? "border-primary bg-primary/5" : ""
                }`}
              >
                <div className="text-xs font-semibold truncate">{t.track}</div>
                <div className="text-[10px] text-muted-foreground">
                  {t.packages_total} Pakete · letztes Heal {fmt(t.last_heal_at)}
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <Badge variant="default" className="text-[10px] h-4 px-1">
                    <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                    {t.pkg_healed}
                  </Badge>
                  <Badge variant="destructive" className="text-[10px] h-4 px-1">
                    <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                    {t.pkg_failed + t.pkg_with_failed_steps}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">
                    <Clock className="h-2.5 w-2.5 mr-0.5" />
                    {t.pkg_jobs_running}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Filter + Auto-Heal-Controls */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          <Select value={trackFilter} onValueChange={setTrackFilter}>
            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {trackOptions.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">{t === "ALL" ? "Alle Tracks" : t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">Alle Status</SelectItem>
              <SelectItem value="has_failed_steps" className="text-xs">Failed Steps</SelectItem>
              <SelectItem value="last_heal_failed" className="text-xs">Heal fehlgeschlagen</SelectItem>
              <SelectItem value="jobs_running" className="text-xs">Jobs laufen</SelectItem>
              <SelectItem value="healed" className="text-xs">Geheilt</SelectItem>
              <SelectItem value="no_heal_history" className="text-xs">Unberührt</SelectItem>
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={autoHealM.isPending}
              onClick={() => autoHealM.mutate({ dryRun: true, max: 25 })}
            >
              <PauseCircle className="h-3.5 w-3.5 mr-1.5" />
              Auto-Heal Dry-Run
            </Button>
            <Button
              size="sm"
              disabled={autoHealM.isPending}
              onClick={() => autoHealM.mutate({ dryRun: false, max: 10 })}
            >
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Auto-Heal ausführen (max 10)
            </Button>
          </div>
        </div>

        {/* Auto-Heal-Result */}
        {autoHealResult && (
          <div className="rounded-md border bg-muted/20 p-2 max-h-60 overflow-auto">
            <div className="text-xs font-semibold mb-1.5">
              Auto-Heal-Plan: {autoHealResult.length} Kandidaten
            </div>
            <div className="space-y-1">
              {autoHealResult.map((r) => (
                <div key={r.package_id} className="text-[11px] flex items-start gap-2 py-1 border-b last:border-0">
                  <Badge
                    variant={r.action === "skip" ? "secondary" : r.applied ? "default" : "outline"}
                    className="text-[10px] h-4 px-1 shrink-0"
                  >
                    {r.action}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.package_title ?? r.package_id}</div>
                    {r.skip_reason && (
                      <div className="text-muted-foreground italic">{r.skip_reason}</div>
                    )}
                    {r.step_keys && r.step_keys.length > 0 && (
                      <div className="text-muted-foreground truncate">Steps: {r.step_keys.join(", ")}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Paket-Liste */}
        {pkgsQ.isLoading ? (
          <Skeleton className="h-64" />
        ) : (pkgsQ.data ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground italic p-4 text-center">
            Keine Pakete im aktuellen Filter.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[600px] overflow-auto">
            {(pkgsQ.data ?? []).map((p) => {
              const badge = STATE_BADGE[p.heal_state];
              return (
                <div key={p.package_id} className="rounded-md border p-2 text-xs">
                  <div className="flex items-start gap-2">
                    <Badge variant={badge.variant} className="text-[10px] h-4 px-1 shrink-0">
                      {badge.label}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate flex items-center gap-1">
                        {p.package_title ?? p.package_id}
                        <CopyButton value={p.package_id} toastLabel="package_id kopiert" />
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.track ?? "—"} · Status {p.package_status} · Jobs {p.active_jobs}
                      </div>
                    </div>
                    <div className="text-right text-[10px] text-muted-foreground shrink-0">
                      <div>✓ {p.heals_success} · ⏭ {p.heals_skipped} · ✗ {p.heals_failed}</div>
                      <div>letztes: {fmt(p.last_heal_at)}</div>
                    </div>
                    <PackageActionsMenu
                      packageId={p.package_id}
                      defaultRetryStep={p.failed_step_keys[0] ?? "quality_council"}
                      bronzeLocked={(p.last_reason ?? "").toLowerCase().includes("bronze")}
                    />
                  </div>
                  {p.last_reason && (
                    <div
                      className={`mt-1.5 text-[10px] italic border-l-2 pl-2 ${
                        isStale(p.last_heal_at)
                          ? "text-muted-foreground/50 border-muted/40"
                          : "text-muted-foreground border-warning/40"
                      }`}
                      title={isStale(p.last_heal_at) ? "Historischer Eintrag (>24h alt)" : undefined}
                    >
                      {isStale(p.last_heal_at) && <span className="not-italic mr-1">📜</span>}
                      Grund: {p.last_reason}
                    </div>
                  )}
                  {p.failed_step_keys.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">Failed Steps:</span>
                      {p.failed_step_keys.map((sk) => (
                        <Button
                          key={sk}
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-1.5"
                          disabled={retryStepM.isPending || p.active_jobs > 0}
                          title={p.active_jobs > 0 ? "Pipeline-Jobs laufen — Retry pausiert" : `Retry ${sk}`}
                          onClick={() => retryStepM.mutate({ packageId: p.package_id, stepKey: sk })}
                        >
                          <RotateCw className="h-2.5 w-2.5 mr-1" />
                          {sk}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
