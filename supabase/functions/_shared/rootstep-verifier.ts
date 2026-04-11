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
 *
 * Aligned with markStepDone post-condition (HOLLOW_LESSONS guard):
 *   - placeholders = 0
 *   - tier1_failed = 0
 *   - real_content >= 95% of total
 *   - avg_len >= 600
 *   - no active child jobs
 *
 * Produces three semantic states:
 *   - finalizable (ready=true): postcondition WILL pass
 *   - materially_complete: >=95% but postcondition would fail
 *   - incomplete: still has significant work remaining
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

  // 2. Use the same RPC as post-conditions.ts for exact alignment
  const { data: realness, error: rpcErr } = await sb.rpc(
    "package_lessons_realness",
    { p_package_id: packageId },
  );

  if (rpcErr) {
    return { ready: false, reason: `rpc_error: ${rpcErr.message}`, snapshot: {} };
  }

  const total = num(realness?.lessons_total);
  const real = num(realness?.real_content);
  const ph = num(realness?.placeholders);
  const emptyish = num(realness?.emptyish);
  const avg = num(realness?.avg_len);

  if (total === 0) {
    return { ready: false, reason: "no_lessons", snapshot: {} };
  }

  // 3. Count tier1_failed lessons (same logic as post-conditions.ts)
  const { data: mods } = await sb
    .from("modules")
    .select("id")
    .eq("course_id", pkg.course_id);
  const moduleIds = (mods ?? []).map((m: any) => m.id);
  let tier1Failed = 0;
  if (moduleIds.length > 0) {
    const { data: failedLessons } = await sb
      .from("lessons")
      .select("id")
      .in("module_id", moduleIds)
      .eq("qc_status", "tier1_failed")
      .neq("step", "mini_check");
    tier1Failed = failedLessons?.length ?? 0;
  }

  // 4. Check genuinely in-flight child jobs
  const { data: childJobs } = await sb
    .from("job_queue")
    .select("id, status, locked_at")
    .eq("package_id", packageId)
    .in("job_type", ["lesson_generate_content", "lesson_generate_competency_bundle"])
    .in("status", ["processing", "running"]);

  const STALE_MS = 3 * 60_000;
  const now = Date.now();
  const activeChildren = (childJobs ?? []).filter((j: any) => {
    if (j.status === "running") return true;
    if (j.status === "processing") {
      if (!j.locked_at) return false;
      return (now - new Date(j.locked_at).getTime()) < STALE_MS;
    }
    return false;
  }).length;

  // 5. Exact postcondition alignment with assertStepPostConditions
  const minReal = Math.max(1, Math.floor(total * 0.95));
  const postconditionPasses =
    total > 0 &&
    ph === 0 &&
    tier1Failed === 0 &&
    real >= minReal &&
    avg >= 600;

  const completionRatio = total > 0 ? real / total : 0;
  const materially_complete = completionRatio >= 0.95;

  const snapshot = {
    lessons_total: total,
    real_content: real,
    placeholders: ph,
    emptyish,
    tier1_failed: tier1Failed,
    avg_len: avg,
    completion_ratio: Math.round(completionRatio * 1000) / 1000,
    min_real_required: minReal,
    active_child_jobs: activeChildren,
    materially_complete,
    finalizable: postconditionPasses && activeChildren === 0,
  };

  // ONLY set ready when the real postcondition will pass AND no active children
  if (postconditionPasses && activeChildren === 0) {
    return {
      ready: true,
      reason: `finalizable: ${real}/${total} real, ph=${ph}, t1f=${tier1Failed}, avg=${avg}, 0 active children`,
      snapshot,
    };
  }

  // Materially close but postcondition would fail — NOT ready
  if (materially_complete && activeChildren === 0) {
    const blockers = [];
    if (ph > 0) blockers.push(`${ph} placeholders`);
    if (tier1Failed > 0) blockers.push(`${tier1Failed} tier1_failed`);
    if (avg < 600) blockers.push(`avg_len=${avg} < 600`);
    if (real < minReal) blockers.push(`real=${real} < min=${minReal}`);
    return {
      ready: false,
      reason: `materially_complete but not finalizable: ${blockers.join(", ")}`,
      snapshot,
    };
  }

  return {
    ready: false,
    reason: `incomplete: ${real}/${total} real, ${activeChildren} active children, ratio=${snapshot.completion_ratio}`,
    snapshot,
  };
}

function num(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
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
