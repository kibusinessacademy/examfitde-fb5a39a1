import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Target = {
  package_id: string;
  package_key: string;
  title: string;
  curriculum_id: string;
  product_id: string | null;
  approved_exam_question_count: number;
  oral_blueprint_count: number;
  tutor_context_count: number;
  learning_integrity_score: number;
  active_lesson_jobs: number;
  bronze_badge: string | null;
};

type DispatchResult = {
  dry_run: boolean;
  correlation_id: string;
  dispatched: number;
  skipped: number;
  results: Array<{ package_id: string; title: string; action: string; reason?: string; job_id?: string }>;
};

export function LxiNoLessonsRepairCard() {
  const qc = useQueryClient();
  const [lastResult, setLastResult] = useState<DispatchResult | null>(null);

  const targets = useQuery({
    queryKey: ["lxi-no-lessons-targets"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_lxi_no_lessons_targets" as any);
      if (error) throw error;
      return (data ?? []) as Target[];
    },
    refetchInterval: 60_000,
  });

  const dispatch = useMutation({
    mutationFn: async ({ pkg, dry }: { pkg?: string; dry: boolean }) => {
      const { data, error } = await supabase.rpc(
        "admin_dispatch_lxi_no_lessons_repair" as any,
        { _package_id: pkg ?? null, _dry_run: dry }
      );
      if (error) throw error;
      return data as DispatchResult;
    },
    onSuccess: (data) => {
      setLastResult(data);
      toast({
        title: data.dry_run ? "Dry-Run abgeschlossen" : "Repair-Jobs enqueued",
        description: `dispatched=${data.dispatched}, skipped=${data.skipped}`,
      });
      qc.invalidateQueries({ queryKey: ["lxi-no-lessons-targets"] });
      qc.invalidateQueries({ queryKey: ["learning-integrity-summary"] });
      qc.invalidateQueries({ queryKey: ["learning-integrity-audit"] });
    },
    onError: (err: Error) => {
      toast({ title: "Repair-Dispatch fehlgeschlagen", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card className="shadow-elev-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          LXI Repair: No-Lessons Packages
          <Badge variant="outline" className="text-xs">Phase 2 Vorbereitung</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-text-muted">
          Published Pakete mit <code>lesson_count = 0</code>. Enqueuet
          <code className="mx-1">package_generate_learning_content</code>. Idempotent — Pakete mit aktivem Lesson-Job werden übersprungen.
          Keine Status-Änderung, kein Demote.
        </p>

        {targets.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <div className="rounded-md border border-border-subtle divide-y divide-border-subtle">
              {(targets.data ?? []).map((t) => (
                <div key={t.package_id} className="p-2 flex items-center gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-text-strong">{t.title}</div>
                    <div className="text-xs text-text-muted truncate">
                      EQ {t.approved_exam_question_count} · O {t.oral_blueprint_count} · T {t.tutor_context_count}
                      {t.bronze_badge ? <span className="ml-2">· bronze</span> : null}
                    </div>
                  </div>
                  <div className="text-xs text-text-muted shrink-0">
                    {t.active_lesson_jobs > 0 ? (
                      <Badge variant="secondary">aktiv: {t.active_lesson_jobs}</Badge>
                    ) : (
                      <Badge variant="outline">bereit</Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={t.active_lesson_jobs > 0 || dispatch.isPending}
                    onClick={() => dispatch.mutate({ pkg: t.package_id, dry: false })}
                  >
                    Repair
                  </Button>
                </div>
              ))}
              {(targets.data?.length ?? 0) === 0 && (
                <div className="p-3 text-sm text-text-muted">Keine no-lessons Pakete. ✅</div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={dispatch.isPending || (targets.data?.length ?? 0) === 0}
                onClick={() => dispatch.mutate({ dry: true })}
              >
                Dry-Run alle
              </Button>
              <Button
                disabled={dispatch.isPending || (targets.data?.length ?? 0) === 0}
                onClick={() => dispatch.mutate({ dry: false })}
              >
                Repair alle ({targets.data?.filter((t) => t.active_lesson_jobs === 0).length ?? 0})
              </Button>
            </div>

            {lastResult && (
              <div className="rounded-md border border-border-subtle p-3 text-xs">
                <div className="text-text-muted mb-1">
                  {lastResult.dry_run ? "Dry-Run" : "Real-Run"} · dispatched={lastResult.dispatched} · skipped={lastResult.skipped}
                </div>
                <div className="space-y-1 max-h-40 overflow-auto">
                  {lastResult.results.map((r, i) => (
                    <div key={i} className="flex gap-2">
                      <Badge
                        variant={r.action === "enqueued" || r.action === "would_enqueue" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {r.action}
                      </Badge>
                      <span className="truncate flex-1">{r.title}</span>
                      {r.reason && <span className="text-text-muted">{r.reason}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
