/**
 * F-4 / F-4.1 / F-4.2 / F-4.3: Stateful Validation Requeue Guard
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
 *   8. Artifact FK mapping corrected to use curriculum_id via course_packages (F-4.2)
 *   9. Meta updates use atomic DB-side JSONB merge RPC (F-4.2)
 *
 * F-4.3 (Zero-Deficit Guard Fix):
 *   10. STEP_ALREADY_DONE short-circuit: if step is already done, never block
 *   11. GATE_PASS_PROBE: for validators with gate functions, ask the gate BEFORE
 *       falling through to delta logic. If gate says PASS → allow. HARD_FAIL → block.
 *   12. Generic readiness probe for validators without dedicated gate functions
 *
 * Design principle:
 *   "The guard must never punish missing deltas when the validator's target
 *    state is already fulfilled or would pass on the next run."
 */

import { mergePackageStepMeta, removePackageStepMetaKeys } from "./merge-step-meta.ts";
import { stepKeyForJobType } from "./job-map.ts";

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

/**
 * Artifact tables for data-level progress detection.
 *
 * F-4.2 SCHEMA-VERIFIED mapping:
 *   - minicheck_questions: FK=curriculum_id, HAS updated_at
 *   - exam_questions:      FK=curriculum_id, NO updated_at → use created_at
 *   - handbook_chapters:   FK=curriculum_id, HAS updated_at
 *   - oral_exam_questions: FK=learning_field_id (NO package_id, NO curriculum_id) → not usable for artifact progress
 *   - package_content_shards: FK=package_id, HAS updated_at ✅ (direct)
 *   - question_blueprints: FK=curriculum_id, HAS status (SSOT for blueprints)
 *   - exam_blueprints:     FK=curriculum_id, NO status (NOT the SSOT for blueprint validation)
 *
 * Tables without package_id require resolving curriculum_id from course_packages first.
 */
interface ArtifactSource {
  table: string;
  /** The FK column on this table — either 'package_id' (direct) or 'curriculum_id' (indirect) */
  fk: "package_id" | "curriculum_id";
  /** Which timestamp column to check for changes */
  ts_col: "updated_at" | "created_at";
}

const ARTIFACT_PROGRESS_SOURCES: Record<string, ArtifactSource[]> = {
  package_validate_lesson_minichecks: [
    { table: "minicheck_questions", fk: "curriculum_id", ts_col: "updated_at" },
  ],
  package_validate_exam_pool: [
    { table: "exam_questions", fk: "curriculum_id", ts_col: "created_at" },
  ],
  package_validate_learning_content: [
    { table: "package_content_shards", fk: "package_id", ts_col: "updated_at" },
  ],
  package_validate_handbook: [
    { table: "handbook_chapters", fk: "curriculum_id", ts_col: "updated_at" },
  ],
  package_validate_handbook_depth: [
    { table: "handbook_chapters", fk: "curriculum_id", ts_col: "updated_at" },
  ],
  // oral_exam_questions has no usable FK or timestamp — rely on step-level progress only
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

// ─── F-4.3: Readiness Probe Results ───────────────────────────────────────

/**
 * Readiness verdicts (ordered by confidence):
 *   PASS_READY    → canonical gate/meta confirms pass → guard MUST allow
 *   LIKELY_READY  → heuristic evidence suggests pass → guard must NOT hard-block,
 *                   but normal requeue/cooldown still applies
 *   UNKNOWN       → no signal → fall through to delta logic
 *   STILL_BLOCKED → evidence says not ready yet → delta logic
 *   HARD_FAIL     → canonical gate says permanently broken → guard blocks
 */
type ReadinessVerdict = "PASS_READY" | "LIKELY_READY" | "STILL_BLOCKED" | "HARD_FAIL" | "UNKNOWN";

interface ReadinessProbeResult {
  verdict: ReadinessVerdict;
  reason?: string;
}

/**
 * Check whether a validation job should be blocked from re-enqueue.
 * Returns { blocked: false } for non-guarded job types.
 *
 * F-4.3: Now checks readiness BEFORE delta logic:
 *   Layer 0: Step already done → allow
 *   Layer 1: Gate probe (for validators with gate functions) → PASS=allow, HARD_FAIL=block
 *   Layer 2: Generic readiness probe → PASS_READY=allow
 *   Layer 3: Original delta/upstream logic (only if probe returns UNKNOWN/STILL_BLOCKED)
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
    const stepKey = stepKeyForJobType(jobType);
    if (!stepKey) {
      return { blocked: false };
    }

    // ═══ LAYER 0: Step already done → never block (F-4.3) ═══
    // If the step completed successfully (e.g., via manual heal, concurrent run),
    // blocking a requeue is nonsensical.
    const stepDone = await isStepAlreadyDone(sb, packageId, stepKey);
    if (stepDone) {
      console.log(`[val-guard] STEP_ALREADY_DONE: ${stepKey} for pkg ${packageId.slice(0, 8)} — skipping guard`);
      await clearBlockState(sb, jobType, packageId);
      return { blocked: false, reason: "STEP_ALREADY_DONE" };
    }

    // ═══ LAYER 1+2: Readiness Probe (F-4.3) ═══
    // Ask the validator's gate function (if available) or generic readiness check
    // BEFORE falling through to delta logic. This prevents the zero-deficit bug:
    // "Guard must never punish missing deltas when the target state is already met."
    const probe = await probeValidatorReadiness(sb, jobType, packageId);

    if (probe.verdict === "PASS_READY") {
      console.log(`[val-guard] READINESS_PASS: ${stepKey} for pkg ${packageId.slice(0, 8)} — ${probe.reason ?? "gate says PASS"}`);
      await clearBlockState(sb, jobType, packageId);
      return { blocked: false, reason: `READINESS_PASS: ${probe.reason}` };
    }

    if (probe.verdict === "LIKELY_READY") {
      // Heuristic evidence suggests pass — do NOT hard-block, but also don't
      // claim canonical PASS. Clear any existing block state so the validator
      // gets a chance to run and confirm.
      console.log(`[val-guard] LIKELY_READY: ${stepKey} for pkg ${packageId.slice(0, 8)} — ${probe.reason ?? "heuristic"}`);
      await clearBlockState(sb, jobType, packageId);
      return { blocked: false, reason: `LIKELY_READY: ${probe.reason}` };
    }

    if (probe.verdict === "HARD_FAIL") {
      const reason = `READINESS_HARD_FAIL: ${jobType} on pkg ${packageId.slice(0, 8)} — ${probe.reason}`;
      console.warn(`[val-guard] ${reason}`);
      await Promise.all([
        logValidationBlock(sb, jobType, packageId, reason, "HARD_FAIL", 0),
        persistBlockState(sb, jobType, packageId, reason, "HARD_FAIL", 0),
      ]);
      return { blocked: true, reason };
    }

    // STILL_BLOCKED or UNKNOWN → fall through to original delta logic

    // ═══ LAYER 3: Original delta/upstream logic ═══

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

// ─── F-4.3: Step Done Check ──────────────────────────────────────────────

async function isStepAlreadyDone(sb: any, packageId: string, stepKey: string): Promise<boolean> {
  try {
    const { data } = await sb
      .from("package_steps")
      .select("status")
      .eq("package_id", packageId)
      .eq("step_key", stepKey)
      .maybeSingle();
    return data?.status === "done";
  } catch {
    return false;
  }
}

// ─── F-4.3: Readiness Probe Architecture ─────────────────────────────────
//
// Probes the validator's actual readiness rather than relying solely on
// upstream deltas. This is the key fix for the zero-deficit bug class:
// if the validator would PASS, the guard must let it through.

/**
 * Probe whether a validator would pass on the next run.
 *
 * Strategy:
 *   1. For validators with dedicated gate functions → call the gate
 *   2. For validators without gates → use generic artifact-count heuristics
 *   3. If probe fails or is unavailable → return UNKNOWN (safe fallback)
 */
async function probeValidatorReadiness(
  sb: any,
  jobType: string,
  packageId: string,
): Promise<ReadinessProbeResult> {
  try {
    switch (jobType) {
      case "package_validate_exam_pool":
        return await probeExamPoolGate(sb, packageId);

      case "package_validate_learning_content":
        return await probeLearningContentReadiness(sb, packageId);

      case "package_validate_lesson_minichecks":
        return await probeMinicheckReadiness(sb, packageId);

      case "package_validate_handbook":
      case "package_validate_handbook_depth":
        return await probeHandbookReadiness(sb, packageId);

      case "package_validate_blueprints":
        return await probeBlueprintReadiness(sb, packageId);

      case "package_validate_blueprint_variants":
        return await probeBlueprintVariantReadiness(sb, packageId);

      case "package_validate_oral_exam":
        return await probeOralExamReadiness(sb, packageId);

      case "package_validate_tutor_index":
        return await probeTutorIndexReadiness(sb, packageId);

      default:
        return { verdict: "UNKNOWN" };
    }
  } catch (err) {
    console.warn(`[val-guard] Readiness probe failed for ${jobType}: ${(err as Error)?.message?.slice(0, 100)}`);
    return { verdict: "UNKNOWN" };
  }
}

// ── Exam Pool: Use the canonical gate function ──

async function probeExamPoolGate(sb: any, packageId: string): Promise<ReadinessProbeResult> {
  const { data, error } = await sb.rpc("fn_classify_exam_pool_gate", { p_package_id: packageId });
  if (error || !data) return { verdict: "UNKNOWN", reason: error?.message };

  const gateStatus = data.gate_status as string;
  if (gateStatus === "PASS") {
    return { verdict: "PASS_READY", reason: "fn_classify_exam_pool_gate → PASS" };
  }
  if (gateStatus === "HARD_FAIL") {
    return { verdict: "HARD_FAIL", reason: `fn_classify_exam_pool_gate → HARD_FAIL: ${data.reason_code}` };
  }
  // WAITING_FOR_MATERIALIZATION, REPAIRABLE → still blocked but not permanently
  return { verdict: "STILL_BLOCKED", reason: `gate_status=${gateStatus}` };
}

// ── Learning Content: check gate_class from step meta ──

async function probeLearningContentReadiness(sb: any, packageId: string): Promise<ReadinessProbeResult> {
  const { data } = await sb
    .from("package_steps")
    .select("meta")
    .eq("package_id", packageId)
    .eq("step_key", "validate_learning_content")
    .maybeSingle();

  if (!data?.meta) return { verdict: "UNKNOWN" };
  const meta = data.meta as Record<string, unknown>;
  const gateClass = meta.gate_class as string | undefined;

  if (gateClass === "healthy" || gateClass === "soft_pass_with_debt") {
    return { verdict: "PASS_READY", reason: `gate_class=${gateClass}` };
  }
  if (gateClass === "hard_fail") {
    return { verdict: "HARD_FAIL", reason: `gate_class=hard_fail` };
  }
  return { verdict: "UNKNOWN" };
}

// ── Minichecks: check if all lessons have minichecks ──

async function probeMinicheckReadiness(sb: any, packageId: string): Promise<ReadinessProbeResult> {
  const curriculumId = await getCurriculumIdForPackage(sb, packageId);
  if (!curriculumId) return { verdict: "UNKNOWN" };

  // SSOT governance: competencies has NO curriculum_id — must join via learning_fields.
  // 1) get all learning_field IDs for the curriculum
  // 2) get competency IDs whose learning_field_id IN (...)
  // 3) count lessons with competency_id IN (...)
  const { data: lfRows } = await sb
    .from("learning_fields")
    .select("id")
    .eq("curriculum_id", curriculumId);
  const lfIds = (lfRows ?? []).map((r: any) => r.id);

  let competencyIds: string[] = [];
  if (lfIds.length > 0) {
    const { data: compRows } = await sb
      .from("competencies")
      .select("id")
      .in("learning_field_id", lfIds);
    competencyIds = (compRows ?? []).map((r: any) => r.id);
  }

  const [{ count: questionCount }, { count: lessonCount }] = await Promise.all([
    sb.from("minicheck_questions").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId),
    competencyIds.length > 0
      ? sb.from("lessons").select("id", { count: "exact", head: true }).in("competency_id", competencyIds)
      : Promise.resolve({ count: 0 }),
  ]);

  if ((lessonCount ?? 0) === 0) return { verdict: "STILL_BLOCKED", reason: "no lessons" };
  if ((questionCount ?? 0) >= (lessonCount ?? 1)) {
    // Heuristic — real validator may check more dimensions
    return { verdict: "LIKELY_READY", reason: `${questionCount} minichecks for ${lessonCount} lessons` };
  }
  return { verdict: "STILL_BLOCKED", reason: `${questionCount}/${lessonCount} minichecks` };
}

// ── Handbook: check chapter count (HEURISTIC — not canonical) ──

async function probeHandbookReadiness(sb: any, packageId: string): Promise<ReadinessProbeResult> {
  const curriculumId = await getCurriculumIdForPackage(sb, packageId);
  if (!curriculumId) return { verdict: "UNKNOWN" };

  const { count } = await sb
    .from("handbook_chapters")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", curriculumId);

  if ((count ?? 0) > 0) {
    // Heuristic only — real validator checks depth, completeness, etc.
    return { verdict: "LIKELY_READY", reason: `${count} handbook chapters present` };
  }
  return { verdict: "STILL_BLOCKED", reason: "no handbook chapters" };
}

// ── Blueprints: check approved blueprint count (SSOT: question_blueprints) ──

async function probeBlueprintReadiness(sb: any, packageId: string): Promise<ReadinessProbeResult> {
  const curriculumId = await getCurriculumIdForPackage(sb, packageId);
  if (!curriculumId) return { verdict: "UNKNOWN" };

  const { count } = await sb
    .from("question_blueprints")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", curriculumId)
    .eq("status", "approved");

  if ((count ?? 0) >= 10) {
    // Heuristic — real validator checks distribution, LF coverage, etc.
    return { verdict: "LIKELY_READY", reason: `${count} approved blueprints (question_blueprints)` };
  }
  return { verdict: "STILL_BLOCKED", reason: `only ${count ?? 0} approved blueprints` };
}

// ── Blueprint Variants: check variant count relative to blueprints (SSOT: question_blueprints) ──

async function probeBlueprintVariantReadiness(sb: any, packageId: string): Promise<ReadinessProbeResult> {
  const curriculumId = await getCurriculumIdForPackage(sb, packageId);
  if (!curriculumId) return { verdict: "UNKNOWN" };

  const [{ count: variantCount }, { count: bpCount }] = await Promise.all([
    sb.from("exam_questions").select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .in("qc_status", ["approved", "review"]),
    sb.from("question_blueprints").select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .eq("status", "approved"),
  ]);

  if ((bpCount ?? 0) === 0) return { verdict: "STILL_BLOCKED", reason: "no blueprints" };
  if ((variantCount ?? 0) >= (bpCount ?? 1) * 2) {
    // Heuristic — real validator checks per-blueprint distribution
    return { verdict: "LIKELY_READY", reason: `${variantCount} variants for ${bpCount} blueprints` };
  }
  return { verdict: "STILL_BLOCKED", reason: `${variantCount} variants / ${bpCount} blueprints` };
}

// ── Oral Exam: check question count via learning_field_id (NO package_id on this table) ──

async function probeOralExamReadiness(sb: any, packageId: string): Promise<ReadinessProbeResult> {
  const curriculumId = await getCurriculumIdForPackage(sb, packageId);
  if (!curriculumId) return { verdict: "UNKNOWN" };

  // oral_exam_questions has learning_field_id, not package_id
  // Resolve LF IDs for this curriculum first
  const { data: lfs } = await sb
    .from("learning_fields")
    .select("id")
    .eq("curriculum_id", curriculumId);

  if (!lfs || lfs.length === 0) return { verdict: "UNKNOWN", reason: "no learning fields" };
  const lfIds = lfs.map((lf: any) => lf.id);

  const { count } = await sb
    .from("oral_exam_questions")
    .select("id", { count: "exact", head: true })
    .in("learning_field_id", lfIds);

  if ((count ?? 0) >= 5) {
    // Heuristic — real validator checks topic coverage, quality, etc.
    return { verdict: "LIKELY_READY", reason: `${count} oral exam questions across ${lfIds.length} LFs` };
  }
  return { verdict: "STILL_BLOCKED", reason: `only ${count ?? 0} oral exam questions` };
}

// ── Tutor Index: check if index exists (HEURISTIC) ──

async function probeTutorIndexReadiness(sb: any, packageId: string): Promise<ReadinessProbeResult> {
  const { count } = await sb
    .from("ai_tutor_context_index")
    .select("id", { count: "exact", head: true })
    .eq("package_id", packageId);

  if ((count ?? 0) > 0) {
    // Heuristic — real validator may check index freshness, version, etc.
    return { verdict: "LIKELY_READY", reason: "tutor index exists" };
  }
  return { verdict: "STILL_BLOCKED", reason: "no tutor index" };
}

// ─── Progress Detection (F-4.1 + F-4.2) ──────────────────────────────────

/**
 * Resolve curriculum_id for a package (needed for indirect FK lookups).
 * Cached per call — a package's curriculum_id doesn't change mid-request.
 */
async function getCurriculumIdForPackage(sb: any, packageId: string): Promise<string | null> {
  const { data } = await sb
    .from("course_packages")
    .select("curriculum_id")
    .eq("id", packageId)
    .maybeSingle();
  return data?.curriculum_id ?? null;
}

/**
 * Check for upstream progress via both step-level and artifact-level signals.
 * F-4.2: Uses correct FK chains (curriculum_id via course_packages).
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

  // B) Artifact-level: relevant data rows changed after the last fail
  const artifactSources = ARTIFACT_PROGRESS_SOURCES[jobType];
  if (!artifactSources || artifactSources.length === 0) return false;

  // Resolve curriculum_id if any source needs it
  let curriculumId: string | null = null;
  const needsCurriculum = artifactSources.some((s) => s.fk === "curriculum_id");
  if (needsCurriculum) {
    curriculumId = await getCurriculumIdForPackage(sb, packageId);
    if (!curriculumId) {
      // Cannot resolve — skip artifact check gracefully
      console.warn(`[val-guard] No curriculum_id found for pkg ${packageId.slice(0, 8)}, skipping artifact progress check`);
      return false;
    }
  }

  for (const src of artifactSources) {
    try {
      const fkValue = src.fk === "package_id" ? packageId : curriculumId!;
      const { data: recentArtifact } = await sb
        .from(src.table)
        .select(src.ts_col)
        .eq(src.fk, fkValue)
        .gt(src.ts_col, lastFailAt.toISOString())
        .order(src.ts_col, { ascending: false })
        .limit(1);

      if (recentArtifact && recentArtifact.length > 0) {
        console.log(`[val-guard] Artifact progress detected in ${src.table} (via ${src.fk}) for pkg ${packageId.slice(0, 8)}`);
        return true;
      }
    } catch (_e) {
      // Table might not exist or column mismatch — skip gracefully
      console.warn(`[val-guard] Artifact check failed for ${src.table}: ${_e}`);
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

// ─── Block State Persistence (F-4.1 + F-4.2 atomic) ──────────────────────

const BLOCK_META_KEYS = [
  "validation_requeue_blocked",
  "validation_requeue_reason",
  "validation_requeue_signature",
  "validation_requeue_blocked_at",
  "validation_requeue_identical_fails",
  "validation_requeue_cooldown_until",
];

/** Persist block state atomically via DB-side JSONB merge RPC (F-4.2) */
async function persistBlockState(
  sb: any,
  jobType: string,
  packageId: string,
  reason: string,
  gateSignature: string,
  identicalCount: number,
  cooldownUntil?: string,
): Promise<void> {
  const stepKey = stepKeyForJobType(jobType);
  if (!stepKey) return;
  try {
    await mergePackageStepMeta(sb, packageId, stepKey, {
      validation_requeue_blocked: true,
      validation_requeue_reason: reason.slice(0, 500),
      validation_requeue_signature: gateSignature,
      validation_requeue_blocked_at: new Date().toISOString(),
      validation_requeue_identical_fails: identicalCount,
      validation_requeue_cooldown_until: cooldownUntil || null,
    });
  } catch (_e) {
    // fire-and-forget — never break the guard
  }
}

/** Clear block state atomically via DB-side key removal RPC (F-4.2) */
async function clearBlockState(
  sb: any,
  jobType: string,
  packageId: string,
): Promise<void> {
  const stepKey = stepKeyForJobType(jobType);
  if (!stepKey) return;
  try {
    await removePackageStepMetaKeys(sb, packageId, stepKey, BLOCK_META_KEYS);
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
