/**
 * QueueDrainCard — Bekämpft Queue-Backlog & Stale-Locks.
 *
 * Heilt zwei Engpässe aus der KI-Analyse:
 *  1. "Hohe Anzahl ausstehender Jobs" → Drain-Backlog: Priority-Boost auf älteste pending Jobs.
 *  2. "Stale-Processing Count" → Release-Stale-Locks: hängende processing-Jobs zurück in pending.
 *
 * RPCs:
 *  - admin_drain_queue_backlog(p_min_age_seconds, p_max_boost, p_target_priority, p_dry_run)
 *  - admin_release_stale_locks(p_stale_seconds, p_max_release, p_dry_run)
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Activity, Hourglass, Unlock, Zap } from "lucide-react";
import { toast } from "sonner";

type ByType = Record<string, number>;

export function QueueDrainCard() {
  const qc = useQueryClient();

  // Drain Backlog
  const [minAge, setMinAge] = useState<number>(1800);
  const [maxBoost, setMaxBoost] = useState<number>(100);
  const [targetPrio, setTargetPrio] = useState<number>(5);
  const [drainPreview, setDrainPreview] = useState<{ candidates: number; byType: ByType } | null>(null);

  // Stale Locks
  const [staleSecs, setStaleSecs] = useState<number>(600);
  const [maxRelease, setMaxRelease] = useState<number>(200);
  const [stalePreview, setStalePreview] = useState<{ candidates: number; byType: ByType } | null>(null);

  const drainMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const { data, error } = await supabase.rpc("admin_drain_queue_backlog" as any, {
        p_min_age_seconds: minAge,
        p_max_boost: maxBoost,
        p_target_priority: targetPrio,
        p_dry_run: dryRun,
      });
      if (error) throw error;
      return { data: data as any, dryRun };
    },
    onSuccess: ({ data, dryRun }) => {
      if (dryRun) {
        setDrainPreview({ candidates: data?.candidate_count ?? 0, byType: data?.by_type ?? {} });
        toast.message(`Drain-Preview: ${data?.candidate_count ?? 0} Kandidaten`, {
          description: Object.entries(data?.by_type ?? {})
            .map(([k, v]) => `${k}:${v}`)
            .slice(0, 4)
            .join(" · "),
        });
      } else {
        toast.success(`${data?.boosted ?? 0} Jobs auf Priorität ${targetPrio} geboostet`);
        setDrainPreview(null);
        qc.invalidateQueries({ queryKey: ["queue-throughput-v2"] });
        qc.invalidateQueries({ queryKey: ["targeted-heal-diagnosis"] });
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Drain fehlgeschlagen"),
  });

  const staleMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const { data, error } = await supabase.rpc("admin_release_stale_locks" as any, {
        p_stale_seconds: staleSecs,
        p_max_release: maxRelease,
        p_dry_run: dryRun,
      });
      if (error) throw error;
      return { data: data as any, dryRun };
    },
    onSuccess: ({ data, dryRun }) => {
      if (dryRun) {
        setStalePreview({ candidates: data?.candidate_count ?? 0, byType: data?.by_type ?? {} });
        toast.message(`Stale-Lock-Preview: ${data?.candidate_count ?? 0} Kandidaten`, {
          description: Object.entries(data?.by_type ?? {})
            .map(([k, v]) => `${k}:${v}`)
            .slice(0, 4)
            .join(" · "),
        });
      } else {
        toast.success(`${data?.released ?? 0} Stale-Locks freigegeben`);
        setStalePreview(null);
        qc.invalidateQueries({ queryKey: ["queue-throughput-v2"] });
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Stale-Release fehlgeschlagen"),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Drain Queue Backlog */}
      <Card className="p-4 border-warning/40 bg-warning/5" data-testid="queue-drain-card">
        <div className="flex items-center gap-2 mb-1">
          <Hourglass className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold">Queue-Backlog auflösen</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Booste die ältesten <em>pending</em> Jobs auf Priorität {targetPrio}, damit der Worker sie
          sofort zieht. Heilt „Oldest pending: &gt; 1d“.
        </p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div>
            <Label className="text-[10px] text-muted-foreground">Min-Age (sec)</Label>
            <Input
              type="number"
              min={60}
              value={minAge}
              onChange={(e) => setMinAge(Math.max(60, Number(e.target.value) || 1800))}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Max Boost</Label>
            <Input
              type="number"
              min={1}
              max={500}
              value={maxBoost}
              onChange={(e) => setMaxBoost(Math.max(1, Number(e.target.value) || 100))}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Ziel-Prio</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={targetPrio}
              onChange={(e) => setTargetPrio(Math.max(1, Number(e.target.value) || 5))}
              className="h-7 text-xs"
            />
          </div>
        </div>
        {drainPreview && (
          <div className="text-[11px] text-muted-foreground mb-2 p-2 rounded bg-muted/40">
            <Badge variant="secondary" className="mr-1">{drainPreview.candidates}</Badge>
            Kandidaten:{" "}
            {Object.entries(drainPreview.byType)
              .slice(0, 3)
              .map(([k, v]) => `${k}:${v}`)
              .join(" · ") || "—"}
          </div>
        )}
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs"
            onClick={() => drainMutation.mutate(true)}
            disabled={drainMutation.isPending}
            data-testid="queue-drain-dry-run"
          >
            Dry-Run
          </Button>
          <Button
            size="sm"
            variant="default"
            className="flex-1 text-xs"
            onClick={() => drainMutation.mutate(false)}
            disabled={drainMutation.isPending || !drainPreview}
            data-testid="queue-drain-execute"
          >
            <Zap className="h-3 w-3 mr-1" /> Boost {drainPreview?.candidates ? `(${Math.min(drainPreview.candidates, maxBoost)})` : ""}
          </Button>
        </div>
      </Card>

      {/* Release Stale Locks */}
      <Card className="p-4 border-destructive/40 bg-destructive/5" data-testid="stale-locks-card">
        <div className="flex items-center gap-2 mb-1">
          <Unlock className="h-4 w-4 text-destructive" />
          <h3 className="text-sm font-semibold">Stale-Locks freigeben</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Setzt processing-Jobs ohne Heartbeat &gt; {staleSecs}s zurück in pending — Worker zieht sie
          neu. Sanfter als „Reap Now“ (kein attempts-Increment).
        </p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <Label className="text-[10px] text-muted-foreground">Stale-Threshold (sec)</Label>
            <Input
              type="number"
              min={60}
              value={staleSecs}
              onChange={(e) => setStaleSecs(Math.max(60, Number(e.target.value) || 600))}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Max Release</Label>
            <Input
              type="number"
              min={1}
              max={500}
              value={maxRelease}
              onChange={(e) => setMaxRelease(Math.max(1, Number(e.target.value) || 200))}
              className="h-7 text-xs"
            />
          </div>
        </div>
        {stalePreview && (
          <div className="text-[11px] text-muted-foreground mb-2 p-2 rounded bg-muted/40">
            <Badge variant="secondary" className="mr-1">{stalePreview.candidates}</Badge>
            Stale:{" "}
            {Object.entries(stalePreview.byType)
              .slice(0, 3)
              .map(([k, v]) => `${k}:${v}`)
              .join(" · ") || "—"}
          </div>
        )}
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs"
            onClick={() => staleMutation.mutate(true)}
            disabled={staleMutation.isPending}
            data-testid="stale-locks-dry-run"
          >
            Dry-Run
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="flex-1 text-xs"
            onClick={() => staleMutation.mutate(false)}
            disabled={staleMutation.isPending || !stalePreview}
            data-testid="stale-locks-execute"
          >
            <Activity className="h-3 w-3 mr-1" /> Release {stalePreview?.candidates ? `(${Math.min(stalePreview.candidates, maxRelease)})` : ""}
          </Button>
        </div>
      </Card>
    </div>
  );
}
