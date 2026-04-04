/**
 * F-4 / F-4.1: Stateful Validation Requeue Guard
 *
 * Prevents no-progress validation loops by checking whether the
 * gate-relevant state has changed since the last failed validation.
 *
 * Rules:
 *   1. If last fail had same gate_signature AND no upstream progress → block
 *   2. Hard block after 3 identical fails (only upstream change unblocks)
 *   3. Cooldown: minimum 30 min between identical-state retries
 *   4. Every block is audited to auto_heal_log
 *   5. Block state is persisted to package_steps.meta for ops visibility (F-4.1)
 *   6. Progress detection includes artifact-level changes, not just step status (F-4.1)
 *   7. Gate signature prefers structured meta over error-string parsing (F-4.1)
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

/** Artifact tables to check for data-level changes per validator */
const ARTIFACT_PROGRESS_SOURCES: Record<string, { table: string; fk: string; }[]> = {
  package_validate_lesson_minichecks: [
    { table: "minicheck_questions", fk: "package_id" },
  ],
  package_validate_exam_pool: [
    { table: "exam_questions", fk: "package_id" },
  ],
  package_validate_learning_content: [
    { table: "learning_content", fk: "package_id" },
  ],
  package_validate_handbook: [
    { table: "handbook_chapters", fk: "package_id" },
  ],
  package_validate_handbook_depth: [
    { table: "handbook_chapters", fk: "package_id" },
  ],
  package_validate_oral_exam: [
    { table: "oral_exam_questions", fk: "package_id" },
  ],
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

    // 3. Check for upstream progress since last fail (step-level + artifact-level)
    const hasUpstreamProgress = await checkUpstreamProgress(sb, jobType, packageId, lastFailAt);

    // If upstream made progress, clear any block state and allow requeue
    if (hasUpstreamProgress) {
      await clearBlockState(sb, jobType, packageId);
      return { blocked: false, gate_signature: lastSignature, identical_fail_count: identicalCount };
    }

    // 4. Hard block after MAX_IDENTICAL_FAILS without progress
    if (identicalCount >= MAX_IDENTICAL_FAILS) {
      const reason = `VALIDATION_HARD_BLOCK: ${identicalCount} identical fails for ${jobType} on pkg ${packageId.slice(0, 8)}, signature="${lastSignature}", no upstream progress`;
      console.warn(`[val-guard] ${reason}`);
      await Promise.all([
        logValidationBlock(sb, jobType, packageId, reason, lastSignature, identicalCount),
        persistBlockState(sb, jobType, packageId, reason, lastSignature, identicalCount),
      ]);
      return { blocked: true, reason, gate_signature: lastSignature, identical_fail_count: identicalCount };
    }

    // 5. Cooldown check
    const cooldownUntil = new Date(lastFailAt.getTime() + MIN_COOLDOWN_MINUTES * 60_000);
    if (Date.now() < cooldownUntil.getTime()) {
      const reason = `VALIDATION_COOLDOWN: ${jobType} on pkg ${packageId.slice(0, 8)} failed ${minutesAgo(lastFailAt)}min ago (cooldown ${MIN_COOLDOWN_MINUTES}min), signature="${lastSignature}"`;
      console.warn(`[val-guard] ${reason}`);
      await Promise.all([
        logValidationBlock(sb, jobType, packageId, reason, lastSignature, identicalCount, cooldownUntil.toISOString()),
        persistBlockState(sb, jobType, packageId, reason, lastSignature, identicalCount, cooldownUntil.toISOString()),
      ]);
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

// ─── Progress Detection (F-4.1) ───────────────────────────────────────────

/**
 * Check for upstream progress via both step-level and artifact-level signals.
 */
async function checkUpstreamProgress(
  sb: any,
  jobType: string,
  packageId: string,
  lastFailAt: Date,
): Promise<boolean> {
  // A) Step-level: any upstream step finished after the last fail
  const upstreamSteps = UPSTREAM_PROGRESS_STEPS[jobType] || [];
  if (upstreamSteps.length > 0) {
    const { data: upstreamDone } = await sb
      .from("package_steps")
      .select("step_key, finished_at")
      .eq("package_id", packageId)
      .in("step_key", upstreamSteps)
      .eq("status", "done");

    if (upstreamDone?.some(
      (s: any) => s.finished_at && new Date(s.finished_at) > lastFailAt
    )) {
      return true;
    }
  }

  // B) Artifact-level: relevant data rows updated after the last fail
  const artifactSources = ARTIFACT_PROGRESS_SOURCES[jobType];
  if (artifactSources && artifactSources.length > 0) {
    for (const src of artifactSources) {
      try {
        const { data: recentArtifact } = await sb
          .from(src.table)
          .select("updated_at")
          .eq(src.fk, packageId)
          .gt("updated_at", lastFailAt.toISOString())
          .order("updated_at", { ascending: false })
          .limit(1);

        if (recentArtifact && recentArtifact.length > 0) {
          console.log(`[val-guard] Artifact progress detected in ${src.table} for pkg ${packageId.slice(0, 8)}`);
          return true;
        }
      } catch (_e) {
        // Table might not exist or lack updated_at — skip gracefully
      }
    }
  }

  return false;
}

// ─── Gate Signature (F-4.1 enriched) ──────────────────────────────────────

/**
 * Extract a stable fingerprint from the validator's failure output.
 * Prefers structured meta fields, falls back to error-string parsing.
 */
function extractGateSignature(lastError: any, meta: any): string {
  // Priority 1: structured meta fields (most reliable)
  if (meta && typeof meta === "object") {
    const parts: string[] = [];
    if (meta.coverage_percent !== undefined) parts.push(`cov:${meta.coverage_percent}`);
    if (meta.critical_issues !== undefined) parts.push(`crit:${meta.critical_issues}`);
    if (meta.missing_count !== undefined) parts.push(`miss:${meta.missing_count}`);
    if (meta.gate_classification) parts.push(`gate:${meta.gate_classification}`);
    if (meta.approved_count !== undefined) parts.push(`appr:${meta.approved_count}`);
    if (meta.total_count !== undefined) parts.push(`total:${meta.total_count}`);
    if (parts.length > 0) return parts.join("|");
  }

  // Priority 2: parse structured GATE_FAIL / THRESHOLD_FAIL from error string
  const errorStr = typeof lastError === "string" ? lastError : JSON.stringify(lastError ?? "");

  const gateMatch = errorStr.match(/GATE_FAIL:\s*(.+)/);
  if (gateMatch) {
    return `GATE_FAIL:${gateMatch[1].trim()}`;
  }

  const threshMatch = errorStr.match(/THRESHOLD_FAIL[:\s]*(.+)/);
  if (threshMatch) {
    return `THRESHOLD_FAIL:${threshMatch[1].trim().slice(0, 200)}`;
  }

  // Priority 3: fallback hash of error string
  return `err:${errorStr.slice(0, 200)}`;
}

// ─── Block State Persistence (F-4.1) ──────────────────────────────────────

/** Persist block state to package_steps.meta so it's visible in ops dashboards */
async function persistBlockState(
  sb: any,
  jobType: string,
  packageId: string,
  reason: string,
  gateSignature: string,
  identicalCount: number,
  cooldownUntil?: string,
): Promise<void> {
  // Map job type to step key (strip "package_" prefix)
  const stepKey = jobType.replace(/^package_/, "");
  try {
    // Read current meta, merge block state
    const { data: step } = await sb
      .from("package_steps")
      .select("id, meta")
      .eq("package_id", packageId)
      .eq("step_key", stepKey)
      .maybeSingle();

    if (step) {
      const currentMeta = (step.meta && typeof step.meta === "object") ? step.meta : {};
      await sb.from("package_steps").update({
        meta: {
          ...currentMeta,
          validation_requeue_blocked: true,
          validation_requeue_reason: reason.slice(0, 500),
          validation_requeue_signature: gateSignature,
          validation_requeue_blocked_at: new Date().toISOString(),
          validation_requeue_identical_fails: identicalCount,
          validation_requeue_cooldown_until: cooldownUntil || null,
        },
      }).eq("id", step.id);
    }
  } catch (_e) {
    // fire-and-forget — never break the guard
  }
}

/** Clear block state from package_steps.meta when upstream progress is detected */
async function clearBlockState(
  sb: any,
  jobType: string,
  packageId: string,
): Promise<void> {
  const stepKey = jobType.replace(/^package_/, "");
  try {
    const { data: step } = await sb
      .from("package_steps")
      .select("id, meta")
      .eq("package_id", packageId)
      .eq("step_key", stepKey)
      .maybeSingle();

    if (step?.meta?.validation_requeue_blocked) {
      const currentMeta = { ...step.meta };
      delete currentMeta.validation_requeue_blocked;
      delete currentMeta.validation_requeue_reason;
      delete currentMeta.validation_requeue_signature;
      delete currentMeta.validation_requeue_blocked_at;
      delete currentMeta.validation_requeue_identical_fails;
      delete currentMeta.validation_requeue_cooldown_until;
      await sb.from("package_steps").update({ meta: currentMeta }).eq("id", step.id);
    }
  } catch (_e) {
    // fire-and-forget
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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
