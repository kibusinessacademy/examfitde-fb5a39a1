import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2, PlayCircle, FlaskConical } from "lucide-react";

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

type ConfirmKind = "dry" | "real" | null;

export function LxiNoLessonsRepairCard() {
  const qc = useQueryClient();
  const [lastResult, setLastResult] = useState<DispatchResult | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; mode: "dry" | "real" } | null>(null);

  const targets = useQuery({
    queryKey: ["lxi-no-lessons-targets"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_lxi_no_lessons_targets" as any);
      if (error) throw error;
      return (data ?? []) as Target[];
    },
    refetchInterval: 60_000,
  });

  const dispatchSingle = useMutation({
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

  const eligibleTargets = (targets.data ?? []).filter((t) => t.active_lesson_jobs === 0);
  const eligibleCount = eligibleTargets.length;

  async function runBulk(mode: "dry" | "real") {
    const list = eligibleTargets;
    if (list.length === 0) return;
    setBulkProgress({ done: 0, total: list.length, mode });
    const aggregate: DispatchResult = {
      dry_run: mode === "dry",
      correlation_id: `bulk-${Date.now()}`,
      dispatched: 0,
      skipped: 0,
      results: [],
    };
    try {
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        try {
          const { data, error } = await supabase.rpc(
            "admin_dispatch_lxi_no_lessons_repair" as any,
            { _package_id: t.package_id, _dry_run: mode === "dry" }
          );
          if (error) throw error;
          const res = data as DispatchResult;
          aggregate.dispatched += res.dispatched;
          aggregate.skipped += res.skipped;
          aggregate.results.push(...res.results);
        } catch (e) {
          aggregate.results.push({
            package_id: t.package_id,
            title: t.title,
            action: "error",
            reason: (e as Error).message,
          });
        }
        setBulkProgress({ done: i + 1, total: list.length, mode });
      }
      setLastResult(aggregate);
      toast({
        title: mode === "dry" ? "Dry-Run alle abgeschlossen" : "Repair alle abgeschlossen",
        description: `dispatched=${aggregate.dispatched}, skipped=${aggregate.skipped}`,
      });
      qc.invalidateQueries({ queryKey: ["lxi-no-lessons-targets"] });
      qc.invalidateQueries({ queryKey: ["learning-integrity-summary"] });
      qc.invalidateQueries({ queryKey: ["learning-integrity-audit"] });
    } finally {
      setTimeout(() => setBulkProgress(null), 1500);
    }
  }

  const isBusy = dispatchSingle.isPending || bulkProgress !== null;

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
                    disabled={t.active_lesson_jobs > 0 || isBusy}
                    onClick={() => dispatchSingle.mutate({ pkg: t.package_id, dry: false })}
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
                disabled={isBusy || eligibleCount === 0}
                onClick={() => setConfirmKind("dry")}
              >
                <FlaskConical className="h-4 w-4" />
                Dry-Run alle ({eligibleCount})
              </Button>
              <Button
                disabled={isBusy || eligibleCount === 0}
                onClick={() => setConfirmKind("real")}
              >
                <PlayCircle className="h-4 w-4" />
                Repair alle ({eligibleCount})
              </Button>
            </div>

            {bulkProgress && (
              <div className="rounded-md border border-border-subtle p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {bulkProgress.mode === "dry" ? "Dry-Run" : "Repair"} läuft… {bulkProgress.done} / {bulkProgress.total}
                </div>
                <Progress
                  value={bulkProgress.total === 0 ? 0 : Math.round((bulkProgress.done / bulkProgress.total) * 100)}
                  aria-label="Fortschritt Bulk-Dispatch"
                />
              </div>
            )}

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

        <AlertDialog open={confirmKind !== null} onOpenChange={(o) => !o && setConfirmKind(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmKind === "dry" ? "Dry-Run für alle Pakete starten?" : "Repair für alle Pakete starten?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmKind === "dry" ? (
                  <>Es wird kein Job enqueued. Es wird nur simuliert, was passieren würde — für {eligibleCount} Paket(e).</>
                ) : (
                  <>
                    Es werden <strong>{eligibleCount}</strong> Lesson-Generation-Jobs enqueued. Idempotent —
                    Pakete mit aktivem Job werden übersprungen. Keine Status-Änderung, kein Demote.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const kind = confirmKind;
                  setConfirmKind(null);
                  if (kind) void runBulk(kind === "dry" ? "dry" : "real");
                }}
              >
                {confirmKind === "dry" ? "Dry-Run starten" : "Repair starten"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
