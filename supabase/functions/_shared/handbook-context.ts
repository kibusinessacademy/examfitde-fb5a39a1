/**
 * handbook-context.ts — Context loaders & prompt builder for handbook generation
 * v15: Lean basis pass — reduced context injection, compact prompt.
 * Depth (examples, transfer, muster tasks) handled by expand_handbook step.
 */

type SB = any;

export interface CompetencyContext {
  name: string;
  bloom: string;
  misconceptions: string[];
}

// v15: Cap at 10 competencies (from 30) — reduce prompt size
const MAX_COMPETENCIES = 10;
// v15: Cap at 8 subtopics (from 50) — only core topics
const MAX_SUBTOPICS = 8;
// v15: Cap at 2 sample questions (from 5)
const MAX_SAMPLE_QUESTIONS = 2;

export async function loadFieldCompetencies(
  sb: SB,
  fieldId: string,
): Promise<CompetencyContext[]> {
  try {
    const { data } = await sb
      .from("competencies")
      .select("competency_name, bloom_level, typical_misconceptions")
      .eq("learning_field_id", fieldId)
      .limit(MAX_COMPETENCIES);
    return (data || []).map((c: any) => ({
      name: c.competency_name || "",
      bloom: c.bloom_level || "understand",
      misconceptions: Array.isArray(c.typical_misconceptions) ? c.typical_misconceptions.slice(0, 1) : [],
    }));
  } catch { return []; }
}

export async function loadFieldTopicDepth(
  sb: SB,
  curriculumId: string,
  fieldTitle: string,
): Promise<string[]> {
  try {
    const { data: parentTopics } = await sb
      .from("curriculum_topics")
      .select("id, topic_name")
      .eq("certification_id", curriculumId)
      .is("parent_topic_id", null)
      .ilike("topic_name", `%${fieldTitle.slice(0, 30)}%`)
      .limit(3);

    let parentIds: string[] = [];
    if (parentTopics?.length) {
      parentIds = parentTopics.map((t: any) => t.id);
    } else {
      const { data: allParents } = await sb
        .from("curriculum_topics")
        .select("id, topic_name")
        .eq("certification_id", curriculumId)
        .is("parent_topic_id", null)
        .limit(20);  // v15: reduced from 50
      if (!allParents?.length) return [];
      parentIds = allParents.map((p: any) => p.id);
    }

    const { data: subtopics } = await sb
      .from("curriculum_topics")
      .select("topic_name")
      .in("parent_topic_id", parentIds)
      .limit(MAX_SUBTOPICS);  // v15: capped at 8

    return subtopics?.map((s: any) => s.topic_name) || [];
  } catch { return []; }
}

export async function loadExamQuestionSample(
  sb: SB,
  curriculumId: string,
  fieldId: string,
): Promise<string[]> {
  try {
    const { data } = await sb
      .from("exam_questions")
      .select("question_text")
      .eq("curriculum_id", curriculumId)
      .eq("learning_field_id", fieldId)
      .in("status", ["approved"])
      .limit(MAX_SAMPLE_QUESTIONS);  // v15: reduced from 5
    return (data || []).map((q: any) => (q.question_text || "").slice(0, 150)).filter(Boolean);
  } catch { return []; }
}

/**
 * v15: Lean basis prompt — focuses on solid structure and core content.
 * Elite depth (examples, transfer, Musteraufgaben) is added by expand_handbook.
 */
export function buildElitePrompt(
  professionName: string,
  fieldCode: string,
  fieldTitle: string,
  fieldDescription: string,
  subtopics: string[],
  competencies: CompetencyContext[],
  sampleQuestions: string[],
  wordTarget: number,
): string {
  const parts: string[] = [];

  parts.push(`Erstelle einen Handbuch-Abschnitt für "${fieldCode}: ${fieldTitle}" (${professionName}).`);

  if (fieldDescription) {
    parts.push(`Beschreibung: ${fieldDescription.slice(0, 300)}`);
  }

  if (subtopics.length > 0) {
    parts.push(`Kernthemen: ${subtopics.join(", ")}`);
  }

  if (competencies.length > 0) {
    const compList = competencies.map(c => `${c.name} [${c.bloom}]`).join(", ");
    parts.push(`Kompetenzen: ${compList}`);
  }

  if (sampleQuestions.length > 0) {
    parts.push(`Prüfungsfragen-Beispiele:\n${sampleQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`);
  }

  parts.push(`
## Pflichtstruktur (Markdown):
1. **Fachliche Grundlagen** — Kernthemen systematisch erklären, Definitionen, Zusammenhänge
2. **Formeln & Berechnungen** — falls relevant, mit je einem Beispiel
3. **Prüfungsfallen** — mind. 3 typische Fehler mit Erklärung
4. **Merkschemata** — Eselsbrücken, Checklisten
5. **Zusammenfassung** — 5–8 wichtigste Fakten

Umfang: ca. ${wordTarget} Wörter. Nur Markdown, keine Meta-Kommentare.`);

  return parts.join("\n\n");
}