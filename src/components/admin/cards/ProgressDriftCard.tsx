/**
 * ProgressDriftCard — Shows real vs stored progress for all building packages.
 * Highlights drift, missing artifacts, and last activity.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, TrendingUp, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface DriftRow {
  package_id: string;
  title: string;
  stored_progress: number;
  real_progress: number;
  drift: number;
  content_pct: number;
  exam_pct: number;
  minicheck_pct: number;
  handbook_pct: number;
}

function useDriftData() {
  return useQuery({
    queryKey: ["admin", "progress-drift"],
    queryFn: async (): Promise<DriftRow[]> => {
      const { data, error } = await (supabase as any)
        .from("ops_artifact_build_progress")
        .select("package_id, package_title, real_progress, content_pct, exam_pct, minicheck_pct, handbook_pct")
        .gt("real_progress", 0)
        .order("real_progress", { ascending: false });
      if (error) throw error;

      // Fetch stored progress
      const ids = (data || []).map((r: any) => r.package_id);
      if (ids.length === 0) return [];

      const { data: pkgs } = await (supabase as any)
        .from("course_packages")
        .select("id, build_progress, title")
        .in("id", ids);

      const pkgMap = new Map((pkgs || []).map((p: any) => [p.id, p]));

      return (data || []).map((r: any) => {
        const pkg = pkgMap.get(r.package_id) as any;
        return {
          package_id: r.package_id,
          title: r.package_title || pkg?.title || "?",
          stored_progress: pkg?.build_progress ?? 0,
          real_progress: r.real_progress,
          drift: r.real_progress - (pkg?.build_progress ?? 0),
          content_pct: r.content_pct ?? 0,
          exam_pct: r.exam_pct ?? 0,
          minicheck_pct: r.minicheck_pct ?? 0,
          handbook_pct: r.handbook_pct ?? 0,
        };
      }).sort((a: DriftRow, b: DriftRow) => b.drift - a.drift);
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

function DriftBar({ stored, real }: { stored: number; real: number }) {
  return (
    <div className="relative h-3 w-full rounded-full bg-muted overflow-hidden">
      <div
        className="absolute left-0 top-0 h-full rounded-full bg-primary/30"
        style={{ width: `${Math.min(real, 100)}%` }}
      />
      <div
        className="absolute left-0 top-0 h-full rounded-full bg-primary"
        style={{ width: `${Math.min(stored, 100)}%` }}
      />
    </div>
  );
}

function ArtifactDots({ content, exam, minicheck, handbook }: {
  content: number; exam: number; minicheck: number; handbook: number;
}) {
  const dot = (v: number, label: string) => (
    <span
      title={`${label}: ${v.toFixed(0)}%`}
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        v >= 90 ? "bg-emerald-500" : v >= 50 ? "bg-amber-500" : v > 0 ? "bg-orange-500" : "bg-muted-foreground/20"
      )}
    />
  );
  return (
    <div className="flex items-center gap-1" title="Content · Exam · MiniCheck · Handbook">
      {dot(content, "Content")}
      {dot(exam, "Exam")}
      {dot(minicheck, "MiniCheck")}
      {dot(handbook, "Handbook")}
    </div>
  );
}

export function ProgressDriftCard() {
  const { data, isLoading, refetch } = useDriftData();
  const [syncing, setSyncing] = useState(false);

  const handleRecompute = async () => {
    setSyncing(true);
    try {
      const { data: result, error } = await (supabase as any).rpc("recompute_package_progress");
      if (error) throw error;
      const updated = (result || []).filter((r: any) => r.updated).length;
      toast.success(`${updated} Pakete synchronisiert`);
      refetch();
    } catch (e: any) {
      toast.error(`Fehler: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  if (isLoading) return null;

  const critical = (data || []).filter(r => r.drift > 10);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-primary" />
            Progress Drift
            {critical.length > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {critical.length} kritisch
              </Badge>
            )}
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={handleRecompute}
            disabled={syncing}
          >
            <RefreshCw className={cn("h-3 w-3 mr-1", syncing && "animate-spin")} />
            SSOT Sync
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {(data || []).map((row) => (
            <div key={row.package_id} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium truncate max-w-[180px]" title={row.title}>
                  {row.title}
                </span>
                <div className="flex items-center gap-2">
                  <ArtifactDots
                    content={row.content_pct}
                    exam={row.exam_pct}
                    minicheck={row.minicheck_pct}
                    handbook={row.handbook_pct}
                  />
                  <span className="text-muted-foreground w-20 text-right">
                    {row.stored_progress}%
                    <ArrowRight className="inline h-3 w-3 mx-0.5" />
                    <span className={row.drift > 10 ? "text-destructive font-bold" : ""}>
                      {row.real_progress.toFixed(0)}%
                    </span>
                  </span>
                  {row.drift > 10 && (
                    <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
                  )}
                </div>
              </div>
              <DriftBar stored={row.stored_progress} real={row.real_progress} />
            </div>
          ))}
          {(!data || data.length === 0) && (
            <p className="text-xs text-muted-foreground text-center py-4">Keine Building-Pakete</p>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-6 rounded-full bg-primary" /> Gespeichert</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-6 rounded-full bg-primary/30" /> Real (Artefakt)</span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />C
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />E
            <span className="inline-block h-2 w-2 rounded-full bg-orange-500" />M
            <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/20" />H
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
