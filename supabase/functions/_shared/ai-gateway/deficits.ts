/**
 * ai-gateway/deficits.ts — Deficit-based generation guard.
 *
 * Prevents unnecessary LLM calls by checking if the target artifact
 * already meets its required quantity/quality thresholds.
 */

import type { DeficitResult } from "./types.ts";

/**
 * Compute whether generation is actually needed for a given job type.
 */
export async function computeDeficit(
  sb: any,
  jobType: string,
  ctx: {
    packageId?: string;
    courseId?: string;
    lessonId?: string;
    blueprintId?: string;
    stepKey?: string;
    curriculumId?: string;
  },
): Promise<DeficitResult> {
  switch (jobType) {
    case "lesson_generate_content":
      return computeLessonDeficit(sb, ctx);
    case "package_generate_exam_pool":
      return computeExamPoolDeficit(sb, ctx);
    case "expand_handbook_section":
      return computeHandbookDeficit(sb, ctx);
    default:
      // Unknown job types → allow generation (no deficit rule yet)
      return { shouldGenerate: true, artifact: jobType, reason: "no_deficit_rule" };
  }
}

// ── Lesson Content Deficit ──────────────────────────────────────────────────

async function computeLessonDeficit(
  sb: any,
  ctx: { lessonId?: string; stepKey?: string },
): Promise<DeficitResult> {
  if (!ctx.lessonId) {
    return { shouldGenerate: true, artifact: "lesson_content", reason: "no_lesson_id" };
  }

  // Check if approved content_version already exists for this lesson+step
  const { count, error } = await sb
    .from("content_versions")
    .select("id", { count: "exact", head: true })
    .eq("lesson_id", ctx.lessonId)
    .eq("step_key", ctx.stepKey || "step_1_intro")
    .eq("status", "approved")
    .limit(1);

  if (error) {
    return { shouldGenerate: true, artifact: "lesson_content", reason: "deficit_check_error" };
  }

  if ((count ?? 0) > 0) {
    return {
      shouldGenerate: false,
      artifact: "lesson_content",
      reason: "approved_content_exists",
      actualCount: count ?? 0,
      targetCount: 1,
      missingCount: 0,
    };
  }

  return {
    shouldGenerate: true,
    artifact: "lesson_content",
    reason: "no_approved_content",
    actualCount: 0,
    targetCount: 1,
    missingCount: 1,
  };
}

// ── Exam Pool Deficit ───────────────────────────────────────────────────────

async function computeExamPoolDeficit(
  sb: any,
  ctx: { packageId?: string; curriculumId?: string; blueprintId?: string },
): Promise<DeficitResult> {
  if (!ctx.curriculumId && !ctx.packageId) {
    return { shouldGenerate: true, artifact: "exam_pool", reason: "no_curriculum_or_package" };
  }

  // Get curriculum_id from package if not provided
  let curriculumId = ctx.curriculumId;
  if (!curriculumId && ctx.packageId) {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", ctx.packageId)
      .maybeSingle();
    curriculumId = pkg?.curriculum_id;
  }

  if (!curriculumId) {
    return { shouldGenerate: true, artifact: "exam_pool", reason: "curriculum_not_resolved" };
  }

  // Count approved questions for this curriculum
  const { count: approvedCount } = await sb
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", curriculumId)
    .in("status", ["approved", "tier1_passed"]); // SSOT: QC_COVERAGE_ELIGIBLE

  const actual = approvedCount ?? 0;

  // Get target from blueprint_targets or use default
  const { data: targets } = await sb
    .from("blueprint_targets")
    .select("target_count")
    .eq("curriculum_id", curriculumId)
    .limit(1);

  // Default target: 500 questions per curriculum
  const target = targets?.[0]?.target_count ?? 500;

  if (actual >= target) {
    return {
      shouldGenerate: false,
      artifact: "exam_pool",
      reason: "target_reached",
      targetCount: target,
      actualCount: actual,
      missingCount: 0,
    };
  }

  return {
    shouldGenerate: true,
    artifact: "exam_pool",
    reason: "below_target",
    targetCount: target,
    actualCount: actual,
    missingCount: target - actual,
  };
}

// ── Handbook Deficit ────────────────────────────────────────────────────────

async function computeHandbookDeficit(
  sb: any,
  ctx: { packageId?: string },
): Promise<DeficitResult> {
  if (!ctx.packageId) {
    return { shouldGenerate: true, artifact: "handbook", reason: "no_package_id" };
  }

  // Check if handbook sections exist
  const { count } = await sb
    .from("handbook_sections")
    .select("id", { count: "exact", head: true })
    .eq("package_id", ctx.packageId)
    .not("content", "is", null);

  const actual = count ?? 0;

  if (actual >= 5) {
    return {
      shouldGenerate: false,
      artifact: "handbook",
      reason: "sufficient_sections",
      targetCount: 5,
      actualCount: actual,
      missingCount: 0,
    };
  }

  return {
    shouldGenerate: true,
    artifact: "handbook",
    reason: "insufficient_sections",
    targetCount: 5,
    actualCount: actual,
    missingCount: 5 - actual,
  };
}
