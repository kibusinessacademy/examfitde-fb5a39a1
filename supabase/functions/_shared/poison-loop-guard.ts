/**
 * Poison-Loop Guard for Generator Job Types
 *
 * Prevents infinite requeue loops where a generator job (e.g. package_generate_handbook)
 * fails with the same deterministic error signature repeatedly without any upstream
 * progress that could change the outcome.
 *
 * Detection: 3+ identical failure signatures within a 60-minute window
 * → block requeue, mark step as failed with POISON_LOOP reason, audit + notify
 *
 * This complements the validation-requeue-guard (which only covers validators)
 * and the production-guardian POISONED_LOOP (which is async/reactive).
 * This guard is synchronous at enqueue time — the job never enters the queue.
 */

import { mergePackageStepMeta } from "./merge-step-meta.ts";

// ── Config ──────────────────────────────────────────────────────
const MAX_IDENTICAL_FAILS = 3;
const DETECTION_WINDOW_MINUTES = 60;
const COOLDOWN_MINUTES = 30;

/** Generator job types subject to poison-loop guard */
const GENERATOR_GUARDED_JOB_TYPES = new Set([
  "package_generate_handbook",
  "package_generate_exam_pool",
  "package_generate_learning_content",
  "package_generate_oral_exam",
  "package_generate_lesson_minichecks",
  "package_generate_glossary",
  "package_generate_blueprint_variants",
  "package_auto_seed_exam_blueprints",
  "package_build_ai_tutor_index",
  "package_elite_harden",
]);

/** Maps generator job types to step keys for step-level blocking */
const JOB_TYPE_TO_STEP_KEY: Record<string, string> = {
  package_generate_handbook: "generate_handbook",
  package_generate_exam_pool: "generate_exam_pool",
  package_generate_learning_content: "generate_learning_content",
  package_generate_oral_exam: "generate_oral_exam",
  package_generate_lesson_minichecks: "generate_lesson_minichecks",
  package_generate_glossary: "generate_glossary",
  package_generate_blueprint_variants: "generate_blueprint_variants",
  package_auto_seed_exam_blueprints: "auto_seed_exam_blueprints",
  package_build_ai_tutor_index: "build_ai_tutor_index",
  package_elite_harden: "elite_harden",
};

export interface PoisonLoopGuardResult {
  blocked: boolean;
  reason?: string;
  failure_signature?: string;
  identical_fail_count?: number;
}

/**
 * Check whether a generator job should be blocked from re-enqueue
 * due to repeated identical failures (poison loop).
 */
export async function checkPoisonLoopGuard(
  sb: any,
  jobType: string,
  packageId: string | null,
): Promise<PoisonLoopGuardResult> {
  if (!GENERATOR_GUARDED_JOB_TYPES.has(jobType)) {
    return { blocked: false };
  }
  if (!packageId) {
    return { blocked: false };
  }

  try {
    const windowStart = new Date(Date.now() - DETECTION_WINDOW_MINUTES * 60_000).toISOString();

    // Find recent failed jobs of same type for this package within window
    const { data: recentFails } = await sb
      .from("job_queue")
      .select("id, last_error, meta, updated_at")
      .eq("package_id", packageId)
      .eq("job_type", jobType)
      .eq("status", "failed")
      .gte("updated_at", windowStart)
      .order("updated_at", { ascending: false })
      .limit(10);

    if (!recentFails || recentFails.length < MAX_IDENTICAL_FAILS) {
      return { blocked: false };
    }

    // Extract failure signatures and count identical ones
    const signatures = recentFails.map((f: any) => extractGeneratorSignature(f.last_error, f.meta));
    const latestSig = signatures[0];

    if (!latestSig) return { blocked: false };

    const identicalCount = signatures.filter((s: string) => s === latestSig).length;

    if (identicalCount < MAX_IDENTICAL_FAILS) {
      return { blocked: false, failure_signature: latestSig, identical_fail_count: identicalCount };
    }

    // ── POISON LOOP DETECTED ──
    const stepKey = JOB_TYPE_TO_STEP_KEY[jobType];
    const reason = `POISON_LOOP_BLOCKED: ${identicalCount}x identical failure "${latestSig}" for ${jobType} on pkg ${packageId.slice(0, 8)} within ${DETECTION_WINDOW_MINUTES}min`;

    console.warn(`[poison-loop-guard] 🛑 ${reason}`);

    // Block the step
    if (stepKey) {
      await mergePackageStepMeta(sb, packageId, stepKey, {
        poison_loop_blocked: true,
        poison_loop_reason: reason.slice(0, 500),
        poison_loop_signature: latestSig,
        poison_loop_blocked_at: new Date().toISOString(),
        poison_loop_identical_fails: identicalCount,
        manual_review_required: true,
      }).catch(() => {});
    }

    // Audit log
    await sb.from("auto_heal_log").insert({
      action_type: "poison_loop_guard_block",
      trigger_source: "enqueue_guard",
      target_type: "package",
      target_id: packageId,
      result_status: "blocked",
      result_detail: reason,
      metadata: {
        job_type: jobType,
        step_key: stepKey,
        failure_signature: latestSig,
        identical_fail_count: identicalCount,
        window_minutes: DETECTION_WINDOW_MINUTES,
      },
    }).catch(() => {});

    // Admin notification
    await sb.from("admin_notifications").insert({
      title: `🛑 Poison Loop: ${jobType} – ${packageId.slice(0, 8)}`,
      body: `${identicalCount}x identischer Fehler "${latestSig}" in ${DETECTION_WINDOW_MINUTES}min. Requeue blockiert. Manual Review erforderlich.`,
      category: "pipeline",
      severity: "critical",
      entity_type: "package",
      entity_id: packageId,
      metadata: {
        kind: "poison_loop_guard",
        job_type: jobType,
        step_key: stepKey,
        failure_signature: latestSig,
        identical_fail_count: identicalCount,
      },
    }).catch(() => {});

    return {
      blocked: true,
      reason,
      failure_signature: latestSig,
      identical_fail_count: identicalCount,
    };
  } catch (err) {
    // Never let the guard break the enqueue path
    console.error("[poison-loop-guard] Error:", err);
    return { blocked: false };
  }
}

/**
 * Extract a stable failure fingerprint from generator errors.
 * Focuses on MATERIALIZATION_GUARD, THRESHOLD_FAIL, and structured patterns.
 */
function extractGeneratorSignature(lastError: any, meta: any): string {
  const errorStr = typeof lastError === "string" ? lastError : JSON.stringify(lastError ?? "");

  // MATERIALIZATION_GUARD failures (most common poison pattern)
  const matMatch = errorStr.match(/MATERIALIZATION_GUARD:\s*(.+?)(?:\s*—|$)/);
  if (matMatch) return `MAT_GUARD:${matMatch[1].trim().slice(0, 200)}`;

  // THRESHOLD_FAIL
  const threshMatch = errorStr.match(/THRESHOLD_FAIL[:\s]*(.+)/);
  if (threshMatch) return `THRESHOLD_FAIL:${threshMatch[1].trim().slice(0, 200)}`;

  // GATE_FAIL
  const gateMatch = errorStr.match(/GATE_FAIL:\s*(.+)/);
  if (gateMatch) return `GATE_FAIL:${gateMatch[1].trim().slice(0, 200)}`;

  // Structured meta
  if (meta && typeof meta === "object") {
    const parts: string[] = [];
    if (meta.materialization_retries !== undefined) parts.push(`mat_retry:${meta.materialization_retries}`);
    if (meta.artifact_verify_reason) parts.push(`verify:${meta.artifact_verify_reason}`);
    if (parts.length > 0) return parts.join("|");
  }

  // Strip admin cleanup suffixes for stable comparison
  const cleaned = errorStr.replace(/\s*\|\s*ADMIN_CLEANUP:.*$/g, "").trim();
  return `err:${cleaned.slice(0, 200)}`;
}
