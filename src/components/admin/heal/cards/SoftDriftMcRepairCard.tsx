import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, ShieldAlert, RotateCcw, PlayCircle } from "lucide-react";
import { toast } from "sonner";

type DryRunRow = {
  package_id: string;
  package_title: string;
  track: string;
  unapproved_count: number;
  approval_pct: number;
  action: "dry_run" | "skip" | "enqueued";
  job_id: string | null;
  reason: string;
};

type TopRow = {
  package_id: string;
  package_title: string;
  track: string;
  unapproved: number;
  approval_pct: number;
  required_by_track: boolean;
};

const REASON_LABEL: Record<string, string> = {
  no_unapproved_mcs: "Keine unapproved MCs",
  active_mc_job_exists: "Aktiver MC-Job läuft bereits",
  no_lessons_in_package: "Paket hat keine Lessons",
  track_not_applicable_exam_first: "EXAM_FIRST – Track nicht zutreffend",
  eligible_for_repair: "Reparatur empfohlen",
};

function reasonBadge(action: string, reason: string) {
  if (action === "dry_run") return <Badge>eligible</Badge>;
  if (action === "enqueued") return <Badge className="bg-status-success">enqueued</Badge>;
  return <Badge variant="secondary">skip</Badge>;
}

export function SoftDriftMcRepairCard() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dryRun, setDryRun] = useState<DryRunRow[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [lastApply, setLastApply] = useState<DryRunRow[] | null>(null);

  const top = useQuery({
    queryKey: ["soft-drift-mc-top"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_mc_unapproved_top", { p_limit: 25 });
      if (error) throw error;
      return (data ?? []) as TopRow[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const dryRunMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.rpc("admin_soft_drift_mc_repair", {
        p_package_ids: ids,
        p_apply: false,
      });
      if (error) throw error;
      return (data ?? []) as DryRunRow[];
    },
    onSuccess: (rows) => {
      setDryRun(rows);
      const eligible = rows.filter((r) => r.action === "dry_run").length;
      toast.success(`Dry-Run: ${eligible} eligible / ${rows.length} geprüft`);
    },
    onError: (e: Error) => toast.error(`Dry-Run fehlgeschlagen: ${e.message}`),
  });

  const applyMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.rpc("admin_soft_drift_mc_repair", {
        p_package_ids: ids,
        p_apply: true,
      });
      if (error) throw error;
      // Audit reason explicitly
      await supabase.from("auto_heal_log").insert({
        action_type: "soft_drift_mc_required_repair_apply_ui",
        target_type: "system",
        result_status: "success",
        metadata: { package_ids: ids, reason, count: ids.length },
      });
      return (data ?? []) as DryRunRow[];
    },
    onSuccess: (rows) => {
      setLastApply(rows);
      const enq = rows.filter((r) => r.action === "enqueued").length;
      toast.success(`Apply: ${enq} Repair-Jobs enqueued`);
      qc.invalidateQueries({ queryKey: ["soft-drift-mc-top"] });
      qc.invalidateQueries({ queryKey: ["heal-cockpit"] });
      setConfirmOpen(false);
      setSelected(new Set());
      setDryRun(null);
      setReason("");
    },
    onError: (e: Error) => toast.error(`Apply fehlgeschlagen: ${e.message}`),
  });

  const rollbackMut = useMutation({
    mutationFn: async (jobIds: string[]) => {
      const { error } = await supabase
        .from("job_queue")
        .update({ status: "cancelled", last_error: "soft_drift_apply_rollback_ui" })
        .in("id", jobIds)
        .eq("status", "pending");
      if (error) throw error;
      await supabase.from("auto_heal_log").insert({
        action_type: "soft_drift_mc_required_repair_rollback_ui",
        target_type: "system",
        result_status: "success",
        metadata: { job_ids: jobIds },
      });
    },
    onSuccess: () => {
      toast.success("Rollback ausgeführt – pending Jobs cancelled");
      setLastApply(null);
      qc.invalidateQueries({ queryKey: ["soft-drift-mc-top"] });
    },
    onError: (e: Error) => toast.error(`Rollback fehlgeschlagen: ${e.message}`),
  });

  const eligibleIds = (dryRun ?? [])
    .filter((r) => r.action === "dry_run")
    .map((r) => r.package_id);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  return (
    <Card data-testid="soft-drift-mc-repair-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" /> Soft-Drift MC-Repair (Wave 6b)
            </CardTitle>
            <CardDescription>
              Top-25 Pakete mit unapproved Minichecks. Workflow:{" "}
              <strong>1. Auswahl → 2. Dry-Run → 3. Apply (mit Reason) → 4. Rollback möglich.</strong>
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => top.refetch()}
            disabled={top.isFetching}
          >
            {top.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top list */}
        <div className="rounded-md border">
          <div className="grid grid-cols-12 gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium">
            <div className="col-span-1"></div>
            <div className="col-span-5">Paket</div>
            <div className="col-span-2">Track</div>
            <div className="col-span-2 text-right">Approval %</div>
            <div className="col-span-2 text-right">Unapproved</div>
          </div>
          {top.isLoading && (
            <div className="px-3 py-6 text-sm text-text-muted">Lade…</div>
          )}
          {top.data?.length === 0 && (
            <div className="px-3 py-6 text-sm text-text-muted">Keine Drifts gefunden.</div>
          )}
          {top.data?.map((r) => (
            <div key={r.package_id} className="grid grid-cols-12 items-center gap-2 border-b px-3 py-2 text-sm last:border-0">
              <div className="col-span-1">
                <Checkbox
                  checked={selected.has(r.package_id)}
                  onCheckedChange={() => toggle(r.package_id)}
                />
              </div>
              <div className="col-span-5 truncate">{r.package_title}</div>
              <div className="col-span-2">
                <Badge variant={r.required_by_track ? "default" : "secondary"}>{r.track}</Badge>
              </div>
              <div className="col-span-2 text-right tabular-nums">{Number(r.approval_pct).toFixed(1)}%</div>
              <div className="col-span-2 text-right tabular-nums">{r.unapproved}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => dryRunMut.mutate(Array.from(selected))}
            disabled={selected.size === 0 || dryRunMut.isPending}
          >
            {dryRunMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Dry-Run ({selected.size})
          </Button>
          <Button
            variant="default"
            onClick={() => setConfirmOpen(true)}
            disabled={!dryRun || eligibleIds.length === 0 || applyMut.isPending}
          >
            <PlayCircle className="mr-2 h-4 w-4" />
            Apply ({eligibleIds.length} eligible)
          </Button>
          {lastApply && lastApply.some((r) => r.job_id) && (
            <Button
              variant="destructive"
              onClick={() =>
                rollbackMut.mutate(lastApply.filter((r) => r.job_id).map((r) => r.job_id!))
              }
              disabled={rollbackMut.isPending}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Rollback letzte Apply ({lastApply.filter((r) => r.job_id).length})
            </Button>
          )}
        </div>

        {/* Dry-run result with reasons */}
        {dryRun && (
          <div className="rounded-md border">
            <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium">
              Dry-Run Ergebnis ({dryRun.length} geprüft)
            </div>
            {dryRun.map((r) => (
              <div key={r.package_id} className="grid grid-cols-12 items-center gap-2 border-b px-3 py-2 text-sm last:border-0">
                <div className="col-span-5 truncate">{r.package_title}</div>
                <div className="col-span-2">{reasonBadge(r.action, r.reason)}</div>
                <div className="col-span-3 text-xs text-text-muted">
                  {REASON_LABEL[r.reason] ?? r.reason}
                </div>
                <div className="col-span-2 text-right text-xs tabular-nums">
                  {r.unapproved_count} / {Number(r.approval_pct).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        )}

        {lastApply && (
          <div className="rounded-md border border-status-success-border bg-status-success-bg-subtle p-3 text-xs">
            <strong>Letzte Apply:</strong>{" "}
            {lastApply.filter((r) => r.action === "enqueued").length} Jobs enqueued.{" "}
            Rollback möglich, solange Jobs noch <code>pending</code>.
          </div>
        )}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Soft-Drift MC-Repair – Apply</AlertDialogTitle>
              <AlertDialogDescription>
                {eligibleIds.length} Paket(e) erhalten einen{" "}
                <code>package_repair_lesson_minichecks</code> Job. Reason ist Pflicht und wird
                in <code>auto_heal_log</code> protokolliert.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="reason">Reason *</Label>
              <Textarea
                id="reason"
                placeholder="z. B. Sweep 2026-05-10 für required-Tracks mit MC-Approval < 85%"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                disabled={reason.trim().length < 8 || applyMut.isPending}
                onClick={() => applyMut.mutate(eligibleIds)}
              >
                {applyMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Apply
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
