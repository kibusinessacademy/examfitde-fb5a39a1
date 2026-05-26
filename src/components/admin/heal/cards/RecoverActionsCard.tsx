/**
 * RecoverActionsCard — Aggressive Reap (lane-aware, mit Bestätigung) +
 * Hot-Loop Quarantäne.
 * Sources:
 *  - RPC admin_reap_stale_processing_now(p_max_age_seconds, p_max_cancels, p_lane)
 *  - RPC admin_quarantine_hotloop_jobs(p_attempt_threshold, p_dry_run, p_job_types)
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ShieldAlert, Wand2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const HOTLOOP_DEFAULT_TYPES = "package_promote_blueprint_variants,package_auto_publish";

type Lane = "all" | "control" | "build" | "recovery";

const LANE_META: Record<Lane, { label: string; hint: string; tone: string }> = {
  all: { label: "Alle Lanes", hint: "Räumt stale processing Jobs in allen Lanes", tone: "destructive" },
  control: { label: "Control", hint: "Council, Auto-Publish, Promote", tone: "destructive" },
  build: { label: "Build", hint: "Generation, Storage, Render", tone: "warning" },
  recovery: { label: "Recovery", hint: "Repair, Heal, Integrity", tone: "warning" },
};

export function RecoverActionsCard() {
  const qc = useQueryClient();
  const [hotloopThreshold, setHotloopThreshold] = useState<number>(10);
  const [hotloopJobTypes, setHotloopJobTypes] = useState<string>(HOTLOOP_DEFAULT_TYPES);

  const parseJobTypes = (s: string): string[] | null => {
    const arr = s.split(",").map((t) => t.trim()).filter(Boolean);
    return arr.length > 0 ? arr : null;
  };

  const reapMutation = useMutation({
    mutationFn: async (lane: Lane) => {
      const { data, error } = await supabase.rpc(
        "admin_reap_stale_processing_now" as any,
        {
          p_max_age_seconds: 300,
          p_max_cancels: 100,
          p_lane: lane === "all" ? null : lane,
        },
      );
      if (error) throw error;
      return { lane, res: data as any };
    },
    onSuccess: ({ lane, res }) => {
      toast.success(
        `Reap (${LANE_META[lane].label}): ${res?.failed_terminal ?? 0} terminal · ${res?.requeued ?? 0} requeued`,
      );
      qc.invalidateQueries({ queryKey: ["admin-lane-health"] });
      qc.invalidateQueries({ queryKey: ["queue-throughput-v2"] });
      qc.invalidateQueries({ queryKey: ["reaper-audit"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Stale-Reap fehlgeschlagen"),
  });

  const hotloopDryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_quarantine_hotloop_jobs" as any,
        {
          p_attempt_threshold: hotloopThreshold,
          p_dry_run: true,
          p_job_types: parseJobTypes(hotloopJobTypes),
        },
      );
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      const byType = res?.by_type
        ? Object.entries(res.by_type).map(([k, v]) => `${k}:${v}`).join(" · ")
        : "—";
      toast.message(`Dry-Run: ${res?.candidate_count ?? 0} Kandidaten`, { description: byType });
    },
    onError: (e: any) => toast.error(e?.message ?? "Dry-Run fehlgeschlagen"),
  });

  const hotloopExecute = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_quarantine_hotloop_jobs" as any,
        {
          p_attempt_threshold: hotloopThreshold,
          p_dry_run: false,
          p_job_types: parseJobTypes(hotloopJobTypes),
        },
      );
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      toast.success(
        `Hot-Loop quarantäniert: ${res?.cancelled ?? 0} Jobs cancelled · ${res?.steps_deferred ?? 0} Steps deferred`,
      );
      qc.invalidateQueries({ queryKey: ["queue-throughput-v2"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Quarantäne fehlgeschlagen"),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Card className="p-4 border-destructive/40 bg-destructive-bg-subtle">
        <div className="flex items-start justify-between mb-1 gap-2">
          <h3 className="text-sm font-semibold">Stale-Processing Reap</h3>
          <span className="text-[10px] text-muted-foreground">Lane-aware · mit Bestätigung</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Räumt processing-Jobs &gt;300s ohne Heartbeat. Requeue solange attempts &lt; max,
          sonst terminal. Wähle eine Lane für gezielten Eingriff.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(LANE_META) as Lane[]).map((lane) => (
            <ReapLaneButton
              key={lane}
              lane={lane}
              meta={LANE_META[lane]}
              pending={reapMutation.isPending}
              onConfirm={() => reapMutation.mutate(lane)}
            />
          ))}
        </div>
      </Card>

      <Card className="p-4 border-warning/40 bg-warning-bg-subtle">
        <h3 className="text-sm font-semibold mb-1">Hot-Loop Quarantäne</h3>
        <p className="text-[11px] text-muted-foreground mb-2">
          Cancelt Jobs mit attempts ≥ Threshold (nur Whitelist) und auto-defert zugehörige steps via
          meta-Marker, damit Atomic-Trigger keine neuen Jobs nachlegen.
        </p>
        <div className="flex items-center gap-2 mb-2">
          <Label htmlFor="hotloop-threshold" className="text-[11px] text-muted-foreground">
            attempts ≥
          </Label>
          <Input
            id="hotloop-threshold"
            type="number"
            min={3}
            max={50}
            value={hotloopThreshold}
            onChange={(e) => setHotloopThreshold(Math.max(3, Number(e.target.value) || 10))}
            className="h-7 w-16 text-xs"
          />
        </div>
        <div className="mb-2">
          <Label htmlFor="hotloop-types" className="text-[11px] text-muted-foreground">
            Job-Typen Whitelist (komma-getrennt, leer = alle ⚠️)
          </Label>
          <Input
            id="hotloop-types"
            type="text"
            value={hotloopJobTypes}
            onChange={(e) => setHotloopJobTypes(e.target.value)}
            placeholder={HOTLOOP_DEFAULT_TYPES}
            className="h-7 text-[11px] mt-1 font-mono"
          />
        </div>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => hotloopDryRun.mutate()}
            disabled={hotloopDryRun.isPending}
            className="flex-1 text-xs"
          >
            Dry-Run
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => hotloopExecute.mutate()}
            disabled={hotloopExecute.isPending}
            className="flex-1 text-xs"
          >
            <ShieldAlert className="h-3 w-3 mr-1" /> Execute
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ReapLaneButton({
  lane,
  meta,
  pending,
  onConfirm,
}: {
  lane: Lane;
  meta: { label: string; hint: string; tone: string };
  pending: boolean;
  onConfirm: () => void;
}) {
  const isDestructive = meta.tone === "destructive";
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant={isDestructive ? "destructive" : "outline"}
          disabled={pending}
          aria-label={`Reap Lane: ${meta.label} (Sektion 1)`}
          className={cn(
            "h-auto py-2 px-2.5 flex flex-col items-start gap-0.5 text-left",
            !isDestructive && "border-warning/60",
          )}
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold">
            <Wand2 className="h-3 w-3" /> Reap {meta.label}
          </span>
          <span className={cn(
            "text-[10px] font-normal opacity-80 truncate w-full",
          )}>
            {meta.hint}
          </span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Stale-Reap für Lane <span className="font-mono">{lane}</span> ausführen?
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-sm">
            <span className="block">
              Cancelt bis zu <strong>100 processing-Jobs</strong> in Lane{" "}
              <span className="font-mono">{lane}</span> ohne Heartbeat &gt; 5min.
            </span>
            <span className="block text-muted-foreground">
              Jobs mit attempts &lt; max werden requeued (run_after +60s), sonst terminal-failed.
              Vorgang wird in <span className="font-mono">admin_actions</span> auditiert.
            </span>
            {lane === "control" && (
              <span className="block rounded border border-destructive/40 bg-destructive-bg-subtle p-2 text-[11px]">
                ⚠️ Control-Lane betrifft Council / Auto-Publish / Promote — fehlgeschlagene Jobs
                können Pakete blockieren bis der Tail-Step-Defer-Trigger greift.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(isDestructive && "bg-destructive hover:bg-destructive/90")}
          >
            Reap ausführen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
