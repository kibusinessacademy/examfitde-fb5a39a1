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
    // ── C3: Track-aware Skip — wenn Learning Content für diesen Track nicht anwendbar ist,
    // (scaffold_learning_course=skipped UND track_step_applicability.should_run=false),
    // dann ist ein Learning-Content-Preflight inhaltlich unsinnig → sauberer Pass-through.
    // Wichtig: Beide Bedingungen MÜSSEN erfüllt sein, damit ein versehentlich geskipter
    // Scaffold auf einem applicable-Track NICHT fälschlich alles durchwinkt.
    try {
      const { data: pkg } = await sb
        .from("course_packages")
        .select("track")
        .eq("id", ctx.packageId)
        .maybeSingle();
      const track = pkg?.track ?? null;

      if (track) {
        const { data: scaffoldStep } = await sb
          .from("package_steps")
          .select("status")
          .eq("package_id", ctx.packageId)
          .eq("step_key", "scaffold_learning_course")
          .maybeSingle();

        const { data: applicability } = await sb
          .from("track_step_applicability")
          .select("should_run")
          .eq("track", track)
          .eq("step_key", "generate_learning_content")
          .maybeSingle();

        const scaffoldSkipped = scaffoldStep?.status === "skipped";
        const notApplicable = applicability?.should_run === false;

        if (scaffoldSkipped && notApplicable) {
          // Sauberer Skip-/Pass-through: Track produziert keinen Lernkurs.
          // Kein Fail, kein Throw — markStepDone darf legitim weiterlaufen.
          return;
        }
      }
    } catch (_skipCheckErr) {
      // Bei Fehlern in der Skip-Prüfung: konservativ in den normalen Preflight fallen.
    }

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

  // ── quality_council: council MUST have actually executed and passed ──
  // Semantic gate: prevents external code paths from marking quality_council=done
  // without a real council run. We check the step's own meta (set by package-quality-council)
  // INSTEAD of course_packages.council_approved — this breaks the chicken/egg with
  // guard_council_consistency (which requires step=done before council_approved=true).
  // The DB trigger guard_council_consistency still prevents council_approved=true
  // without step=done, so the contract remains airtight.
  quality_council: async (sb, ctx) => {
    const { data: step } = await sb
      .from("package_steps")
      .select("meta")
      .eq("package_id", ctx.packageId)
      .eq("step_key", "quality_council")
      .maybeSingle();

    const meta = (step?.meta ?? {}) as Record<string, any>;
    const executed = meta.executed === true;
    const score = typeof meta.score === "number" ? meta.score : -1;
    const status = meta.status;

    if (!executed || status !== "pass" || score < 85) {
      throw preflightError("PREFLIGHT_QUALITY_COUNCIL", {
        reason: `council not passed — executed=${executed}, status=${status}, score=${score} (need executed=true, status=pass, score>=85)`,
        executed,
        status,
        score,
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
