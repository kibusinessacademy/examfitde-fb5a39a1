/**
 * SSOT Heal Action Registry
 * ─────────────────────────
 * Verhindert Taxonomie-Drift bei enqueuePlan-Schritten.
 * Jede HealEnqueueAction MUSS hier auf einen exakten AdminOpsAction-Key gemappt sein.
 *
 * Wenn du einen neuen Repair-Pfad einführst:
 *   1. Action zum Type hinzufügen
 *   2. Mapping ergänzen
 *   3. Edge-Function admin-ops-actions muss den Key kennen
 */
import type { AdminOpsAction } from "@/integrations/supabase/admin-ops-actions";

export type HealEnqueueAction =
  | "enqueue_generate_exam_pool"
  | "enqueue_repair_exam_pool_quality"
  | "enqueue_repair_exam_pool_lf_coverage"
  | "enqueue_repair_exam_pool_competency_coverage"
  | "enqueue_scaffold_learning_course"
  | "enqueue_repair_lessons"
  | "enqueue_repair_handbook"
  | "enqueue_repair_oral_exam"
  | "enqueue_repair_minichecks";

/**
 * Mapping HealEnqueueAction → konkreter admin-ops-actions Key.
 * Wenn ein dedizierter enqueue_* Endpoint noch nicht existiert,
 * fällt das Mapping auf den nächstgelegenen repair_* Key zurück.
 */
export const HEAL_ACTION_TO_OPS: Record<HealEnqueueAction, AdminOpsAction> = {
  enqueue_generate_exam_pool: "repair_exam_pool_quality", // erzwingt Generation via Quality-Repair-Pfad
  enqueue_repair_exam_pool_quality: "repair_exam_pool_quality",
  enqueue_repair_exam_pool_lf_coverage: "repair_exam_pool_quality", // bis dedizierter LF-Repair-OpsKey existiert
  enqueue_repair_exam_pool_competency_coverage: "repair_exam_pool_competency_coverage",
  enqueue_scaffold_learning_course: "repair_lessons",
  enqueue_repair_lessons: "repair_lessons",
  enqueue_repair_handbook: "repair_handbook",
  enqueue_repair_oral_exam: "repair_oral_exam",
  enqueue_repair_minichecks: "repair_minichecks",
};

export function resolveHealOpsAction(action: HealEnqueueAction): AdminOpsAction {
  const ops = HEAL_ACTION_TO_OPS[action];
  if (!ops) {
    throw new Error(`HealActionRegistry: unknown HealEnqueueAction "${action}"`);
  }
  return ops;
}
