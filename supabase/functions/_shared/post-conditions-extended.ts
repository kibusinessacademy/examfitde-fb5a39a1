// supabase/functions/_shared/post-conditions-extended.ts
// Extended Hollow-Completion Guards for steps NOT covered in post-conditions.ts
// Steps covered here: scaffold_learning_course, generate_glossary,
//   generate_oral_exam, generate_lesson_minichecks, expand_handbook

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

  // ── scaffold_learning_course: must have modules with lessons ──
  if (stepKey === "scaffold_learning_course") {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("course_id")
      .eq("id", packageId)
      .single();
    if (!pkg?.course_id) throw hollowError("HOLLOW_SCAFFOLD", { reason: "no course_id on package" });

    const { data: modules } = await sb
      .from("modules")
      .select("id")
      .eq("course_id", pkg.course_id);
    const moduleCount = modules?.length ?? 0;

    if (moduleCount === 0) {
      throw hollowError("HOLLOW_SCAFFOLD", { modules: 0, lessons: 0 });
    }

    const moduleIds = modules.map((m: any) => m.id);
    const { count: lessonCount } = await sb
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .in("module_id", moduleIds);

    if ((lessonCount ?? 0) < 1) {
      throw hollowError("HOLLOW_SCAFFOLD", { modules: moduleCount, lessons: lessonCount ?? 0 });
    }

    return true;
  }

  // ── generate_glossary: profession_glossaries must have non-empty glossary JSON ──
  if (stepKey === "generate_glossary") {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", packageId)
      .single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_GLOSSARY", { reason: "no curriculum_id" });

    // Resolve beruf_id from curricula
    const { data: curr } = await sb
      .from("curricula")
      .select("beruf_id")
      .eq("id", pkg.curriculum_id)
      .single();
    if (!curr?.beruf_id) throw hollowError("HOLLOW_GLOSSARY", { reason: "no beruf_id on curriculum" });

    const { data: glossary } = await sb
      .from("profession_glossaries")
      .select("id, glossary, token_count")
      .eq("beruf_id", curr.beruf_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const glossaryData = glossary?.glossary;
    const tokenCount = num(glossary?.token_count);

    // Glossary must exist, have content, and have reasonable token count
    const isArray = Array.isArray(glossaryData);
    const isObject = glossaryData && typeof glossaryData === "object" && !isArray;
    const entryCount = isArray ? glossaryData.length : (isObject ? Object.keys(glossaryData).length : 0);

    if (!glossary || entryCount < 5 || tokenCount < 100) {
      throw hollowError("HOLLOW_GLOSSARY", {
        has_row: !!glossary,
        entry_count: entryCount,
        token_count: tokenCount,
      });
    }

    return true;
  }

  // ── generate_oral_exam: must have oral_exam_session_templates for this package ──
  if (stepKey === "generate_oral_exam") {
    const { count, error } = await sb
      .from("oral_exam_session_templates")
      .select("id", { count: "exact", head: true })
      .eq("package_id", packageId);
    if (error) throw error;

    if ((count ?? 0) < 1) {
      throw hollowError("HOLLOW_ORAL_EXAM", { template_count: count ?? 0 });
    }

    // Check that templates have actual content (lead_questions not empty)
    const { data: templates } = await sb
      .from("oral_exam_session_templates")
      .select("id, lead_questions, followup_questions")
      .eq("package_id", packageId)
      .limit(50);

    const realTemplates = (templates ?? []).filter((t: any) => {
      const leads = Array.isArray(t.lead_questions) ? t.lead_questions.length : 0;
      return leads > 0;
    }).length;

    const total = templates?.length ?? 0;
    const minReal = Math.max(1, Math.ceil(total * 0.8));

    if (realTemplates < minReal) {
      throw hollowError("HOLLOW_ORAL_EXAM", {
        template_count: total,
        real_templates: realTemplates,
        min_real: minReal,
      });
    }

    return true;
  }

  // ── generate_lesson_minichecks: lessons must have non-null minicheck_parsed ──
  if (stepKey === "generate_lesson_minichecks") {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("course_id")
      .eq("id", packageId)
      .single();
    if (!pkg?.course_id) throw hollowError("HOLLOW_MINICHECKS", { reason: "no course_id" });

    // Count non-mini_check lessons (mini_check type excluded from completion metrics)
    const { data: lessons } = await sb
      .from("lessons")
      .select("id, minicheck_parsed, modules!inner(course_id)")
      .eq("modules.course_id", pkg.course_id)
      .neq("lesson_type", "mini_check");

    const total = lessons?.length ?? 0;
    if (total === 0) {
      throw hollowError("HOLLOW_MINICHECKS", { total_lessons: 0, with_minichecks: 0 });
    }

    const withMinicheck = (lessons ?? []).filter((l: any) => {
      if (!l.minicheck_parsed) return false;
      // minicheck_parsed should be a non-empty array or object
      if (Array.isArray(l.minicheck_parsed)) return l.minicheck_parsed.length > 0;
      if (typeof l.minicheck_parsed === "object") return Object.keys(l.minicheck_parsed).length > 0;
      return false;
    }).length;

    // Require at least 80% of lessons to have minichecks
    const minRequired = Math.max(1, Math.ceil(total * 0.8));

    if (withMinicheck < minRequired) {
      throw hollowError("HOLLOW_MINICHECKS", {
        total_lessons: total,
        with_minichecks: withMinicheck,
        min_required: minRequired,
      });
    }

    return true;
  }

  // ── expand_handbook: sections must have content_tier='expanded' with sufficient length ──
  if (stepKey === "expand_handbook") {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", packageId)
      .single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_EXPAND_HANDBOOK", { reason: "no curriculum_id" });

    const { data: chapters } = await sb
      .from("handbook_chapters")
      .select("id")
      .eq("curriculum_id", pkg.curriculum_id);
    const chapterIds = (chapters ?? []).map((c: any) => c.id);

    if (chapterIds.length === 0) {
      throw hollowError("HOLLOW_EXPAND_HANDBOOK", { chapters: 0, sections: 0 });
    }

    const { data: sections } = await sb
      .from("handbook_sections")
      .select("id, content_markdown, content_tier")
      .in("chapter_id", chapterIds);

    const totalSections = sections?.length ?? 0;
    const expandedSections = (sections ?? []).filter((s: any) =>
      s.content_tier === "expanded" &&
      typeof s.content_markdown === "string" &&
      s.content_markdown.length >= 1800
    ).length;

    // Require at least 80% of sections to be expanded
    const minExpanded = Math.max(1, Math.ceil(totalSections * 0.8));

    if (totalSections === 0 || expandedSections < minExpanded) {
      throw hollowError("HOLLOW_EXPAND_HANDBOOK", {
        total_sections: totalSections,
        expanded_sections: expandedSections,
        min_expanded: minExpanded,
      });
    }

    return true;
  }

  // ── validate_handbook: verify the validator actually inspected sections ──
  if (stepKey === "validate_handbook") {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", packageId)
      .single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_VALIDATE_HANDBOOK", { reason: "no curriculum_id" });

    const { data: chapters } = await sb
      .from("handbook_chapters")
      .select("id")
      .eq("curriculum_id", pkg.curriculum_id);
    const chapterIds = (chapters ?? []).map((c: any) => c.id);

    if (chapterIds.length < 3) {
      throw hollowError("HOLLOW_VALIDATE_HANDBOOK", { chapters: chapterIds.length, min: 3 });
    }

    const { count: sectionCount } = await sb
      .from("handbook_sections")
      .select("id", { count: "exact", head: true })
      .in("chapter_id", chapterIds);

    if ((sectionCount ?? 0) < 1) {
      throw hollowError("HOLLOW_VALIDATE_HANDBOOK", { chapters: chapterIds.length, sections: 0 });
    }

    return true;
  }

  // ── validate_blueprints: must have blueprints to validate ──
  if (stepKey === "validate_blueprints") {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", packageId)
      .single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_VALIDATE_BLUEPRINTS", { reason: "no curriculum_id" });

    const { count } = await sb
      .from("question_blueprints")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id);

    if ((count ?? 0) < 10) {
      throw hollowError("HOLLOW_VALIDATE_BLUEPRINTS", { blueprint_count: count ?? 0, min: 10 });
    }

    return true;
  }

  // ── validate_oral_exam: must have oral exam blueprints to validate ──
  if (stepKey === "validate_oral_exam") {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", packageId)
      .single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_VALIDATE_ORAL_EXAM", { reason: "no curriculum_id" });

    const { count } = await sb
      .from("oral_exam_blueprints")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id);

    if ((count ?? 0) < 10) {
      throw hollowError("HOLLOW_VALIDATE_ORAL_EXAM", { blueprint_count: count ?? 0, min: 10 });
    }

    return true;
  }

  // ── validate_lesson_minichecks: must have minichecks to validate ──
  if (stepKey === "validate_lesson_minichecks") {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", packageId)
      .single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_VALIDATE_MINICHECKS", { reason: "no curriculum_id" });

    const { count } = await sb
      .from("minicheck_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id);

    if ((count ?? 0) < 1) {
      throw hollowError("HOLLOW_VALIDATE_MINICHECKS", { minicheck_count: count ?? 0 });
    }

    return true;
  }

  // ── validate_tutor_index: must have index rows ──
  if (stepKey === "validate_tutor_index") {
    const { count } = await sb
      .from("ai_tutor_context_index")
      .select("id", { count: "exact", head: true })
      .eq("package_id", packageId);

    if ((count ?? 0) < 1) {
      throw hollowError("HOLLOW_VALIDATE_TUTOR_INDEX", { index_rows: count ?? 0 });
    }

    return true;
  }

  // ── validate_exam_pool: must have exam questions to validate ──
  if (stepKey === "validate_exam_pool") {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", packageId)
      .single();
    if (!pkg?.curriculum_id) throw hollowError("HOLLOW_VALIDATE_EXAM_POOL", { reason: "no curriculum_id" });

    const { count } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id);

    if ((count ?? 0) < 50) {
      throw hollowError("HOLLOW_VALIDATE_EXAM_POOL", { question_count: count ?? 0, min: 50 });
    }

    return true;
  }

  // ── validate_learning_content: must have real lessons ──
  if (stepKey === "validate_learning_content") {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("course_id")
      .eq("id", packageId)
      .single();
    if (!pkg?.course_id) throw hollowError("HOLLOW_VALIDATE_LEARNING", { reason: "no course_id" });

    const { data: modules } = await sb
      .from("modules")
      .select("id")
      .eq("course_id", pkg.course_id);

    if (!modules?.length) {
      throw hollowError("HOLLOW_VALIDATE_LEARNING", { modules: 0 });
    }

    const { count: lessonCount } = await sb
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .in("module_id", modules.map((m: any) => m.id))
      .neq("lesson_type", "mini_check");

    if ((lessonCount ?? 0) < 1) {
      throw hollowError("HOLLOW_VALIDATE_LEARNING", { lessons: lessonCount ?? 0 });
    }

    return true;
  }

  // Not handled by this module
  return false;
}

/** Helper: creates a structured hollow error with __meta */
function hollowError(verdict: string, meta: Record<string, unknown>): Error {
  const e: any = new Error(`${verdict}: post-condition failed`);
  e.__meta = { verdict, ...meta };
  return e;
}
