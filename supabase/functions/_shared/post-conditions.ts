// supabase/functions/_shared/post-conditions.ts
// SSOT Post-Condition Guards: prevents "done" status on hollow content
type SB = any;

function num(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export async function assertStepPostConditions(sb: SB, args: {
  packageId: string;
  stepKey: string;
  expectedLessons?: number | null;
  track?: string | null;
}) {
  const { packageId, stepKey } = args;

  // ── generate_learning_content: lessons must be real, not placeholder shells ──
  // SSOT: "done" requires artifact-based validation, NOT job-based
  if (stepKey === "generate_learning_content") {
    const { data, error } = await sb.rpc("package_lessons_realness", { p_package_id: packageId });
    if (error) {
      console.error(`[post-conditions] RPC package_lessons_realness error for ${packageId}:`, JSON.stringify(error));
      throw new Error(`RPC_ERROR: ${error.message ?? JSON.stringify(error)}`);
    }

    console.log(`[post-conditions] realness for ${packageId.slice(0,8)}:`, JSON.stringify(data));

    const total = num(data?.lessons_total);
    const real  = num(data?.real_content);
    const ph    = num(data?.placeholders);
    const avg   = num(data?.avg_len);

    // ── Additional artifact guard: count tier1_failed lessons (needs_regen) ──
    // Even if realness RPC says "all real", tier1_failed means QC rejected the content
    const { data: pkg } = await sb
      .from("course_packages")
      .select("course_id")
      .eq("id", packageId)
      .single();
    let tier1Failed = 0;
    if (pkg?.course_id) {
      const { data: failedLessons } = await sb
        .from("lessons")
        .select("id, modules!inner(course_id)")
        .eq("modules.course_id", pkg.course_id)
        .eq("qc_status", "tier1_failed");
      tier1Failed = failedLessons?.length ?? 0;
    }

    const expected = num(args.expectedLessons ?? total);
    const minReal = expected > 0 ? Math.max(1, Math.floor(expected * 0.95)) : 1;

    const ok =
      total > 0 &&
      ph === 0 &&
      tier1Failed === 0 &&
      real >= minReal &&
      avg >= 600;

    if (!ok) {
      const e: any = new Error("HOLLOW_LESSONS: post-condition failed");
      e.__meta = {
        verdict: ph > 0 || tier1Failed > 0 ? "HOLLOW_LESSONS" : "HOLLOW_LESSONS_SHORT",
        lessons_total: total,
        expected_lessons: expected,
        real_content: real,
        placeholders: ph,
        tier1_failed: tier1Failed,
        avg_len: avg,
        min_real_required: minReal,
        // Progress fingerprint — enables progress-aware retry logic
        fp_placeholders: ph + tier1Failed,
        fp_real: real,
        fp_avg_len: avg,
      };
      throw e;
    }
  }

  // ── generate_handbook: must have real chapter content (via course_id lookup) ──
  if (stepKey === "generate_handbook") {
    // Resolve course_id from package (handbook_chapters uses course_id, not package_id)
    const { data: pkg, error: pErr } = await sb
      .from("course_packages")
      .select("course_id")
      .eq("id", packageId)
      .single();
    if (pErr) throw pErr;

    const courseId = pkg?.course_id;
    const { data, error } = await sb
      .from("handbook_chapters")
      .select("id, content", { count: "exact" })
      .eq("course_id", courseId);
    if (error) throw error;

    const total = data?.length ?? 0;
    const realChapters = (data ?? []).filter(
      (ch: any) => typeof ch.content === "string" && ch.content.length > 500
    ).length;

    if (total === 0 || realChapters < Math.max(1, Math.floor(total * 0.9))) {
      const e: any = new Error("HOLLOW_HANDBOOK: post-condition failed");
      e.__meta = {
        verdict: "HOLLOW_HANDBOOK",
        chapters_total: total,
        chapters_real: realChapters,
      };
      throw e;
    }
  }

  // ── auto_seed_exam_blueprints: must have blueprints for curriculum ──
  if (stepKey === "auto_seed_exam_blueprints") {
    const { data: pkg } = await sb.from("course_packages").select("curriculum_id").eq("id", packageId).single();
    if (!pkg?.curriculum_id) throw new Error("HOLLOW_BLUEPRINTS: no curriculum_id on package");
    // Check question_blueprints table (SSOT for blueprints)
    const { count, error } = await sb
      .from("question_blueprints")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id);
    if (error) throw error;

    if ((count ?? 0) < 1) {
      const e: any = new Error("HOLLOW_BLUEPRINTS: post-condition failed");
      e.__meta = {
        verdict: "HOLLOW_BLUEPRINTS",
        blueprint_count: count ?? 0,
      };
      throw e;
    }
  }

  // ── generate_exam_pool: must have meaningful question count ──
  if (stepKey === "generate_exam_pool") {
    const { data: pkg } = await sb.from("course_packages").select("curriculum_id, meta").eq("id", packageId).single();
    if (!pkg?.curriculum_id) throw new Error("HOLLOW_EXAM_POOL: no curriculum_id on package");

    const { count, error } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id);
    if (error) throw error;

    // Dynamic threshold: use exam_target from package meta, floor at 50
    const pkgMeta = (pkg.meta ?? {}) as Record<string, unknown>;
    const examTarget = num(pkgMeta.exam_target) || 1000;
    // Require at least 5% of target as absolute minimum (prevents hollow with 10 questions)
    const minRequired = Math.max(50, Math.floor(examTarget * 0.05));
    const actual = count ?? 0;

    if (actual < minRequired) {
      const e: any = new Error("HOLLOW_EXAM_POOL: post-condition failed");
      e.__meta = {
        verdict: "HOLLOW_EXAM_POOL",
        exam_questions_count: actual,
        min_required: minRequired,
        exam_target: examTarget,
      };
      throw e;
    }
  }

  // ── build_ai_tutor_index: must have index rows ──
  if (stepKey === "build_ai_tutor_index") {
    const { count, error } = await sb
      .from("ai_tutor_context_index")
      .select("id", { count: "exact", head: true })
      .eq("package_id", packageId);
    if (error) throw error;

    if ((count ?? 0) < 1) {
      const e: any = new Error("HOLLOW_TUTOR_INDEX: post-condition failed");
      e.__meta = {
        verdict: "HOLLOW_TUTOR_INDEX",
        index_rows: count ?? 0,
      };
      throw e;
    }
  }
}
