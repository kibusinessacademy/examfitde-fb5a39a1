/**
 * SSOT Heal Recommendation Engine v2
 * ──────────────────────────────────
 * Datenbasierte Mode/Step/Plan-Empfehlung — NICHT mehr nur reason-basiert.
 *
 * Reihenfolge der Entscheidungen:
 *   1. Hard-Eskalation bei Loop/Stuck/queued_without_job/repair_no_effect/active_jobs_exist
 *   2. Daten-getriebene Mappings (questionsCount, lf/comp coverage, hasLessons)
 *   3. Reason-Hinweise als Sekundärsignal
 *   4. Default: soft reentry → run_integrity_check
 */
import type { HealEnqueueAction } from "./healActionRegistry";

export type HealMode = "soft" | "hard";

export interface HealSnapshot {
  packageId: string;
  track?: string | null;
  releaseClass?: "release_ok" | "release_warn" | "release_block" | null;
  blockReason?: string | null;
  hardFailReasons?: string[];
  hasActiveJobs: boolean;
  isStuck: boolean;

  // Echtdaten (optional, aber stark gewichtet wenn vorhanden)
  lessonsCount?: number | null;
  questionsCount?: number | null;
  competencyCoveragePct?: number | null;
  learningFieldCoveragePct?: number | null;
  hasMinichecks?: boolean | null;
  hasHandbook?: boolean | null;
  hasOralExam?: boolean | null;

  currentQueuedStep?: string | null;
}

export interface HealEnqueueStepPlan {
  action: HealEnqueueAction;
  payload?: Record<string, unknown>;
}

export interface HealRecommendation {
  mode: HealMode;
  resetFromStep: string;
  enqueuePlan: HealEnqueueStepPlan[];
  rationale: string;
  /** True if hard heal was forced by loop/stuck conditions even though soft would have sufficed semantically. */
  forcedHard: boolean;
}

const HARD_BLOCK_TOKENS = [
  "repair_no_effect",
  "queued_without_job",
  "active_jobs_exist",
  "pipeline_repair_required",
  "terminal_escalation",
];

export function shouldForceHardHeal(snap: HealSnapshot): boolean {
  if (snap.isStuck) return true;
  const block = (snap.blockReason ?? "").toLowerCase();
  return HARD_BLOCK_TOKENS.some((t) => block.includes(t));
}

export function recommendHeal(snap: HealSnapshot): HealRecommendation {
  const reasons = (snap.hardFailReasons ?? []).map((r) => r.toUpperCase());
  const forceHard = shouldForceHardHeal(snap);

  // ── 1. Lessons fehlen komplett → scaffold_learning_course ──
  if ((snap.lessonsCount ?? -1) === 0) {
    return {
      mode: "hard",
      resetFromStep: "scaffold_learning_course",
      enqueuePlan: [{ action: "enqueue_scaffold_learning_course" }],
      rationale: "0 lessons — needs full learning-course scaffold.",
      forcedHard: forceHard,
    };
  }

  // ── 2. Exam Pool: 0 Fragen → Vollgenerierung ──
  if ((snap.questionsCount ?? -1) === 0) {
    return {
      mode: "hard",
      resetFromStep: "generate_exam_pool",
      enqueuePlan: [{ action: "enqueue_generate_exam_pool" }],
      rationale: "0 questions — full exam-pool generation required.",
      forcedHard: forceHard,
    };
  }

  // ── 3. Exam Pool: LF-Coverage < 90% → LF-Repair zuerst, dann Quality ──
  const lfPct = snap.learningFieldCoveragePct ?? null;
  if (lfPct !== null && lfPct < 90) {
    return {
      mode: forceHard ? "hard" : "soft",
      resetFromStep: "generate_exam_pool",
      enqueuePlan: [
        { action: "enqueue_repair_exam_pool_lf_coverage" },
        { action: "enqueue_repair_exam_pool_quality" },
      ],
      rationale: `LF coverage ${lfPct.toFixed(1)}% < 90% — LF repair first, then quality.`,
      forcedHard: forceHard,
    };
  }

  // ── 4. Comp-Coverage < 75% → Quality-Repair (deckt Gaps via Generation) ──
  const compPct = snap.competencyCoveragePct ?? null;
  if (compPct !== null && compPct < 75) {
    return {
      mode: forceHard ? "hard" : "soft",
      resetFromStep: "generate_exam_pool",
      enqueuePlan: [{ action: "enqueue_repair_exam_pool_quality" }],
      rationale: `Competency coverage ${compPct.toFixed(1)}% < 75% — quality repair to close gaps.`,
      forcedHard: forceHard,
    };
  }

  // ── 5. Reason-getrieben: Minichecks / Handbook / Oral ──
  if (reasons.some((r) => r.includes("MINICHECK")) || snap.hasMinichecks === false) {
    return {
      mode: forceHard ? "hard" : "soft",
      resetFromStep: "fanout_learning_content",
      enqueuePlan: [{ action: "enqueue_repair_minichecks" }],
      rationale: "MiniCheck deficit — repair minichecks.",
      forcedHard: forceHard,
    };
  }
  if (reasons.some((r) => r.includes("HANDBOOK")) || snap.hasHandbook === false) {
    return {
      mode: forceHard ? "hard" : "soft",
      resetFromStep: "generate_handbook",
      enqueuePlan: [{ action: "enqueue_repair_handbook" }],
      rationale: "Handbook deficit — repair handbook.",
      forcedHard: forceHard,
    };
  }
  if (reasons.some((r) => r.includes("ORAL")) || snap.hasOralExam === false) {
    return {
      mode: forceHard ? "hard" : "soft",
      resetFromStep: "generate_oral_exam",
      enqueuePlan: [{ action: "enqueue_repair_oral_exam" }],
      rationale: "Oral exam deficit — repair oral exam.",
      forcedHard: forceHard,
    };
  }

  // ── 6. Reason-getriebener Exam Pool Quality Fallback ──
  if (
    reasons.some(
      (r) =>
        r.includes("EXAM_POOL") ||
        r.includes("BLOOM") ||
        r.includes("HARDISH") ||
        r.includes("EASY_TOO_HIGH") ||
        r.includes("TRAP"),
    )
  ) {
    return {
      mode: forceHard ? "hard" : "soft",
      resetFromStep: "generate_exam_pool",
      enqueuePlan: [{ action: "enqueue_repair_exam_pool_quality" }],
      rationale: "Exam-pool quality reasons — quality repair.",
      forcedHard: forceHard,
    };
  }

  // ── 7. release_ok ohne aktive Jobs → soft reentry to publish ──
  if (snap.releaseClass === "release_ok" && !snap.hasActiveJobs && !forceHard) {
    return {
      mode: "soft",
      resetFromStep: "auto_publish",
      enqueuePlan: [],
      rationale: "release_ok and no active jobs — soft reentry to publish.",
      forcedHard: false,
    };
  }

  // ── 8. Hard escalation default (loop/stuck) ──
  if (forceHard) {
    return {
      mode: "hard",
      resetFromStep: snap.currentQueuedStep ?? "run_integrity_check",
      enqueuePlan: [],
      rationale: "Stuck / loop — hard reset without specific repair plan.",
      forcedHard: true,
    };
  }

  // ── 9. Default ──
  return {
    mode: "soft",
    resetFromStep: "run_integrity_check",
    enqueuePlan: [],
    rationale: "Default soft reentry: re-run integrity check.",
    forcedHard: false,
  };
}
