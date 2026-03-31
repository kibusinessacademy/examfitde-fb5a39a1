/**
 * artifact-thresholds.ts — SSOT for all pipeline step completion thresholds
 *
 * INVARIANT: Every threshold used by Runtime Verifiers, DB Guards, Post-Conditions,
 * and Reconcile Views MUST be defined here. No inline magic numbers.
 *
 * Architecture:
 *   artifact-thresholds.ts  (this file — single source)
 *       ├── artifact-verifier.ts        (runtime: job completion gate)
 *       ├── post-conditions.ts          (runtime: step status gate)
 *       ├── post-conditions-extended.ts  (runtime: step status gate)
 *       └── DB triggers via get_artifact_threshold() SQL function
 *
 * RULES:
 * 1. All thresholds live here — nowhere else.
 * 2. Each threshold has a reason code following: THRESHOLD_FAIL:<step>:<artifact>
 * 3. Proportional thresholds use `compute` functions; fixed use `min` values.
 * 4. When updating thresholds here, the matching SQL function
 *    `get_artifact_threshold(step_key, context_json)` must be updated via migration.
 *
 * VERSION: Bump on any threshold change. DB function must match.
 */

export const THRESHOLD_VERSION = 1;

// ── Types ───────────────────────────────────────────────────────

export interface FixedThreshold {
  kind: "fixed";
  min: number;
  artifact: string;
  reasonCode: string;
}

export interface ProportionalThreshold {
  kind: "proportional";
  /** Computes minimum from context values */
  compute: (ctx: ThresholdContext) => number;
  /** Absolute floor (never go below this) */
  floor: number;
  artifact: string;
  reasonCode: string;
}

export type StepThreshold = FixedThreshold | ProportionalThreshold;

export interface ThresholdContext {
  learningFieldCount?: number;
  competencyCount?: number;
  chapterCount?: number;
  sectionCount?: number;
  lessonCount?: number;
  blueprintCount?: number;
  examTarget?: number;
}

// ── Threshold Definitions ───────────────────────────────────────

export const STEP_THRESHOLDS: Record<string, StepThreshold[]> = {

  // ── Scaffold: modules ≥ learning_fields, lessons ≥ competencies ──
  scaffold_learning_course: [
    {
      kind: "proportional",
      compute: (ctx) => ctx.learningFieldCount ?? 1,
      floor: 1,
      artifact: "modules",
      reasonCode: "THRESHOLD_FAIL:scaffold:modules",
    },
    {
      kind: "proportional",
      compute: (ctx) => ctx.competencyCount ?? 5,
      floor: 5,
      artifact: "lessons",
      reasonCode: "THRESHOLD_FAIL:scaffold:lessons",
    },
  ],

  // ── Glossary: ≥ 1 row per beruf (one row = one glossary) ──
  // Quality check (token_count ≥ 100) is in post-conditions-extended.ts
  generate_glossary: [
    {
      kind: "fixed",
      min: 1,
      artifact: "glossary_entries",
      reasonCode: "THRESHOLD_FAIL:glossary:entries",
    },
  ],

  // ── Learning Content: see post-conditions.ts (complex RPC-based) ──
  // Thresholds: placeholders=0, tier1_failed=0, real≥95%, avg_len≥600
  generate_learning_content: [
    {
      kind: "fixed",
      min: 600,
      artifact: "avg_lesson_length",
      reasonCode: "THRESHOLD_FAIL:learning_content:avg_len",
    },
  ],

  // ── Blueprints: proportional to learning fields ──
  auto_seed_exam_blueprints: [
    {
      kind: "proportional",
      compute: (ctx) => Math.max(10, (ctx.learningFieldCount ?? 1) * 2),
      floor: 3,
      artifact: "question_blueprints",
      reasonCode: "THRESHOLD_FAIL:blueprints:count",
    },
  ],

  // ── Exam Pool: proportional to blueprints, floor 50 ──
  generate_exam_pool: [
    {
      kind: "proportional",
      compute: (ctx) => {
        const target = ctx.examTarget ?? 1000;
        return Math.max(50, Math.floor(target * 0.05));
      },
      floor: 50,
      artifact: "exam_questions",
      reasonCode: "THRESHOLD_FAIL:exam_pool:count",
    },
  ],

  // ── Oral Exam: ≥ 10 blueprints ──
  generate_oral_exam: [
    {
      kind: "fixed",
      min: 10,
      artifact: "oral_exam_blueprints",
      reasonCode: "THRESHOLD_FAIL:oral_exam:blueprints",
    },
  ],

  // ── MiniChecks: ≥ 5 questions, 80% lesson coverage ──
  generate_lesson_minichecks: [
    {
      kind: "fixed",
      min: 5,
      artifact: "minicheck_questions",
      reasonCode: "THRESHOLD_FAIL:minichecks:count",
    },
  ],

  // ── Handbook: sections ≥ chapters ──
  generate_handbook: [
    {
      kind: "proportional",
      compute: (ctx) => ctx.chapterCount ?? 1,
      floor: 1,
      artifact: "handbook_sections",
      reasonCode: "THRESHOLD_FAIL:handbook:sections",
    },
  ],

  // ── Expand Handbook: 80% sections expanded with ≥ 1800 chars ──
  expand_handbook: [
    {
      kind: "proportional",
      compute: (ctx) => Math.max(1, Math.ceil((ctx.sectionCount ?? 1) * 0.8)),
      floor: 1,
      artifact: "expanded_sections",
      reasonCode: "THRESHOLD_FAIL:expand_handbook:expanded",
    },
  ],

  // ── AI Tutor Index: ≥ 1 (singleton per package) ──
  build_ai_tutor_index: [
    {
      kind: "fixed",
      min: 1,
      artifact: "ai_tutor_context_index",
      reasonCode: "THRESHOLD_FAIL:tutor_index:count",
    },
  ],

  // ── Integrity Check: report + version + ≥ 2 keys + freshness ──
  run_integrity_check: [
    {
      kind: "fixed",
      min: 2,
      artifact: "integrity_report_keys",
      reasonCode: "THRESHOLD_FAIL:integrity:report_keys",
    },
  ],

  // ── Validation steps: minimum artifact counts to validate ──
  validate_blueprints: [
    {
      kind: "fixed",
      min: 10,
      artifact: "question_blueprints",
      reasonCode: "THRESHOLD_FAIL:validate_blueprints:count",
    },
  ],

  validate_oral_exam: [
    {
      kind: "fixed",
      min: 10,
      artifact: "oral_exam_blueprints",
      reasonCode: "THRESHOLD_FAIL:validate_oral:count",
    },
  ],

  validate_exam_pool: [
    {
      kind: "fixed",
      min: 50,
      artifact: "exam_questions",
      reasonCode: "THRESHOLD_FAIL:validate_exam:count",
    },
  ],

  validate_lesson_minichecks: [
    {
      kind: "fixed",
      min: 1,
      artifact: "minicheck_questions",
      reasonCode: "THRESHOLD_FAIL:validate_minichecks:count",
    },
  ],

  validate_handbook: [
    {
      kind: "fixed",
      min: 3,
      artifact: "handbook_chapters",
      reasonCode: "THRESHOLD_FAIL:validate_handbook:chapters",
    },
  ],

  validate_tutor_index: [
    {
      kind: "fixed",
      min: 1,
      artifact: "ai_tutor_context_index",
      reasonCode: "THRESHOLD_FAIL:validate_tutor:count",
    },
  ],

  validate_learning_content: [
    {
      kind: "fixed",
      min: 1,
      artifact: "lessons",
      reasonCode: "THRESHOLD_FAIL:validate_learning:count",
    },
  ],
};

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Resolve the minimum threshold for a step + artifact, given context.
 * Returns the computed minimum (never below floor for proportional thresholds).
 */
export function resolveThreshold(
  stepKey: string,
  artifact: string,
  ctx: ThresholdContext = {},
): number {
  const thresholds = STEP_THRESHOLDS[stepKey];
  if (!thresholds) return 0;

  const t = thresholds.find((t) => t.artifact === artifact);
  if (!t) return 0;

  if (t.kind === "fixed") return t.min;

  const computed = t.compute(ctx);
  return Math.max(t.floor, computed);
}

/**
 * Get the reason code for a step + artifact threshold failure.
 */
export function getReasonCode(stepKey: string, artifact: string): string {
  const thresholds = STEP_THRESHOLDS[stepKey];
  if (!thresholds) return `THRESHOLD_FAIL:${stepKey}:unknown`;
  const t = thresholds.find((t) => t.artifact === artifact);
  return t?.reasonCode ?? `THRESHOLD_FAIL:${stepKey}:${artifact}`;
}

/**
 * Format a structured threshold failure message.
 * Pattern: REASON_CODE:actual/threshold
 */
export function formatThresholdFail(
  stepKey: string,
  artifact: string,
  actual: number,
  threshold: number,
): string {
  const code = getReasonCode(stepKey, artifact);
  return `${code}:${actual}/${threshold}`;
}

/**
 * Get all step keys that have thresholds defined.
 */
export function getGuardedStepKeys(): string[] {
  return Object.keys(STEP_THRESHOLDS);
}

/**
 * Export flat map of fixed thresholds for SQL function generation.
 * Used to keep DB triggers in sync with this SSOT.
 */
export function getFixedThresholdsForSQL(): Array<{
  stepKey: string;
  artifact: string;
  min: number;
}> {
  const result: Array<{ stepKey: string; artifact: string; min: number }> = [];
  for (const [stepKey, thresholds] of Object.entries(STEP_THRESHOLDS)) {
    for (const t of thresholds) {
      if (t.kind === "fixed") {
        result.push({ stepKey, artifact: t.artifact, min: t.min });
      }
    }
  }
  return result;
}
