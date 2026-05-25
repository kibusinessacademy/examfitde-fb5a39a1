/**
 * P-Completion 3 — Adaptive Exam Engine · Types.
 *
 * Closed taxonomy. Pure derivation. No backend writes. No free questions —
 * the engine only emits SLOT SPECS (competency_id + difficulty + kind) that
 * a downstream picker maps onto blueprint-approved exam_questions via SSOT
 * (NEVER shadow state, NEVER frontend question authoring).
 */

export type ExamDifficulty = "easy" | "medium" | "hard";

export type ExamSlotKind =
  | "blueprint_core"      // unveränderter Blueprint-Slot
  | "weakness_focus"      // gewichtsverschoben auf schwache Kompetenz
  | "retest"              // gezielter Re-Test nach Recovery
  | "stability_anchor";   // ruhiger Einstieg / Erholungsfenster

export interface BlueprintWeight {
  competency_id: string;
  competency_key: string;
  competency_name?: string;
  /** Blueprint-Gewicht, summiert ≈ 1.0 nach Normalisierung. */
  weight: number;
}

export interface MasterySnapshot {
  competency_id: string;
  /** 0..1 */
  mastery: number;
  last_attempt_at?: string;
}

export interface AdaptiveExamPlanInput {
  blueprint: {
    total_questions: number;
    difficulty_distribution: { easy: number; medium: number; hard: number };
    weights: ReadonlyArray<BlueprintWeight>;
    /**
     * Maximaler erlaubter Gewicht-Drift pro Kompetenz (absolut, 0..1).
     * Default 0.15 — schützt Prüfungskonformität.
     */
    max_drift?: number;
  };
  mastery: ReadonlyArray<MasterySnapshot>;
  weakKompetenzIds: ReadonlyArray<string>;
  /** Optional — falls Recovery aktiv → Re-Test-Block am Ende. */
  recoveryCompetencyIds?: ReadonlyArray<string>;
  /** Behavioral signals → optional stability_anchor. */
  signals?: {
    structureStability?: number;
    confidence?: number;
  };
}

export interface AdaptiveExamSlot {
  position: number;
  competency_id: string;
  competency_key: string;
  difficulty: ExamDifficulty;
  kind: ExamSlotKind;
  rationale: string;
}

export interface CompetencyDistribution {
  competency_id: string;
  competency_key: string;
  blueprint_weight: number;
  adapted_weight: number;
  /** adapted - blueprint */
  delta: number;
  slot_count: number;
}

export interface AdaptiveExamPlan {
  slots: ReadonlyArray<AdaptiveExamSlot>;
  competency_distribution: ReadonlyArray<CompetencyDistribution>;
  difficulty_distribution: { easy: number; medium: number; hard: number };
  retest_block_size: number;
  /** 0..1 — 1 = blueprint unverändert, 0 = stark abgewichen. */
  blueprint_conformity: number;
  /** Deterministic signature for telemetry / dedupe. */
  signature: string;
  rationale: string;
}

/* ---- Post-Exam: Readiness-Delta + Tutor-Follow-up ---- */

export interface SlotResult {
  position: number;
  is_correct: boolean;
  time_spent_seconds?: number;
}

export interface CompetencyDelta {
  competency_id: string;
  competency_key: string;
  attempted: number;
  correct: number;
  /** -1..+1, geschätzte Mastery-Verschiebung aus dieser Session. */
  mastery_delta: number;
}

export interface TutorFollowUp {
  competency_id: string;
  competency_key: string;
  /** Aus Recovery-Taxonomie (siehe lib/recovery/types). */
  path_type: "explain_again" | "practice_drill" | "exam_trap_training" | "confidence_recovery";
  rationale: string;
}

export interface AdaptiveExamOutcome {
  total: number;
  correct: number;
  score_percentage: number;
  /** Δ Readiness-Punkte (geschätzt, -20..+20). Nur Hinweis — Authority bleibt
   *  bei `useExaminerConsciousness` / Readiness-Authority. */
  readiness_delta: number;
  per_competency: ReadonlyArray<CompetencyDelta>;
  /** Deterministisch sortiert nach Schweregrad. */
  tutor_followups: ReadonlyArray<TutorFollowUp>;
  /** Plan-Signatur, gegen die der Outcome berechnet wurde. */
  plan_signature: string;
}
