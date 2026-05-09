/**
 * SSOT Repair Action Registry
 * ───────────────────────────
 * Einzige Wahrheit für recommended_action / payload.action / repair_reason.
 *
 * Regel:
 *  - Keine freien Strings für recommended_action, repair_action, payload.action.
 *  - DB-CHECK constraint, Edge Functions, UI und SQL-Branches importieren
 *    ausschließlich aus diesem File.
 *  - Aliasse (Legacy) hier explizit kennzeichnen — max. 14 Tage Lebensdauer,
 *    danach CI-Fail.
 *
 * Drift-Verhinderung: scripts/contracts/repair-action-contract-guard.mjs
 */

export const REPAIR_ACTIONS = {
  LF_COVERAGE: 'repair_lf_coverage',
  EXAM_POOL_QUALITY: 'repair_exam_pool_quality',
  COMPETENCY_COVERAGE: 'repair_exam_pool_competency_coverage',
  LESSONS: 'repair_lessons',
  HANDBOOK: 'repair_handbook',
  ORAL_EXAM: 'repair_oral_exam',
  MINICHECKS: 'repair_minichecks',
} as const;

/**
 * Erweiterte recommended_action-Taxonomie aus dem Klassifizierer
 * (`fn_classify_*`, SQL-CASE-Branches). Auch SSOT — neue Werte hier ergänzen.
 */
export const OPS_ACTIONS = {
  GUIDED_RECOVERY: 'guided_recovery',
  MARK_CONTENT_GAP: 'mark_content_gap',
  NEEDS_REPAIR_DISPATCH: 'needs_repair_dispatch',
  FORCE_PUBLISH: 'force_publish',
  BULK_RECONCILE: 'bulk_reconcile',
  AWAITING_PIPELINE: 'awaiting_pipeline',
  MONITOR: 'monitor',
} as const;

export type RepairAction = typeof REPAIR_ACTIONS[keyof typeof REPAIR_ACTIONS];

/**
 * Legacy-Aliasse — nur für Transition. Stichtag = ALIAS_EXPIRES_AT.
 * Nach Stichtag failt CI-Guard hart.
 */
export const REPAIR_ACTION_ALIASES: Record<string, RepairAction> = {
  enqueue_lf_coverage_repair: REPAIR_ACTIONS.LF_COVERAGE,
};

export const REPAIR_ACTION_ALIAS_EXPIRES_AT = '2026-05-23T00:00:00Z';

export const ALL_REPAIR_ACTION_VALUES: ReadonlyArray<string> = [
  ...Object.values(REPAIR_ACTIONS),
  ...Object.keys(REPAIR_ACTION_ALIASES),
];

export function isRepairAction(value: unknown): value is RepairAction {
  return typeof value === 'string' && (Object.values(REPAIR_ACTIONS) as string[]).includes(value);
}

export function canonicalizeRepairAction(value: string): RepairAction | null {
  if (isRepairAction(value)) return value;
  return REPAIR_ACTION_ALIASES[value] ?? null;
}
