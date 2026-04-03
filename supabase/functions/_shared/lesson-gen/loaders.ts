/**
 * lesson-gen/loaders.ts — Database reads only. No prompt logic.
 * OPT-1: Parallelized DB reads for maximum throughput.
 */

import { resolveProfession } from "../profession-resolver.ts";
import { loadCachedGlossary, formatGlossaryForPrompt } from "../glossary-loader.ts";
import {
  loadMasteryContext,
} from "../prompt-kit.ts";
import type { LessonRequest, LessonData } from "./types.ts";

/**
 * Load all data needed for lesson generation in parallel:
 * - Lesson metadata (with module join)
 * - Learning field data (after lesson, needs lfId)
 * - Profession name + glossary (parallel with LF)
 * - Mastery context (parallel with LF)
 */
export async function loadLessonGenerationData(
  sb: any,
  req: LessonRequest,
  json: (body: unknown, status?: number) => Response,
): Promise<{ data: LessonData } | { error: Response }> {
  // ── Phase 1: Lesson + Profession resolution in parallel ──
  // These two are independent and can run concurrently
  const [lessonResult, profResult] = await Promise.all([
    sb
      .from("lessons")
      .select("id, title, step, module_id, content, qc_status, modules!inner(course_id, title, learning_field_id)")
      .eq("id", req.lessonId)
      .single(),
    resolveProfession(sb, {
      certificationId: req.certificationId,
      curriculumId: req.curriculumId,
    }).catch((e: Error) => ({ _error: e })),
  ]);

  const { data: lesson, error: lErr } = lessonResult;
  if (lErr || !lesson) {
    return { error: json({ error: "Lesson not found", details: lErr?.message }, 404) };
  }

  if (profResult && "_error" in profResult) {
    return { error: json({ error: (profResult._error as Error).message }, 400) };
  }
  const professionName = profResult.professionName;

  // ── Phase 2: LF data + Glossary + Mastery — all parallel ──
  // These depend on lesson/profession but are independent of each other
  const lfId = (lesson as any).modules?.learning_field_id;

  // Fetch beruf_id + program_type once (needed for glossary + prompt profiling)
  const curriculaPromise = sb.from("curricula").select("beruf_id, program_type").eq("id", req.curriculumId).maybeSingle()
    .then((r: any) => ({ berufId: r.data?.beruf_id || null, programType: r.data?.program_type || "vocational" }))
    .catch(() => ({ berufId: null, programType: "vocational" }));

  const phase2Promises: [
    Promise<any>,                         // LF data
    Promise<{ berufId: string | null; programType: string }>, // curricula data
    Promise<any>,                         // mastery context
  ] = [
    // LF data
    lfId
      ? sb.from("learning_fields")
          .select("id, title, code, weight_percent, exam_part, difficulty_tier, ihk_focus_areas")
          .eq("id", lfId)
          .maybeSingle()
          .then((r: any) => r.data)
      : Promise.resolve(null),

    // curricula data (beruf_id + program_type)
    curriculaPromise,

    // Mastery context (moved here from context.ts to parallelize)
    (async () => {
      try {
        return await loadMasteryContext(sb, req.curriculumId, lfId || null);
      } catch { return null; }
    })(),
  ];

  const [lfData, curriculaData, masteryCtx] = await Promise.all(phase2Promises);
  const { berufId, programType } = curriculaData;

  // Glossary: uses beruf_id + lfCode (both now available)
  let finalGlossaryContext = "";
  if (berufId) {
    try {
      const glossary = await loadCachedGlossary(sb, berufId, professionName);
      if (glossary) finalGlossaryContext = formatGlossaryForPrompt(glossary, lfData?.code || null);
    } catch { /* no glossary — proceed */ }
  }

  return {
    data: {
      lesson,
      lfData,
      lfId: lfId || null,
      professionName,
      glossaryContext: finalGlossaryContext,
      masteryCtx,
      programType: programType === "higher_education" ? "higher_education" : "vocational",
    },
  };
}
