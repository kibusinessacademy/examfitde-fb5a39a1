// supabase/functions/_shared/post-conditions-extended.ts
// Extended Hollow-Completion Guards for steps NOT covered in post-conditions.ts
// v2: All thresholds imported from artifact-thresholds.ts (central SSOT)

import {
  resolveThreshold,
  formatThresholdFail,
} from "./artifact-thresholds.ts";

type SB = any;

function num(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Checks post-conditions for extended pipeline steps.
 * Returns true if the step was handled, false if not (caller should fall through).
 */
export async function assertExtendedPostConditions(sb: SB, args: {
  packageId: string;
  stepKey: string;
}): Promise<boolean> {
  const { packageId, stepKey } = args;

  // ── scaffold_learning_course ──
  if (stepKey === "scaffold_learning_course") {
    const { data: pkg } = await sb
      .from("course_packages").select("course_id, curriculum_id").eq("id", packageId).single();
    if (!pkg?.course_id) throw hollowError("HOLLOW_SCAFFOLD", { reason: "no course_id on package" });

    const { data: modules } = await sb.from("modules").select("id").eq("course_id", pkg.course_id);
    const moduleCount = modules?.length ?? 0;

    // Proportional: modules ≥ learning_fields
    let lfCount = 1;
    if (pkg.curriculum_id) {
      const { count } = await sb
        .from("learning_fields").select("id", { count: "exact", head: true })
        .eq("curriculum_id", pkg.curriculum_id);
      lfCount = count ?? 1;
    }
    const minModules = resolveThreshold("scaffold_learning_course", "modules", { learningFieldCount: lfCount });

    if (moduleCount < minModules) {
      throw hollowError("HOLLOW_SCAFFOLD", {
        modules: moduleCount,
        threshold: minModules,
        reason: formatThresholdFail("scaffold_learning_course", "modules", moduleCount, minModules),
      });
    }

    const moduleIds = modules.map((m: any) => m.id);
    const { count: lessonCount } = await sb
      .from("lessons").select("id", { count: "exact", head: true }).in("module_id", moduleIds);

    // Proportional: lessons ≥ competencies
    let compCount = 5;
    if (pkg.curriculum_id) {
      const { data: lfs } = await sb
        .from("learning_fields").select("id").eq("curriculum_id", pkg.curriculum_id);
      if (lfs?.length) {
        const { count } = await sb
          .from("competencies").select("id", { count: "exact", head: true })
          .in("learning_field_id", lfs.map((l: any) => l.id));
        compCount = count ?? 5;
      }
    }
    const minLessons = resolveThreshold("scaffold_learning_course", "lessons", { competencyCount: compCount });

    if ((lessonCount ?? 0) < minLessons) {
      throw hollowError("HOLLOW_SCAFFOLD", {
        modules: moduleCount,
        lessons: lessonCount ?? 0,
        threshold: minLessons,
        reason: formatThresholdFail("scaffold_learning_course", "lessons", lessonCount ?? 0, minLessons),
      });
    }

    return true;
  }

  // ── generate_glossary ──
  if (stepKey === "generate_glossary") {
    const { data: pkg } = await sb
      .from("course_packages").select("curriculum_id, track").eq("id", packageId).single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_GLOSSARY", { reason: "no curriculum_id" });

    const { data: curr } = await sb
      .from("curricula").select("beruf_id").eq("id", pkg.curriculum_id).single();
    // FAIL-SOFT: Glossary is optional enrichment (see package-generate-glossary).
    // If the curriculum has no beruf_id, the function intentionally skips
    // and marks the step done. The post-condition MUST be consistent and
    // accept skipped glossary for all tracks (ZERTIFIKAT, EXAM_FIRST_PLUS,
    // FORTBILDUNG, STUDIUM) — otherwise the pipeline deadlocks.
    if (!curr?.beruf_id) {
      return true; // glossary skipped intentionally — pipeline continues
    }

    const { data: glossary } = await sb
      .from("profession_glossaries").select("id, glossary, token_count")
      .eq("beruf_id", curr.beruf_id).order("version", { ascending: false }).limit(1).maybeSingle();

    const glossaryData = glossary?.glossary;
    const tokenCount = num(glossary?.token_count);
    const isArray = Array.isArray(glossaryData);
    const isObject = glossaryData && typeof glossaryData === "object" && !isArray;
    const entryCount = isArray ? glossaryData.length : (isObject ? Object.keys(glossaryData).length : 0);

    const minEntries = resolveThreshold("generate_glossary", "glossary_entries");

    if (!glossary || entryCount < minEntries || tokenCount < 100) {
      throw hollowError("HOLLOW_GLOSSARY", {
        has_row: !!glossary,
        entry_count: entryCount,
        token_count: tokenCount,
        threshold: minEntries,
        reason: formatThresholdFail("generate_glossary", "glossary_entries", entryCount, minEntries),
      });
    }

    return true;
  }

  // ── generate_oral_exam ──
  if (stepKey === "generate_oral_exam") {
    const { count, error } = await sb
      .from("oral_exam_session_templates").select("id", { count: "exact", head: true })
      .eq("package_id", packageId);
    if (error) throw error;

    if ((count ?? 0) < 1) {
      throw hollowError("HOLLOW_ORAL_EXAM", { template_count: count ?? 0 });
    }

    const { data: templates } = await sb
      .from("oral_exam_session_templates").select("id, lead_questions, followup_questions")
      .eq("package_id", packageId).limit(50);

    const realTemplates = (templates ?? []).filter((t: any) => {
      const leads = Array.isArray(t.lead_questions) ? t.lead_questions.length : 0;
      return leads > 0;
    }).length;

    const total = templates?.length ?? 0;
    const minReal = Math.max(1, Math.ceil(total * 0.8));

    if (realTemplates < minReal) {
      throw hollowError("HOLLOW_ORAL_EXAM", {
        template_count: total, real_templates: realTemplates, min_real: minReal,
      });
    }

    return true;
  }

  // ── generate_lesson_minichecks ──
  // v2: Check BOTH embedded minicheck_parsed AND table-backed minicheck_questions
  // The SSOT for minichecks has migrated to the minicheck_questions table
  if (stepKey === "generate_lesson_minichecks") {
    const { data: pkg } = await sb
      .from("course_packages").select("course_id, curriculum_id").eq("id", packageId).single();
    if (!pkg?.course_id) throw hollowError("HOLLOW_MINICHECKS", { reason: "no course_id" });

    const { data: lessons } = await sb
      .from("lessons").select("id, minicheck_parsed, modules!inner(course_id)")
      .eq("modules.course_id", pkg.course_id).neq("lesson_type", "mini_check");

    const total = lessons?.length ?? 0;
    if (total === 0) throw hollowError("HOLLOW_MINICHECKS", { total_lessons: 0, with_minichecks: 0 });

    // Count lessons with embedded minichecks
    const withEmbedded = (lessons ?? []).filter((l: any) => {
      if (!l.minicheck_parsed) return false;
      if (Array.isArray(l.minicheck_parsed)) return l.minicheck_parsed.length > 0;
      if (typeof l.minicheck_parsed === "object") return Object.keys(l.minicheck_parsed).length > 0;
      return false;
    }).length;

    // Count competencies with table-backed minicheck_questions (the new SSOT)
    let tableBackedCompetencies = 0;
    if (pkg.curriculum_id) {
      const { count } = await sb
        .from("minicheck_questions")
        .select("competency_id", { count: "exact", head: true })
        .eq("status", "approved")
        .in("competency_id", (await sb
          .from("competencies")
          .select("id")
          .in("learning_field_id", (await sb
            .from("learning_fields")
            .select("id")
            .eq("curriculum_id", pkg.curriculum_id)
          ).data?.map((lf: any) => lf.id) ?? [])
        ).data?.map((c: any) => c.id) ?? []);
      tableBackedCompetencies = count ?? 0;
    }

    // Total coverage = max of embedded OR table-backed
    const withMinicheck = Math.max(withEmbedded, tableBackedCompetencies);

    const minRequired = Math.max(1, Math.ceil(total * 0.8));
    if (withMinicheck < minRequired) {
      throw hollowError("HOLLOW_MINICHECKS", {
        total_lessons: total,
        with_embedded: withEmbedded,
        with_table_backed: tableBackedCompetencies,
        with_minichecks: withMinicheck,
        min_required: minRequired,
        fp_real: withMinicheck,
        fp_placeholders: total - withMinicheck,
      });
    }

    return true;
  }

  // ── expand_handbook ──
  if (stepKey === "expand_handbook") {
    const { data: pkg } = await sb
      .from("course_packages").select("curriculum_id").eq("id", packageId).single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_EXPAND_HANDBOOK", { reason: "no curriculum_id" });

    const { data: chapters } = await sb
      .from("handbook_chapters").select("id").eq("curriculum_id", pkg.curriculum_id);
    const chapterIds = (chapters ?? []).map((c: any) => c.id);
    if (chapterIds.length === 0) throw hollowError("HOLLOW_EXPAND_HANDBOOK", { chapters: 0, sections: 0 });

    const { data: sections } = await sb
      .from("handbook_sections").select("id, content_markdown, content_tier")
      .in("chapter_id", chapterIds);

    const totalSections = sections?.length ?? 0;
    const expandedSections = (sections ?? []).filter((s: any) =>
      s.content_tier === "expanded" &&
      typeof s.content_markdown === "string" &&
      s.content_markdown.length >= 1800
    ).length;

    const minExpanded = resolveThreshold("expand_handbook", "expanded_sections", {
      sectionCount: totalSections,
    });

    if (totalSections === 0 || expandedSections < minExpanded) {
      throw hollowError("HOLLOW_EXPAND_HANDBOOK", {
        total_sections: totalSections,
        expanded_sections: expandedSections,
        threshold: minExpanded,
        reason: formatThresholdFail("expand_handbook", "expanded_sections", expandedSections, minExpanded),
      });
    }

    return true;
  }

  // ── validate_handbook ──
  if (stepKey === "validate_handbook") {
    const { data: pkg } = await sb
      .from("course_packages").select("curriculum_id").eq("id", packageId).single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_VALIDATE_HANDBOOK", { reason: "no curriculum_id" });

    const { data: chapters } = await sb
      .from("handbook_chapters").select("id").eq("curriculum_id", pkg.curriculum_id);
    const chapterIds = (chapters ?? []).map((c: any) => c.id);

    const minChapters = resolveThreshold("validate_handbook", "handbook_chapters");
    if (chapterIds.length < minChapters) {
      throw hollowError("HOLLOW_VALIDATE_HANDBOOK", {
        chapters: chapterIds.length, threshold: minChapters,
        reason: formatThresholdFail("validate_handbook", "handbook_chapters", chapterIds.length, minChapters),
      });
    }

    const { count: sectionCount } = await sb
      .from("handbook_sections").select("id", { count: "exact", head: true })
      .in("chapter_id", chapterIds);
    if ((sectionCount ?? 0) < 1) {
      throw hollowError("HOLLOW_VALIDATE_HANDBOOK", { chapters: chapterIds.length, sections: 0 });
    }

    return true;
  }

  // ── validate_blueprints ──
  if (stepKey === "validate_blueprints") {
    const { data: pkg } = await sb
      .from("course_packages").select("curriculum_id").eq("id", packageId).single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_VALIDATE_BLUEPRINTS", { reason: "no curriculum_id" });

    const { count } = await sb
      .from("question_blueprints").select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id);

    const minBP = resolveThreshold("validate_blueprints", "question_blueprints");
    if ((count ?? 0) < minBP) {
      throw hollowError("HOLLOW_VALIDATE_BLUEPRINTS", {
        blueprint_count: count ?? 0, threshold: minBP,
        reason: formatThresholdFail("validate_blueprints", "question_blueprints", count ?? 0, minBP),
      });
    }

    return true;
  }

  // ── validate_oral_exam ──
  if (stepKey === "validate_oral_exam") {
    const { data: pkg } = await sb
      .from("course_packages").select("curriculum_id").eq("id", packageId).single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_VALIDATE_ORAL_EXAM", { reason: "no curriculum_id" });

    const { count } = await sb
      .from("oral_exam_blueprints").select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id);

    const minOral = resolveThreshold("validate_oral_exam", "oral_exam_blueprints");
    if ((count ?? 0) < minOral) {
      throw hollowError("HOLLOW_VALIDATE_ORAL_EXAM", {
        blueprint_count: count ?? 0, threshold: minOral,
        reason: formatThresholdFail("validate_oral_exam", "oral_exam_blueprints", count ?? 0, minOral),
      });
    }

    return true;
  }

  // ── validate_lesson_minichecks ──
  if (stepKey === "validate_lesson_minichecks") {
    const { data: pkg } = await sb
      .from("course_packages").select("curriculum_id").eq("id", packageId).single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_VALIDATE_MINICHECKS", { reason: "no curriculum_id" });

    const { count } = await sb
      .from("minicheck_questions").select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id);

    const minMC = resolveThreshold("validate_lesson_minichecks", "minicheck_questions");
    if ((count ?? 0) < minMC) {
      throw hollowError("HOLLOW_VALIDATE_MINICHECKS", {
        minicheck_count: count ?? 0, threshold: minMC,
        reason: formatThresholdFail("validate_lesson_minichecks", "minicheck_questions", count ?? 0, minMC),
      });
    }

    return true;
  }

  // ── validate_tutor_index ──
  if (stepKey === "validate_tutor_index") {
    const { count } = await sb
      .from("ai_tutor_context_index").select("id", { count: "exact", head: true })
      .eq("package_id", packageId);

    const minIdx = resolveThreshold("validate_tutor_index", "ai_tutor_context_index");
    if ((count ?? 0) < minIdx) {
      throw hollowError("HOLLOW_VALIDATE_TUTOR_INDEX", {
        index_rows: count ?? 0, threshold: minIdx,
        reason: formatThresholdFail("validate_tutor_index", "ai_tutor_context_index", count ?? 0, minIdx),
      });
    }

    return true;
  }

  // ── validate_exam_pool ──
  if (stepKey === "validate_exam_pool") {
    const { data: pkg } = await sb
      .from("course_packages").select("curriculum_id").eq("id", packageId).single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_VALIDATE_EXAM_POOL", { reason: "no curriculum_id" });

    const { count } = await sb
      .from("exam_questions").select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id);

    const minEQ = resolveThreshold("validate_exam_pool", "exam_questions");
    if ((count ?? 0) < minEQ) {
      throw hollowError("HOLLOW_VALIDATE_EXAM_POOL", {
        question_count: count ?? 0, threshold: minEQ,
        reason: formatThresholdFail("validate_exam_pool", "exam_questions", count ?? 0, minEQ),
      });
    }

    return true;
  }

  // ── validate_learning_content ──
  if (stepKey === "validate_learning_content") {
    const { data: pkg } = await sb
      .from("course_packages").select("course_id").eq("id", packageId).single();
    if (!pkg?.course_id) throw hollowError("HOLLOW_VALIDATE_LEARNING", { reason: "no course_id" });

    const { data: modules } = await sb.from("modules").select("id").eq("course_id", pkg.course_id);
    if (!modules?.length) throw hollowError("HOLLOW_VALIDATE_LEARNING", { modules: 0 });

    const { count: lessonCount } = await sb
      .from("lessons").select("id", { count: "exact", head: true })
      .in("module_id", modules.map((m: any) => m.id)).neq("lesson_type", "mini_check");

    const minLessons = resolveThreshold("validate_learning_content", "lessons");
    if ((lessonCount ?? 0) < minLessons) {
      throw hollowError("HOLLOW_VALIDATE_LEARNING", {
        lessons: lessonCount ?? 0, threshold: minLessons,
        reason: formatThresholdFail("validate_learning_content", "lessons", lessonCount ?? 0, minLessons),
      });
    }

    return true;
  }

  return false;
}

function hollowError(verdict: string, meta: Record<string, unknown>): Error {
  const e: any = new Error(`${verdict}: post-condition failed`);
  e.__meta = { verdict, ...meta };
  return e;
}
