/**
 * Commerce Heal Matrix — Stage A SSOT (read-only reference).
 * ────────────────────────────────────────────────────────────
 * Maps each commerce gap_code (from v_commerce_gap_classification) to:
 *   - the canonical existing job_type that closes the gap (no new types)
 *   - the cooldown that the dispatcher MUST respect (auto_heal_log lookup)
 *   - whether the gap is auto-healable (Stage C/D) or audit-only
 *
 * This is the **single source of truth** for the Commerce Auto-Heal
 * Dispatcher (Stage B+). The dispatcher RPC will read this taxonomy
 * via the corresponding DB-side mirror once Stage B is reviewed.
 *
 * Stage A: code-only, used by:
 *   - CommerceReadinessCard for explanatory hover/labels
 *   - Vitest taxonomy completeness check
 *   - upcoming Stage B dispatcher migration (DB mirror generated from this)
 *
 * Hard rule: never write a job_type here that is not registered in
 * `ops_job_type_registry`. New repair pathways must be governance-approved
 * first.
 */

export type CommerceGapCode =
  | "MISSING_CANONICAL"
  | "MISSING_PRICE"
  | "MISSING_DELIVERY"
  | "MISSING_LESSONS"
  | "MISSING_EXAM_POOL"
  | "MISSING_TUTOR"
  | "MISSING_ENTITLEMENT"
  | "CHECKOUT_FAIL"
  | "TRACKING_FAIL"
  | "SEO_NOT_READY";

export type CommerceHealMode =
  | "auto_enqueue"     // Dispatcher enqueued bestehenden job_type
  | "audit_only"       // nur Audit, kein Auto-Heal (Datenintegrität)
  | "smoke_rerun"      // Re-Verify via funnel-smoke-daily
  | "manual_review";   // bewusst nicht autonom (Pricing/Tracking)

export interface CommerceHealRule {
  gapCode: CommerceGapCode;
  /** Existing job_type — must be present in ops_job_type_registry. */
  jobType: string | null;
  /** Cooldown enforced via auto_heal_log lookup before re-enqueue. */
  cooldownHours: number;
  mode: CommerceHealMode;
  /** Severity hint surfaced in UI (mirrors view classification). */
  severityHint: 1 | 2 | 3;
  description: string;
}

/**
 * Canonical mapping. Keep alphabetical by gapCode.
 * Any change here must ship together with a Stage B DB migration.
 */
export const COMMERCE_HEAL_MATRIX: Readonly<Record<CommerceGapCode, CommerceHealRule>> = Object.freeze({
  CHECKOUT_FAIL: {
    gapCode: "CHECKOUT_FAIL",
    jobType: null, // re-runs funnel-smoke-daily (edge function), not a queue job
    cooldownHours: 1,
    mode: "smoke_rerun",
    severityHint: 3,
    description: "Letzter Funnel-Smoke fehlgeschlagen → targeted Re-Smoke.",
  },
  MISSING_CANONICAL: {
    gapCode: "MISSING_CANONICAL",
    jobType: null,
    cooldownHours: 24,
    mode: "audit_only",
    severityHint: 1,
    description: "products.canonical_slug fehlt — DB-side STORED, daher nur Drift-Audit.",
  },
  MISSING_DELIVERY: {
    gapCode: "MISSING_DELIVERY",
    jobType: "post_publish_content_repair_lessons",
    cooldownHours: 6,
    mode: "auto_enqueue",
    severityHint: 2,
    description: "delivery_ready=false → Post-Publish-Repair via Lessons-Pipeline.",
  },
  MISSING_ENTITLEMENT: {
    gapCode: "MISSING_ENTITLEMENT",
    jobType: null,
    cooldownHours: 24,
    mode: "audit_only",
    severityHint: 2,
    description: "channel_policy default fehlt — Repair via admin_repair_entitlements (manuell, Stage D).",
  },
  MISSING_EXAM_POOL: {
    gapCode: "MISSING_EXAM_POOL",
    jobType: "package_generate_exam_pool",
    cooldownHours: 12,
    mode: "auto_enqueue",
    severityHint: 2,
    description: "Exam-Pool nicht ready → Generation-Job (Lane integrity).",
  },
  MISSING_LESSONS: {
    gapCode: "MISSING_LESSONS",
    jobType: "post_publish_content_repair_lessons",
    cooldownHours: 6,
    mode: "auto_enqueue",
    severityHint: 2,
    description: "Lessons-Gap → bestehende Lessons-Repair-Pipeline.",
  },
  MISSING_PRICE: {
    gapCode: "MISSING_PRICE",
    jobType: null,
    cooldownHours: 0,
    mode: "manual_review",
    severityHint: 3,
    description: "Stripe-Price fehlt — Pricing-Integrity-Hard-Gate v2 verlangt manuelle Aktivierung.",
  },
  MISSING_TUTOR: {
    gapCode: "MISSING_TUTOR",
    jobType: "package_repair_tutor_index",
    cooldownHours: 12,
    mode: "auto_enqueue",
    severityHint: 2,
    description: "Tutor-Index nicht bereit → Repair-Job auf Tutor-Pipeline.",
  },
  SEO_NOT_READY: {
    gapCode: "SEO_NOT_READY",
    jobType: "seo_intent_page_generate",
    cooldownHours: 24,
    mode: "auto_enqueue",
    severityHint: 1,
    description: "Pillar/Persona-Landing nicht published → SEO-Generation pro Persona.",
  },
  TRACKING_FAIL: {
    gapCode: "TRACKING_FAIL",
    jobType: null,
    cooldownHours: 0,
    mode: "manual_review",
    severityHint: 1,
    description: "Tracking-Drift (Strict-Event-Guard) — Datenintegritäts-Risiko, kein Auto-Heal.",
  },
});

/** Drift guard: a Vitest verifies key parity with CommerceGapCode. */
export const COMMERCE_GAP_CODES: ReadonlyArray<CommerceGapCode> = Object.freeze([
  "MISSING_CANONICAL",
  "MISSING_PRICE",
  "MISSING_DELIVERY",
  "MISSING_LESSONS",
  "MISSING_EXAM_POOL",
  "MISSING_TUTOR",
  "MISSING_ENTITLEMENT",
  "CHECKOUT_FAIL",
  "TRACKING_FAIL",
  "SEO_NOT_READY",
]);

export function getCommerceHealRule(code: CommerceGapCode): CommerceHealRule {
  const rule = COMMERCE_HEAL_MATRIX[code];
  if (!rule) throw new Error(`commerceHealMatrix: unknown gap_code "${code}"`);
  return rule;
}
