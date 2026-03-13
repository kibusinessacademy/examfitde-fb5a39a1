/**
 * lesson-gen/loaders.ts — Database reads only. No prompt logic.
 */

import { resolveProfession } from "../profession-resolver.ts";
import { loadCachedGlossary, formatGlossaryForPrompt } from "../glossary-loader.ts";
import type { LessonRequest, LessonData } from "./types.ts";

/**
 * Load all data needed for lesson generation:
 * - Lesson metadata (with module join)
 * - Learning field data
 * - Profession name
 * - Glossary context
 */
export async function loadLessonGenerationData(
  sb: any,
  req: LessonRequest,
  json: (body: unknown, status?: number) => Response,
): Promise<{ data: LessonData } | { error: Response }> {
  // Load lesson metadata
  const { data: lesson, error: lErr } = await sb
    .from("lessons")
    .select("id, title, step, module_id, content, qc_status, modules!inner(course_id, title, learning_field_id)")
    .eq("id", req.lessonId)
    .single();

  if (lErr || !lesson) {
    return { error: json({ error: "Lesson not found", details: lErr?.message }, 404) };
  }

  // Load LF context
  const lfId = (lesson as any).modules?.learning_field_id;
  let lfData: any = null;
  if (lfId) {
    const { data } = await sb
      .from("learning_fields")
      .select("id, title, code, weight_percent, exam_part, difficulty_tier, ihk_focus_areas")
      .eq("id", lfId)
      .maybeSingle();
    lfData = data;
  }

  // Resolve profession + glossary
  let professionName: string;
  let glossaryContext = "";
  try {
    const prof = await resolveProfession(sb, {
      certificationId: req.certificationId,
      curriculumId: req.curriculumId,
    });
    professionName = prof.professionName;

    const { data: cu } = await sb.from("curricula").select("beruf_id").eq("id", req.curriculumId).maybeSingle();
    if (cu?.beruf_id) {
      try {
        const glossary = await loadCachedGlossary(sb, cu.beruf_id, professionName);
        if (glossary) glossaryContext = formatGlossaryForPrompt(glossary, lfData?.code || null);
      } catch { /* no glossary — proceed */ }
    }
  } catch (e) {
    return { error: json({ error: (e as Error).message }, 400) };
  }

  return {
    data: { lesson, lfData, lfId: lfId || null, professionName, glossaryContext },
  };
}
