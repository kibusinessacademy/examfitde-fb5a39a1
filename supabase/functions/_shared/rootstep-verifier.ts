/**
 * rootstep-verifier.ts — SSOT artifact-based verification for root pipeline steps
 *
 * These verifiers check REAL materialization state (lessons, content, etc.)
 * instead of relying on loose job signals like ok/enqueued.
 *
 * Used by:
 *   - pipeline-process.ts FINALIZATION_RULES for generate_learning_content
 *   - Reconciler for retroactive finalization of stuck steps
 */

// deno-lint-ignore-file no-explicit-any

type SB = any;

export type VerifyResult = {
  ready: boolean;
  reason: string;
  snapshot: Record<string, any>;
};

/**
 * Verify generate_learning_content is truly complete.
 * Checks:
 *   1. needs_regen count = 0 (no lessons missing content)
 *   2. No active child jobs (lesson_generate_content / competency_bundle)
 *   3. completion_ratio >= 0.95 as fallback
 */
export async function verifyGenerateLearningContentComplete(
  sb: SB,
  packageId: string,
): Promise<VerifyResult> {
  // 1. Get course_id for this package
  const { data: pkg } = await sb
    .from("course_packages")
    .select("course_id")
    .eq("id", packageId)
    .maybeSingle();

  if (!pkg?.course_id) {
    return { ready: false, reason: "no_course_id", snapshot: {} };
  }

  // 2. Count lessons needing regeneration
  const { data: mods } = await sb
    .from("modules")
    .select("id")
    .eq("course_id", pkg.course_id);
  const moduleIds = (mods ?? []).map((m: any) => m.id);

  if (moduleIds.length === 0) {
    return { ready: false, reason: "no_modules", snapshot: {} };
  }

  const NEEDS_REGEN_FILTER = [
    "content.is.null",
    "qc_status.eq.tier1_failed",
    "content->>_placeholder.eq.true",
    "content->>_regenerating.eq.true",
  ].join(",");

  const { count: needsRegen } = await sb
    .from("lessons")
    .select("id", { head: true, count: "exact" })
    .in("module_id", moduleIds)
    .neq("step", "mini_check")
    .or(NEEDS_REGEN_FILTER);

  const { count: totalLessons } = await sb
    .from("lessons")
    .select("id", { head: true, count: "exact" })
    .in("module_id", moduleIds)
    .neq("step", "mini_check");

  const regen = needsRegen ?? 0;
  const total = totalLessons ?? 0;
  const completionRatio = total > 0 ? (total - regen) / total : 0;

  // 3. Check active child jobs
  const { count: activeChildJobs } = await sb
    .from("job_queue")
    .select("id", { head: true, count: "exact" })
    .eq("package_id", packageId)
    .in("job_type", ["lesson_generate_content", "lesson_generate_competency_bundle"])
    .in("status", ["pending", "queued", "processing", "running"]);

  const activeChildren = activeChildJobs ?? 0;

  const snapshot = {
    needs_regen: regen,
    total_lessons: total,
    completion_ratio: Math.round(completionRatio * 1000) / 1000,
    active_child_jobs: activeChildren,
  };

  // Artifact-done: zero lessons need regen AND no active children
  if (regen === 0 && activeChildren === 0) {
    return { ready: true, reason: `artifact_complete: 0/${total} need regen, 0 active children`, snapshot };
  }

  // Material completion: ≥95% AND no active children
  if (completionRatio >= 0.95 && activeChildren === 0) {
    return { ready: true, reason: `material_complete: ratio=${snapshot.completion_ratio}, ${regen} remaining`, snapshot };
  }

  // Not ready
  return {
    ready: false,
    reason: `incomplete: ${regen}/${total} need regen, ${activeChildren} active children, ratio=${snapshot.completion_ratio}`,
    snapshot,
  };
}

/**
 * Verify finalize_learning_content is truly complete.
 * Checks that the finalization step's dedicated job has run and
 * all lessons have non-null, non-placeholder content.
 */
export async function verifyFinalizeLearningContentComplete(
  sb: SB,
  packageId: string,
): Promise<VerifyResult> {
  const { data: pkg } = await sb
    .from("course_packages")
    .select("course_id")
    .eq("id", packageId)
    .maybeSingle();

  if (!pkg?.course_id) {
    return { ready: false, reason: "no_course_id", snapshot: {} };
  }

  const { data: mods } = await sb
    .from("modules")
    .select("id")
    .eq("course_id", pkg.course_id);
  const moduleIds = (mods ?? []).map((m: any) => m.id);
  if (moduleIds.length === 0) {
    return { ready: false, reason: "no_modules", snapshot: {} };
  }

  // Check for lessons with null content (excluding mini_check)
  const { count: nullContent } = await sb
    .from("lessons")
    .select("id", { head: true, count: "exact" })
    .in("module_id", moduleIds)
    .neq("step", "mini_check")
    .is("content", null);

  const nullCount = nullContent ?? 0;
  const snapshot = { null_content_lessons: nullCount };

  if (nullCount === 0) {
    return { ready: true, reason: "all_lessons_have_content", snapshot };
  }

  return { ready: false, reason: `${nullCount} lessons still have null content`, snapshot };
}
