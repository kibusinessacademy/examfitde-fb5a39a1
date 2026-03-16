/**
 * ShardProgressPanel — Per-LF shard progress for the Control Tower
 * Shows real-time shard status per learning field within a package.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

interface ShardRow {
  package_id: string;
  learning_field_id: string;
  shard_status: string;
  lesson_target_count: number;
  lesson_generated_count: number;
  lesson_failed_count: number;
  progress_pct: number;
  learning_field_title: string | null;
  lf_position: number | null;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
}

interface ShardSummary {
  package_id: string;
  total_shards: number;
  pending_shards: number;
  processing_shards: number;
  completed_shards: number;
  failed_shards: number;
  total_lessons: number;
  total_generated: number;
  total_failed: number;
  overall_progress_pct: number;
  all_shards_complete: boolean;
}

function useShardProgress(packageId: string) {
  return useQuery({
    queryKey: ["shard-progress", packageId],
    queryFn: async () => {
      const [detailRes, summaryRes] = await Promise.all([
        supabase
          .from("v_package_content_shard_progress" as any)
          .select("*")
          .eq("package_id", packageId)
          .order("lf_position", { ascending: true }),
        supabase
          .from("v_package_shard_summary" as any)
          .select("*")
          .eq("package_id", packageId)
          .maybeSingle(),
      ]);
      return {
        shards: (detailRes.data ?? []) as ShardRow[],
        summary: summaryRes.data as ShardSummary | null,
      };
    },
    refetchInterval: 8_000,
    enabled: !!packageId,
  });
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  pending: { icon: <Clock className="h-3.5 w-3.5" />, color: "bg-muted text-muted-foreground", label: "Wartend" },
  processing: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, color: "bg-primary/10 text-primary", label: "Läuft" },
  completed: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: "bg-emerald-500/10 text-emerald-600", label: "Fertig" },
  failed: { icon: <XCircle className="h-3.5 w-3.5" />, color: "bg-destructive/10 text-destructive", label: "Fehler" },
};

export function ShardProgressPanel({ packageId }: { packageId: string }) {
  const { data, isLoading } = useShardProgress(packageId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Content Shards</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Loader2 className="h-3 w-3 animate-spin" /> Lade Shard-Daten…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data?.shards?.length) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Content Shards</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Keine Shards vorhanden — Fan-Out noch nicht gestartet.</p>
        </CardContent>
      </Card>
    );
  }

  const summary = data.summary;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            Content Shards ({data.shards.length} Lernfelder)
          </CardTitle>
          {summary && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {summary.total_generated}/{summary.total_lessons} Lessons
              </span>
              <Badge variant="outline" className="text-[10px]">
                {summary.overall_progress_pct}%
              </Badge>
              {summary.failed_shards > 0 && (
                <Badge variant="destructive" className="text-[10px]">
                  {summary.failed_shards} fehlgeschlagen
                </Badge>
              )}
            </div>
          )}
        </div>
        {summary && (
          <Progress value={Number(summary.overall_progress_pct)} className="h-1.5 mt-2" />
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          {data.shards.map((shard) => {
            const cfg = STATUS_CONFIG[shard.shard_status] ?? STATUS_CONFIG.pending;
            return (
              <div
                key={`${shard.learning_field_id}-${shard.shard_status}`}
                className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0"
              >
                <Badge className={`${cfg.color} text-[10px] gap-1 shrink-0`}>
                  {cfg.icon}
                  {cfg.label}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">
                    {shard.learning_field_title ?? shard.learning_field_id.slice(0, 8)}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Progress value={Number(shard.progress_pct)} className="h-1 flex-1" />
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {shard.lesson_generated_count}/{shard.lesson_target_count}
                    </span>
                  </div>
                </div>
                {shard.lesson_failed_count > 0 && (
                  <div className="flex items-center gap-1 text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    <span className="text-[10px]">{shard.lesson_failed_count}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
