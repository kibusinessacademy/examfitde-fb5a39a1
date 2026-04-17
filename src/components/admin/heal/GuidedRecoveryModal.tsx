/**
 * Guided Recovery Modal — v8.4
 *
 * Drei-Phasen-Flow für `guided_recovery` Pakete:
 *   1. Diagnose: Signale aus deficiency_codes / open_jobs_by_type / exhausted_steps / blocked_reason
 *   2. Reset Exhaustion: Counter zurücksetzen, failed Jobs requeuen (mit Bonus-WIP-Slot)
 *   3. Targeted Repair: Empfehlungen aus Diagnose, strikt SSOT-basiert
 *
 * Repair-Mapping (SSOT):
 *   - Exam-Pool-Defizite (POOL_*, EXAM_*, BLUEPRINT_*) → repair_exam_pool_quality
 *   - Lessons/Content/Placeholder/Depth         → repair_lessons
 *   - Handbook (HANDBOOK_*, NO_HANDBOOK)        → repair_handbook
 *   - MiniCheck (MINICHECK_*)                   → repair_minichecks
 *   - Oral (ORAL_*, NO_ORAL)                    → repair_oral_exam
 *   - Tutor (NO_TUTOR, TUTOR_INDEX_*)           → reconcile_pipeline_tail
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  resetRepairExhaustion,
  repairLessons,
  repairHandbook,
  repairMinichecks,
  repairOralExam,
  repairExamPoolQuality,
  reconcilePipelineTail,
} from "@/integrations/supabase/admin-ops-actions";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  Loader2,
  RotateCcw,
  Stethoscope,
  Wrench,
} from "lucide-react";
import type { HealWorklistRow } from "./types";
import { useTrackApplicability } from "./useTrackApplicability";

/** Mapping Repair-Option → SSOT-Step (für Track-Applicability-Check). */
const REPAIR_TO_STEP: Record<string, string> = {
  repair_exam_pool_quality: "repair_exam_pool_quality",
  repair_lessons: "generate_learning_content",
  repair_handbook: "generate_handbook",
  repair_minichecks: "generate_lesson_minichecks",
  repair_oral_exam: "generate_oral_exam",
  reconcile_pipeline_tail: "build_ai_tutor_index",
};

type RepairKey =
  | "repair_exam_pool_quality"
  | "repair_lessons"
  | "repair_handbook"
  | "repair_minichecks"
  | "repair_oral_exam"
  | "reconcile_pipeline_tail";

interface RepairOption {
  key: RepairKey;
  label: string;
  description: string;
  reasons: string[]; // welche Signale getriggert haben
  recommended: boolean;
  run: (packageId: string) => Promise<unknown>;
}

interface Props {
  row: HealWorklistRow | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Klassifiziert Signale → Repair-Optionen.
 * Reine Frontend-Heuristik auf View-Daten — kein neues Mastery/Logic-Verhalten.
 */
function buildRepairOptions(row: HealWorklistRow): RepairOption[] {
  const codes = (row.deficiency_codes ?? []).map((c) => c.toUpperCase());
  const jobs = Object.keys(row.open_jobs_by_type ?? {}).map((j) =>
    j.toLowerCase(),
  );
  const reason = (row.blocked_reason ?? "").toUpperCase();

  const has = (preds: string[], src: string[]) =>
    preds.some((p) => src.some((s) => s.includes(p)));

  const examReasons: string[] = [];
  // SSOT-Deficiency-Tokens für Pool: POOL_*, EXAM_*, BLUEPRINT_*, APPROVED_Q (z.B. APPROVED_Q<500), Q< / Q_LT (Mengen-Schwellen)
  if (has(["POOL", "EXAM_", "BLUEPRINT", "APPROVED_Q", "Q<", "Q_LT"], codes))
    examReasons.push("deficiency: pool/exam/blueprint/approved_q");
  if (jobs.some((j) => j.includes("exam") || j.includes("pool")))
    examReasons.push("offene exam/pool jobs");
  if (reason.includes("POOL") || reason.includes("EXAM"))
    examReasons.push(`blocked_reason: ${reason}`);

  const lessonReasons: string[] = [];
  if (has(["LESSON", "CONTENT", "PLACEHOLDER", "DEPTH", "LF_COVERAGE"], codes))
    lessonReasons.push("deficiency: lessons/content");
  if (jobs.some((j) => j.includes("lesson") || j.includes("content")))
    lessonReasons.push("offene lesson/content jobs");

  const handbookReasons: string[] = [];
  if (has(["HANDBOOK", "NO_HANDBOOK", "CHAPTER"], codes))
    handbookReasons.push("deficiency: handbook");
  if (jobs.some((j) => j.includes("handbook")))
    handbookReasons.push("offene handbook jobs");

  const minicheckReasons: string[] = [];
  if (has(["MINICHECK", "MINI_CHECK"], codes))
    minicheckReasons.push("deficiency: minicheck");
  if (jobs.some((j) => j.includes("minicheck") || j.includes("mini_check")))
    minicheckReasons.push("offene minicheck jobs");

  const oralReasons: string[] = [];
  if (has(["ORAL", "NO_ORAL"], codes))
    oralReasons.push("deficiency: oral exam");
  if (jobs.some((j) => j.includes("oral")))
    oralReasons.push("offene oral jobs");

  const tutorReasons: string[] = [];
  if (has(["TUTOR", "NO_TUTOR", "TUTOR_INDEX"], codes))
    tutorReasons.push("deficiency: tutor");
  if (jobs.some((j) => j.includes("tutor")))
    tutorReasons.push("offene tutor jobs");

  const opts: RepairOption[] = [
    {
      key: "repair_exam_pool_quality",
      label: "Exam Pool Quality",
      description:
        "Reparatur des Prüfungspools — Coverage, Difficulty, Bloom-Verteilung.",
      reasons: examReasons,
      recommended: examReasons.length > 0,
      run: repairExamPoolQuality,
    },
    {
      key: "repair_lessons",
      label: "Lessons / Content",
      description:
        "Lernfeld-Content nachgenerieren (Placeholder, fehlende Tiefe, Coverage-Lücken).",
      reasons: lessonReasons,
      recommended: lessonReasons.length > 0,
      run: repairLessons,
    },
    {
      key: "repair_handbook",
      label: "Handbook",
      description: "Handbuch-Sektionen reparieren / nachgenerieren.",
      reasons: handbookReasons,
      recommended: handbookReasons.length > 0,
      run: repairHandbook,
    },
    {
      key: "repair_minichecks",
      label: "MiniChecks",
      description: "MiniChecks pro Kompetenz nachgenerieren.",
      reasons: minicheckReasons,
      recommended: minicheckReasons.length > 0,
      run: repairMinichecks,
    },
    {
      key: "repair_oral_exam",
      label: "Oral Exam",
      description: "Mündliche Prüfung reparieren / vervollständigen.",
      reasons: oralReasons,
      recommended: oralReasons.length > 0,
      run: repairOralExam,
    },
    {
      key: "reconcile_pipeline_tail",
      label: "Tutor Index / Pipeline-Tail",
      description:
        "Reconcile der Tail-Artefakte (Tutor-Index, Pipeline-Abschluss).",
      reasons: tutorReasons,
      recommended: tutorReasons.length > 0,
      run: reconcilePipelineTail,
    },
  ];

  // Reihenfolge: empfohlene zuerst
  return opts.sort((a, b) => Number(b.recommended) - Number(a.recommended));
}

export function GuidedRecoveryModal({ row, open, onClose }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [resetDone, setResetDone] = useState(false);
  const [repairsDone, setRepairsDone] = useState<Set<RepairKey>>(new Set());

  const options = useMemo(
    () => (row ? buildRepairOptions(row) : []),
    [row],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["heal-cockpit"] });
  };

  const resetMut = useMutation({
    mutationFn: () => resetRepairExhaustion(row!.package_id),
    onSuccess: (data: any) => {
      toast({
        title: "Exhaustion zurückgesetzt",
        description: `${data?.steps_reset ?? 0} Steps · ${data?.jobs_reset ?? 0} Jobs requeued (Bonus-Slot aktiv).`,
      });
      setResetDone(true);
      invalidate();
    },
    onError: (err: Error) => {
      toast({
        title: "Reset fehlgeschlagen",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const repairMut = useMutation({
    mutationFn: async (opt: RepairOption) => {
      const res = await opt.run(row!.package_id);
      return { res, key: opt.key, label: opt.label };
    },
    onSuccess: ({ key, label }) => {
      toast({
        title: `${label} angestoßen`,
        description: "Repair-Job wurde mit Priority 5 in die Queue gestellt.",
      });
      setRepairsDone((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      invalidate();
    },
    onError: (err: Error) => {
      toast({
        title: "Repair fehlgeschlagen",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setResetDone(false);
    setRepairsDone(new Set());
    onClose();
  };

  if (!row) return null;

  const recommendedCount = options.filter((o) => o.recommended).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            Guided Recovery — {row.package_title ?? "Unbenanntes Paket"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {row.course_title ?? "—"} ·{" "}
            <span className="font-mono">{row.package_id.slice(0, 8)}…</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* PHASE 1 — Diagnose */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Stethoscope className="h-4 w-4 text-primary" />
              1. Diagnose
            </div>
            <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground">Urgency:</span>{" "}
                  <strong>{row.urgency_score}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Release:</span>{" "}
                  <strong>{row.release_class ?? "n/a"}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Exhausted Steps:</span>{" "}
                  <strong>{row.exhausted_steps}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Repair Attempts:</span>{" "}
                  <strong>{row.repair_attempts_proxy}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Failed 24h:</span>{" "}
                  <strong>{row.failed_jobs_24h}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Active Repair:</span>{" "}
                  <strong>{row.active_repair_jobs}</strong>
                </div>
              </div>

              {row.blocked_reason && (
                <div className="pt-1">
                  <span className="text-muted-foreground">Blocked Reason:</span>{" "}
                  <code className="text-[10px]">{row.blocked_reason}</code>
                </div>
              )}

              {row.deficiency_codes && row.deficiency_codes.length > 0 && (
                <div className="pt-1">
                  <div className="text-muted-foreground mb-1">
                    Deficiencies ({row.deficiency_codes.length}):
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {row.deficiency_codes.map((c) => (
                      <Badge
                        key={c}
                        variant="outline"
                        className="bg-destructive/10 text-destructive border-destructive/30 text-[10px]"
                      >
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {Object.keys(row.open_jobs_by_type ?? {}).length > 0 && (
                <div className="pt-1">
                  <div className="text-muted-foreground mb-1">Offene Jobs:</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(row.open_jobs_by_type).map(([t, n]) => (
                      <Badge
                        key={t}
                        variant="outline"
                        className="text-[10px] font-mono"
                      >
                        {t} · {n}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <Separator />

          {/* PHASE 2 — Reset Exhaustion */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <RotateCcw className="h-4 w-4 text-primary" />
              2. Reset Exhaustion
              {resetDone && (
                <CheckCircle2 className="h-4 w-4 text-success" />
              )}
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Setzt Versuchszähler aller Steps zurück, requeued failed Jobs mit
                Priority 5 und gewährt dem Paket einen Bonus-WIP-Slot. Pflicht
                vor jedem Repair, wenn Exhaustion &gt; 0.
              </p>
              <Button
                size="sm"
                variant={resetDone ? "outline" : "default"}
                disabled={resetMut.isPending || resetDone}
                onClick={() => resetMut.mutate()}
                className="gap-1.5"
              >
                {resetMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : resetDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                {resetDone ? "Erledigt" : "Reset Exhaustion"}
              </Button>
            </div>
          </section>

          <Separator />

          {/* PHASE 3 — Targeted Repair */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Wrench className="h-4 w-4 text-primary" />
              3. Targeted Repair
              {recommendedCount > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {recommendedCount} empfohlen
                </Badge>
              )}
            </div>

            {recommendedCount === 0 && (
              <div className="mb-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Keine spezifischen Repair-Empfehlungen aus den aktuellen Signalen.
                Du kannst trotzdem manuell einen Repair-Pfad starten.
              </div>
            )}

            <div className="space-y-2">
              {options.map((opt) => {
                const done = repairsDone.has(opt.key);
                const pending =
                  repairMut.isPending && repairMut.variables?.key === opt.key;
                return (
                  <div
                    key={opt.key}
                    className={`rounded-md border p-3 ${
                      opt.recommended
                        ? "border-primary/40 bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {opt.label}
                          </span>
                          {opt.recommended && (
                            <Badge
                              variant="secondary"
                              className="text-[10px]"
                            >
                              empfohlen
                            </Badge>
                          )}
                          {done && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {opt.description}
                        </p>
                        {opt.reasons.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {opt.reasons.map((r) => (
                              <span
                                key={r}
                                className="text-[10px] text-muted-foreground italic"
                              >
                                · {r}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={done ? "outline" : opt.recommended ? "default" : "outline"}
                        disabled={pending || done || repairMut.isPending}
                        onClick={() => repairMut.mutate(opt)}
                        className="gap-1.5 shrink-0"
                      >
                        {pending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : done ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <Wrench className="h-3.5 w-3.5" />
                        )}
                        {done ? "Gestartet" : "Reparieren"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
