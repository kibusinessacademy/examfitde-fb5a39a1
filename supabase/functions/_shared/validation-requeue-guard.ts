/**
 * F-4: Stateful Validation Requeue Guard
 *
 * Prevents no-progress validation loops by checking whether the
 * gate-relevant state has changed since the last failed validation.
 *
 * Rules:
 *   1. If last fail had same gate_signature AND no upstream progress → block
 *   2. Hard block after 3 identical fails (only upstream change unblocks)
 *   3. Cooldown: minimum 30 min between identical-state retries
 *   4. Every block is audited to auto_heal_log
 *
 * Gate signature = fingerprint of the validation outcome (coverage, issues, etc.)
 * derived from the last failed job's last_error + meta.
 */

/** Validator job types subject to requeue guard */
export const VALIDATION_GUARDED_JOB_TYPES = new Set([
  "package_validate_lesson_minichecks",
  "package_validate_exam_pool",
  "package_validate_handbook",
  "package_validate_handbook_depth",
  "package_validate_learning_content",
  "package_validate_oral_exam",
  "package_validate_tutor_index",
  "package_validate_blueprints",
  "package_validate_blueprint_variants",
]);

/** Step keys whose completion counts as "upstream progress" for a validator */
const UPSTREAM_PROGRESS_STEPS: Record<string, string[]> = {
  package_validate_lesson_minichecks: ["generate_lesson_minichecks"],
  package_validate_exam_pool: ["generate_exam_pool", "repair_exam_pool_quality", "promote_blueprint_variants"],
  package_validate_handbook: ["generate_handbook"],
  package_validate_handbook_depth: ["expand_handbook"],
  package_validate_learning_content: ["generate_learning_content", "finalize_learning_content", "repair_learning_content"],
  package_validate_oral_exam: ["generate_oral_exam"],
  package_validate_tutor_index: ["build_ai_tutor_index"],
  package_validate_blueprints: ["auto_seed_exam_blueprints"],
  package_validate_blueprint_variants: ["generate_blueprint_variants"],
};

const MAX_IDENTICAL_FAILS = 3;
const MIN_COOLDOWN_MINUTES = 30;

export interface ValidationGuardResult {
  blocked: boolean;
  reason?: string;
  gate_signature?: string;
  identical_fail_count?: number;
  cooldown_until?: string;
}

/**
 * Check whether a validation job should be blocked from re-enqueue.
 * Returns { blocked: false } for non-guarded job types.
 */
export async function checkValidationRequeueGuard(
  sb: any,
  jobType: string,
  packageId: string | null,
): Promise<ValidationGuardResult> {
  if (!VALIDATION_GUARDED_JOB_TYPES.has(jobType)) {
    return { blocked: false };
  }
  if (!packageId) {
    return { blocked: false };
  }

  try {
    // 1. Find recent failed jobs of same type for this package
    const { data: recentFails } = await sb
      .from("job_queue")
      .select("id, last_error, updated_at, meta")
      .eq("package_id", packageId)
      .eq("job_type", jobType)
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(5);

    if (!recentFails || recentFails.length === 0) {
      return { blocked: false };
    }

    const lastFail = recentFails[0];
    const lastFailAt = new Date(lastFail.updated_at);
    const lastSignature = extractGateSignature(lastFail.last_error, lastFail.meta);

    // 2. Count consecutive identical fails
    let identicalCount = 0;
    for (const f of recentFails) {
      const sig = extractGateSignature(f.last_error, f.meta);
      if (sig === lastSignature) identicalCount++;
      else break;
    }

    // 3. Check for upstream progress since last fail
    const upstreamSteps = UPSTREAM_PROGRESS_STEPS[jobType] || [];
    let hasUpstreamProgress = false;

    if (upstreamSteps.length > 0) {
      const { data: upstreamDone } = await sb
        .from("package_steps")
        .select("step_key, finished_at")
        .eq("package_id", packageId)
        .in("step_key", upstreamSteps)
        .eq("status", "done");

      if (upstreamDone && upstreamDone.length > 0) {
        // Check if any upstream step finished AFTER the last fail
        hasUpstreamProgress = upstreamDone.some(
          (s: any) => s.finished_at && new Date(s.finished_at) > lastFailAt
        );
      }
    }

    // If upstream made progress, allow requeue
    if (hasUpstreamProgress) {
      return { blocked: false, gate_signature: lastSignature, identical_fail_count: identicalCount };
    }

    // 4. Hard block after MAX_IDENTICAL_FAILS without progress
    if (identicalCount >= MAX_IDENTICAL_FAILS) {
      const reason = `VALIDATION_HARD_BLOCK: ${identicalCount} identical fails for ${jobType} on pkg ${packageId.slice(0, 8)}, signature="${lastSignature}", no upstream progress`;
      console.warn(`[val-guard] ${reason}`);
      await logValidationBlock(sb, jobType, packageId, reason, lastSignature, identicalCount);
      return { blocked: true, reason, gate_signature: lastSignature, identical_fail_count: identicalCount };
    }

    // 5. Cooldown check
    const cooldownUntil = new Date(lastFailAt.getTime() + MIN_COOLDOWN_MINUTES * 60_000);
    if (Date.now() < cooldownUntil.getTime()) {
      const reason = `VALIDATION_COOLDOWN: ${jobType} on pkg ${packageId.slice(0, 8)} failed ${minutesAgo(lastFailAt)}min ago (cooldown ${MIN_COOLDOWN_MINUTES}min), signature="${lastSignature}"`;
      console.warn(`[val-guard] ${reason}`);
      await logValidationBlock(sb, jobType, packageId, reason, lastSignature, identicalCount, cooldownUntil.toISOString());
      return {
        blocked: true,
        reason,
        gate_signature: lastSignature,
        identical_fail_count: identicalCount,
        cooldown_until: cooldownUntil.toISOString(),
      };
    }

    // Cooldown expired, allow one more attempt
    return { blocked: false, gate_signature: lastSignature, identical_fail_count: identicalCount };
  } catch (err) {
    // Never let the guard break the enqueue path
    console.error("[val-guard] Error in checkValidationRequeueGuard:", err);
    return { blocked: false };
  }
}

/**
 * Extract a stable fingerprint from the validator's failure output.
 * Normalizes GATE_FAIL messages into a comparable string.
 */
function extractGateSignature(lastError: any, meta: any): string {
  const errorStr = typeof lastError === "string" ? lastError : JSON.stringify(lastError ?? "");

  // Parse structured GATE_FAIL patterns like "GATE_FAIL: coverage=73%, critical_issues=1"
  const gateMatch = errorStr.match(/GATE_FAIL:\s*(.+)/);
  if (gateMatch) {
    return `GATE_FAIL:${gateMatch[1].trim()}`;
  }

  // Parse THRESHOLD_FAIL
  const threshMatch = errorStr.match(/THRESHOLD_FAIL[:\s]*(.+)/);
  if (threshMatch) {
    return `THRESHOLD_FAIL:${threshMatch[1].trim().slice(0, 200)}`;
  }

  // Parse coverage/metrics from meta
  if (meta && typeof meta === "object") {
    const parts: string[] = [];
    if (meta.coverage_percent !== undefined) parts.push(`cov:${meta.coverage_percent}`);
    if (meta.critical_issues !== undefined) parts.push(`crit:${meta.critical_issues}`);
    if (meta.missing_count !== undefined) parts.push(`miss:${meta.missing_count}`);
    if (meta.gate_classification) parts.push(`gate:${meta.gate_classification}`);
    if (parts.length > 0) return parts.join("|");
  }

  // Fallback: hash of the error string (first 200 chars)
  return `err:${errorStr.slice(0, 200)}`;
}

function minutesAgo(d: Date): number {
  return Math.round((Date.now() - d.getTime()) / 60_000);
}

async function logValidationBlock(
  sb: any,
  jobType: string,
  packageId: string,
  reason: string,
  gateSignature: string,
  identicalCount: number,
  cooldownUntil?: string,
): Promise<void> {
  try {
    await sb.from("auto_heal_log").insert({
      action_type: "validation_requeue_guard",
      trigger_source: "enqueue_guard",
      target_type: "package",
      target_id: packageId,
      result_status: "blocked",
      result_detail: reason,
      metadata: {
        job_type: jobType,
        gate_signature: gateSignature,
        identical_fail_count: identicalCount,
        cooldown_until: cooldownUntil || null,
      },
    });
  } catch (_e) {
    // fire-and-forget
  }
}
