/**
 * RecoverActionsCard — Aggressive Reap + Hot-Loop Quarantäne.
 * Sources:
 *  - RPC admin_reap_stale_processing_now(p_max_age_seconds, p_max_cancels)
 *  - RPC admin_quarantine_hotloop_jobs(p_attempt_threshold, p_dry_run, p_job_types)
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldAlert, Wand2 } from "lucide-react";
import { toast } from "sonner";

const HOTLOOP_DEFAULT_TYPES = "package_promote_blueprint_variants,package_auto_publish";

export function RecoverActionsCard() {
  const qc = useQueryClient();
  const [hotloopThreshold, setHotloopThreshold] = useState<number>(10);
  const [hotloopJobTypes, setHotloopJobTypes] = useState<string>(HOTLOOP_DEFAULT_TYPES);

  const parseJobTypes = (s: string): string[] | null => {
    const arr = s.split(",").map((t) => t.trim()).filter(Boolean);
    return arr.length > 0 ? arr : null;
  };

  const reapNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_reap_stale_processing_now" as any,
        { p_max_age_seconds: 300, p_max_cancels: 100 },
      );
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      toast.success(
        `Stale-Reap ausgeführt: ${res?.failed_terminal ?? 0} terminal · ${res?.requeued ?? 0} requeued`,
      );
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
      <Card className="p-4 border-destructive/40 bg-destructive/5">
        <h3 className="text-sm font-semibold mb-1">Stale-Processing Reap</h3>
        <p className="text-[11px] text-muted-foreground mb-3">
          Räumt processing-Jobs &gt;300s ohne Heartbeat sofort weg. Requeue solange attempts &lt; max,
          sonst terminal.
        </p>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => reapNow.mutate()}
          disabled={reapNow.isPending}
          className="w-full"
        >
          <Wand2 className="h-3.5 w-3.5 mr-1.5" /> Reap Now (aggressive)
        </Button>
      </Card>

      <Card className="p-4 border-warning/40 bg-warning/5">
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
