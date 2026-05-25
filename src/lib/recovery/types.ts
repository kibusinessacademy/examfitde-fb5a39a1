/**
 * P-Completion 2 — Mastery Recovery Loop · Types.
 *
 * Closed taxonomy. Every RecoveryRecommendation carries an explainable
 * `recovery_reason` and a deterministic `recovery_path`. No AI, no random.
 */

export type RecoverySource =
  | "minicheck_fail"
  | "exam_trainer_low"
  | "oral_trainer_unstable"
  | "tutor_fail"
  | "low_mastery"
  | "slow_response"
  | "repeat_wrong"
  | "risk_signal";

export type RecoveryPathType =
  | "explain_again"        // Tutor erklärt einfacher / schrittweise
  | "practice_drill"       // Gezielte Fragen, gleiche Kompetenz
  | "exam_trap_training"   // Typische Prüfungsfalle
  | "confidence_recovery"; // Kleinere Erfolge, Momentum

export type RecoverySeverity = "high" | "medium" | "low";

export interface RecoveryAction {
  /** UI label, short & verb-led. */
  label: string;
  /** Internal route (no external links). */
  to: string;
  path_type: RecoveryPathType;
  /** Estimated minutes — UI hint only. */
  est_minutes: number;
}

export interface RecoveryRecommendation {
  /** Stable id `recovery:${competency_id}`. */
  id: string;
  competency_id: string;
  competency_key: string;
  competency_name: string;
  severity: RecoverySeverity;
  weakness_sources: ReadonlyArray<RecoverySource>;
  /** Ordered, deterministic. First is the system's primary CTA. */
  actions: ReadonlyArray<RecoveryAction>;
  /** Machine-readable reason (audit). */
  recovery_reason: string;
  /** Suggested re-test horizon in hours (deterministic). */
  retry_after_hours: number;
  /** Target mastery delta the system aims for. 0..1. */
  mastery_target_delta: number;
}

export interface RecoveryPlan {
  recommendations: ReadonlyArray<RecoveryRecommendation>;
  /** Sum of mastery_target_delta — UI summary. */
  total_target_delta: number;
  /** Plain-language reflection for the user. */
  reflection: string;
}
