// supabase/functions/_shared/preflight-registry.ts
// Central Pre-Flight Assertion Registry for markStepDone
// Runs step-specific contract checks BEFORE the DB update, catching mismatches
// early and preventing trigger-induced zombie loops.

type SB = any;

interface PreflightContext {
  packageId: string;
  stepKey: string;
  meta?: Record<string, any>;
}

type PreflightFn = (sb: SB, ctx: PreflightContext) => Promise<void>;

/**
 * Registry of step-specific preflight assertions.
 * Each entry runs BEFORE markStepDone writes status='done'.
 * Throw on failure — the error propagates to markStepFailed.
 */
const PREFLIGHT_REGISTRY: Record<string, PreflightFn> = {

  // ── generate_learning_content: SSOT artifact-truth gate (HOLLOW_LEARNING_CONTENT) ──
  // Mirrors artifact-verifier rules to block premature markStepDone before DB trigger sync.
  generate_learning_content: async (sb, ctx) => {
    const { data, error } = await sb.rpc("package_lessons_realness", { p_package_id: ctx.packageId });
    if (error) {
      throw preflightError("PREFLIGHT_LEARNING_CONTENT", {
        reason: `RPC_ERROR: ${error.message ?? String(error)}`,
      });
    }

    const total = Number(data?.lessons_total ?? 0);
    const real = Number(data?.real_content ?? 0);
    const placeholders = Number(data?.placeholders ?? 0);
    const avgLen = Number(data?.avg_len ?? 0);

    if (total === 0) {
      throw preflightError("PREFLIGHT_LEARNING_CONTENT", {
        reason: "no lessons exist for package — cannot mark generate_learning_content done",
        total,
      });
    }

    if (placeholders > 0) {
      throw preflightError("PREFLIGHT_PLACEHOLDER_LESSONS_PRESENT", {
        reason: `${placeholders}/${total} lessons are placeholder shells`,
        placeholders,
        total,
      });
    }

    const substantiveRatio = real / total;
    if (substantiveRatio < 0.90) {
      throw preflightError("PREFLIGHT_LESSON_SUBSTANCE_BELOW_THRESHOLD", {
        reason: `substantive_ratio ${substantiveRatio.toFixed(3)} < 0.90 (${real}/${total})`,
        real,
        total,
        substantive_ratio: substantiveRatio,
        threshold: 0.90,
      });
    }

    // Pending lesson_generate_content jobs would invalidate any "done" claim
    const { count: pendingJobs } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("package_id", ctx.packageId)
      .eq("job_type", "lesson_generate_content")
      .in("status", ["pending", "enqueued", "processing"]);

    if ((pendingJobs ?? 0) > 0) {
      throw preflightError("PREFLIGHT_LESSON_GENERATION_INCOMPLETE", {
        reason: `${pendingJobs} lesson_generate_content jobs still active`,
        pending_jobs: pendingJobs,
      });
    }

    if (avgLen < 600) {
      throw preflightError("PREFLIGHT_LEARNING_CONTENT_AVG_LEN", {
        reason: `avg_len ${avgLen} < 600`,
        avg_len: avgLen,
      });
    }
  },

  // ── quality_council: council_approved must be true before done ──
  quality_council: async (sb, ctx) => {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("council_approved")
      .eq("id", ctx.packageId)
      .maybeSingle();

    if (!pkg?.council_approved) {
      throw preflightError("PREFLIGHT_QUALITY_COUNCIL", {
        reason: "council_approved is not true — cannot mark quality_council done",
        council_approved: pkg?.council_approved ?? null,
      });
    }
  },

  // ── generate_oral_exam: 100% competency coverage required by DB trigger ──
  generate_oral_exam: async (sb, ctx) => {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", ctx.packageId)
      .maybeSingle();
    if (!pkg?.curriculum_id) {
      throw preflightError("PREFLIGHT_ORAL_EXAM", { reason: "no curriculum_id" });
    }

    // Count total competencies
    const { data: lfs } = await sb
      .from("learning_fields")
      .select("id")
      .eq("curriculum_id", pkg.curriculum_id);
    const lfIds = (lfs ?? []).map((l: any) => l.id);
    if (lfIds.length === 0) return; // no LFs = nothing to check

    const { count: totalComps } = await sb
      .from("competencies")
      .select("id", { count: "exact", head: true })
      .in("learning_field_id", lfIds);

    // Count covered competencies via blueprints
    const { data: blueprints } = await sb
      .from("oral_exam_blueprints")
      .select("competency_id")
      .eq("curriculum_id", pkg.curriculum_id);
    const coveredSet = new Set((blueprints ?? []).map((b: any) => b.competency_id));

    if (coveredSet.size < (totalComps ?? 0)) {
      throw preflightError("PREFLIGHT_ORAL_EXAM_COVERAGE", {
        reason: `Only ${coveredSet.size}/${totalComps} competencies covered by oral exam blueprints`,
        covered: coveredSet.size,
        total: totalComps ?? 0,
      });
    }
  },

  // ── validate_handbook: chapters must exist with sections ──
  validate_handbook: async (sb, ctx) => {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", ctx.packageId)
      .maybeSingle();
    if (!pkg?.curriculum_id) {
      throw preflightError("PREFLIGHT_VALIDATE_HANDBOOK", { reason: "no curriculum_id" });
    }

    const { count: chapterCount } = await sb
      .from("handbook_chapters")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id);

    if ((chapterCount ?? 0) === 0) {
      throw preflightError("PREFLIGHT_VALIDATE_HANDBOOK", {
        reason: "No handbook chapters exist — validate_handbook cannot succeed",
        chapters: 0,
      });
    }
  },

  // ── generate_exam_pool: minimum question threshold before DB trigger ──
  generate_exam_pool: async (sb, ctx) => {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", ctx.packageId)
      .maybeSingle();
    if (!pkg?.curriculum_id) {
      throw preflightError("PREFLIGHT_EXAM_POOL", { reason: "no curriculum_id" });
    }

    const { count } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id)
      .neq("status", "rejected");

    const MIN_QUESTIONS = 50;
    if ((count ?? 0) < MIN_QUESTIONS) {
      throw preflightError("PREFLIGHT_EXAM_POOL", {
        reason: `Only ${count ?? 0} non-rejected questions — DB trigger requires ≥${MIN_QUESTIONS}`,
        count: count ?? 0,
        min_required: MIN_QUESTIONS,
      });
    }
  },
};

/**
 * Run preflight assertions for a step (if registered).
 * Called by markStepDone BEFORE post-conditions and the DB update.
 */
export async function runPreflightAssertions(sb: SB, ctx: PreflightContext): Promise<void> {
  const fn = PREFLIGHT_REGISTRY[ctx.stepKey];
  if (!fn) return; // no preflight registered — pass through

  try {
    await fn(sb, ctx);
  } catch (err: any) {
    // Tag the error so markStepFailed can distinguish preflight from post-condition
    if (!err.__meta) err.__meta = {};
    err.__meta.preflight = true;
    err.__meta.step_key = ctx.stepKey;
    throw err;
  }
}

function preflightError(verdict: string, meta: Record<string, unknown>): Error {
  const e: any = new Error(`${verdict}: preflight assertion failed`);
  e.__meta = { verdict, preflight: true, ...meta };
  return e;
}
