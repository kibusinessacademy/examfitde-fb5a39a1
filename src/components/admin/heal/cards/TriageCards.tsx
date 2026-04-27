/**
 * TriageCards — Failed-Cluster · Blocker-Split · Hollow-Published · Track-Normalize.
 * Operative Reihenfolge: Queue → Hotloops → Cluster → Blocker → Track.
 *
 * Sources:
 *  - RPC admin_get_failed_clusters(p_window_hours)
 *  - RPC admin_get_blocked_packages_split()
 *  - RPC admin_get_hollow_published_packages()
 *  - RPC admin_normalize_track_steps(p_dry_run, p_tracks, p_max_packages)
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function TriageCards() {
  const qc = useQueryClient();

  const failed = useQuery({
    queryKey: ["admin-failed-clusters"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_failed_clusters" as any, {
        p_window_hours: 24,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 60_000,
  });

  const blockerSplit = useQuery({
    queryKey: ["admin-blocker-split"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_blocked_packages_split" as any);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 60_000,
  });

  const hollow = useQuery({
    queryKey: ["admin-hollow-published"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_hollow_published_packages" as any);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 120_000,
  });

  const [trackTargets, setTrackTargets] = useState<string>("EXAM_FIRST");
  const parseTracks = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);

  const trackDryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_normalize_track_steps" as any, {
        p_dry_run: true,
        p_tracks: parseTracks(trackTargets),
        p_max_packages: 50,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      const c = res?.candidates;
      toast.message(`Dry-Run: ${c?.total_candidates ?? 0} Steps · ${c?.distinct_packages ?? 0} Pakete`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Track-Normalize Dry-Run fehlgeschlagen"),
  });

  const trackExecute = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_normalize_track_steps" as any, {
        p_dry_run: false,
        p_tracks: parseTracks(trackTargets),
        p_max_packages: 50,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      toast.success(
        `Normalisiert: ${res?.skipped_steps ?? 0} Steps · ${res?.packages_touched ?? 0} Pakete`,
      );
      qc.invalidateQueries({ queryKey: ["admin-blocker-split"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Track-Normalize Execute fehlgeschlagen"),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Failed-Cluster */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Failed-Cluster (24h)</h3>
            <Badge variant="outline" className="text-[10px]">
              {failed.data?.length ?? 0} groups
            </Badge>
          </div>
          {failed.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="space-y-1 max-h-56 overflow-auto text-xs">
              {(failed.data ?? []).slice(0, 12).map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1 border-t border-border/40 first:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[11px] truncate">{r.job_type}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {r.error_class} · {r.last_error_code}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <Badge variant="destructive" className="text-[10px]">{r.jobs}j</Badge>
                    <Badge variant="outline" className="text-[10px]">{r.packages}p</Badge>
                  </div>
                </div>
              ))}
              {(!failed.data || failed.data.length === 0) && (
                <div className="text-[11px] text-muted-foreground py-4 text-center">
                  Keine Failed-Jobs in 24h
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Blocker-Split */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Blocked Packages · Split</h3>
            <Badge variant="outline" className="text-[10px]">
              {blockerSplit.data?.length ?? 0} groups
            </Badge>
          </div>
          {blockerSplit.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="space-y-1 max-h-56 overflow-auto text-xs">
              {(blockerSplit.data ?? []).map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1 border-t border-border/40 first:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[11px] truncate">{r.primary_blocker}</div>
                    <div className="text-[10px] text-muted-foreground">{r.package_track}</div>
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0 ml-2">
                    {r.packages}
                  </Badge>
                </div>
              ))}
              {(!blockerSplit.data || blockerSplit.data.length === 0) && (
                <div className="text-[11px] text-muted-foreground py-4 text-center">
                  Keine blockierten Pakete
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Hollow-Published */}
        <Card className={cn("p-4", (hollow.data?.length ?? 0) > 0 && "border-destructive/40 bg-destructive/5")}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Hollow-Published Forensik</h3>
            <Badge
              variant={(hollow.data?.length ?? 0) > 0 ? "destructive" : "outline"}
              className="text-[10px]"
            >
              {hollow.data?.length ?? 0} pkg
            </Badge>
          </div>
          {hollow.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="space-y-1 max-h-56 overflow-auto text-xs">
              {(hollow.data ?? []).slice(0, 10).map((r: any) => (
                <div key={r.package_id} className="flex items-center justify-between py-1 border-t border-border/40 first:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px]">
                      <span className="font-mono text-[10px] text-muted-foreground mr-1">
                        {r.package_id.slice(0, 8)}
                      </span>
                      {r.course_title ?? "—"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.package_track} · {r.primary_blocker ?? "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {r.is_published && <Badge variant="destructive" className="text-[10px]">live</Badge>}
                    <Badge variant="outline" className="text-[10px]">{r.package_status}</Badge>
                  </div>
                </div>
              ))}
              {(!hollow.data || hollow.data.length === 0) && (
                <div className="text-[11px] text-muted-foreground py-4 text-center">
                  Keine Hollow-Pakete
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Track-Normalize */}
      <Card className="p-4 border-warning/40 bg-warning/5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold">Track-Normalisierung (statt Einzel-Heal)</h3>
            <p className="text-[11px] text-muted-foreground">
              Setzt nicht-applicable <code className="font-mono">package_steps</code> für die gewählten Tracks auf{" "}
              <code className="font-mono">skipped</code> via SSOT{" "}
              <code className="font-mono">track_step_applicability</code>. Markiert sie mit{" "}
              <code className="font-mono">meta.track_normalized=true</code>. Empfohlen für EXAM_FIRST mit Shadow-Learning-Steps.
            </p>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="track-targets" className="text-[11px] text-muted-foreground">
              Tracks (komma-getrennt)
            </Label>
            <Input
              id="track-targets"
              value={trackTargets}
              onChange={(e) => setTrackTargets(e.target.value)}
              placeholder="EXAM_FIRST,EXAM_FIRST_PLUS"
              className="h-7 text-[11px] mt-1 font-mono"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => trackDryRun.mutate()}
            disabled={trackDryRun.isPending}
          >
            Dry-Run
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => trackExecute.mutate()}
            disabled={trackExecute.isPending}
          >
            <Wand2 className="h-3 w-3 mr-1" /> Execute
          </Button>
        </div>
      </Card>
    </div>
  );
}
