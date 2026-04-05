// supabase/functions/_shared/post-conditions.ts
// SSOT Post-Condition Guards: prevents "done" status on hollow content
import { isRealHandbookSection, HANDBOOK_THRESHOLDS } from "./handbook-write-guard.ts";
import { assertExtendedPostConditions } from "./post-conditions-extended.ts";
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

  // ── Delegate to extended guards for steps not handled here ──
  const handled = await assertExtendedPostConditions(sb, { packageId, stepKey });
  if (handled) return;

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
    // IMPORTANT: Exclude step='mini_check' — those have their own pipeline step
    // (generate_lesson_minichecks / validate_lesson_minichecks)
    const { data: pkg } = await sb
      .from("course_packages")
      .select("course_id")
      .eq("id", packageId)
      .single();
    let tier1Failed = 0;
    if (pkg?.course_id) {
      const { data: failedLessons } = await sb
        .from("lessons")
        .select("id, step, modules!inner(course_id)")
        .eq("modules.course_id", pkg.course_id)
        .eq("qc_status", "tier1_failed")
        .neq("step", "mini_check");
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

  // ── generate_handbook: must have real section content (via curriculum_id → handbook_chapters → handbook_sections) ──
  // v16: Phase-aware thresholds — basis pass accepts 800-char sections.
  //       Post-condition must align with write-guard to prevent infinite loop.
  if (stepKey === "generate_handbook") {
    // Resolve curriculum_id from package (handbook_chapters uses curriculum_id)
    const { data: pkg, error: pErr } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", packageId)
      .single();
    if (pErr) throw pErr;

    const curriculumId = pkg?.curriculum_id;
    if (!curriculumId) throw new Error("HOLLOW_HANDBOOK: no curriculum_id on package");

    // Get chapters for this curriculum
    const { data: chapters, error: chErr } = await sb
      .from("handbook_chapters")
      .select("id")
      .eq("curriculum_id", curriculumId);
    if (chErr) throw chErr;

    const chapterIds = (chapters ?? []).map((c: any) => c.id);
    const totalChapters = chapterIds.length;

    if (totalChapters === 0) {
      const e: any = new Error("HOLLOW_HANDBOOK: post-condition failed");
      e.__meta = { verdict: "HOLLOW_HANDBOOK", chapters_total: 0, sections_total: 0, sections_real: 0 };
      throw e;
    }

    // Get sections with real content (content_markdown is the SSOT field)
    const { data: sections, error: sErr } = await sb
      .from("handbook_sections")
      .select("id, content_markdown, chapter_id, content_tier")
      .in("chapter_id", chapterIds);
    if (sErr) throw sErr;

    const totalSections = sections?.length ?? 0;

    // v18: Use SSOT isRealHandbookSection for phase-aware validation
    // Prevents threshold drift between layers
    const realSections = (sections ?? []).filter((s: any) =>
      isRealHandbookSection(s)
    ).length;

    // v16: Require 90% of sections to be real (100% was too strict for basis pass)
    const MIN_REAL_RATIO = 0.9;
    const minRealNeeded = Math.max(1, Math.ceil(totalSections * MIN_REAL_RATIO));

    if (totalSections === 0 || realSections < minRealNeeded) {
      const e: any = new Error("HOLLOW_HANDBOOK: post-condition failed");
      e.__meta = {
        verdict: "HOLLOW_HANDBOOK",
        chapters_total: totalChapters,
        sections_total: totalSections,
        sections_real: realSections,
        min_real_needed: minRealNeeded,
        threshold_basis: HANDBOOK_THRESHOLDS.basis.minChars,
        threshold_expanded: HANDBOOK_THRESHOLDS.expanded.minChars,
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
    const { data: pkg, error: pkgErr } = await sb.from("course_packages").select("curriculum_id, meta").eq("id", packageId).single();
    if (pkgErr) {
      console.error(`[post-conditions] generate_exam_pool pkg lookup error for ${packageId}:`, JSON.stringify(pkgErr));
    }
    if (!pkg?.curriculum_id) throw new Error(`HOLLOW_EXAM_POOL: no curriculum_id on package (pkgErr=${pkgErr?.message ?? 'none'}, pkg=${JSON.stringify(pkg)})`);

    const { count, error } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id)
      .neq("status", "rejected")
      .not("qc_status", "in", "(tier1_failed,rejected)");
    if (error) throw error;

    // Dynamic threshold: use exam_target from package meta, floor at MIN_QUESTIONS_PER_PACKAGE * 0.1
    const pkgMeta = (pkg.meta ?? {}) as Record<string, unknown>;
    const examTarget = num(pkgMeta.exam_target) || 1000;
    // Require at least 5% of target as absolute minimum (prevents hollow with 10 questions)
    // Hard floor: 50 (MIN_QUESTIONS_PER_PACKAGE=500, so 5% = 25 → floor at 50)
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
