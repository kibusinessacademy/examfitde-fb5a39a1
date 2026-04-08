/**
 * handbook-context.ts — Context loaders & prompt builder for handbook generation
 * v16: P1-hardened — persona-aware prompts with mandatory didactic blocks,
 *      praxis examples, exam traps, decision logic, transfer requirements.
 *      References didactic-requirements.ts as SSOT (Guardrail A).
 */

import { HANDBOOK_REQUIREMENTS, type HandbookPromptRequirements } from "./didactic-requirements.ts";
import { resolvePersonaProfile, type PersonaProfile, PERSONA_CONFIGS } from "./persona-profiles.ts";

type SB = any;

export interface CompetencyContext {
  name: string;
  bloom: string;
  misconceptions: string[];
}

const MAX_COMPETENCIES = 10;
const MAX_SUBTOPICS = 8;
const MAX_SAMPLE_QUESTIONS = 2;

export async function loadFieldCompetencies(
  sb: SB,
  fieldId: string,
): Promise<CompetencyContext[]> {
  try {
    const { data } = await sb
      .from("competencies")
      .select("title, bloom_level, typical_misconceptions")
      .eq("learning_field_id", fieldId)
      .limit(MAX_COMPETENCIES);
    return (data || []).map((c: any) => ({
      name: c.title || "",
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
        .limit(20);
      if (!allParents?.length) return [];
      parentIds = allParents.map((p: any) => p.id);
    }

    const { data: subtopics } = await sb
      .from("curriculum_topics")
      .select("topic_name")
      .in("parent_topic_id", parentIds)
      .limit(MAX_SUBTOPICS);

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
      .limit(MAX_SAMPLE_QUESTIONS);
    return (data || []).map((q: any) => (q.question_text || "").slice(0, 150)).filter(Boolean);
  } catch { return []; }
}

/**
 * v16: P1-hardened — persona-aware prompt with mandatory didactic structure.
 * Falls back to AZUBI_HIGH_ROI if no persona provided.
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
  persona?: PersonaProfile,
): string {
  const activePersona = persona || "AZUBI_HIGH_ROI";
  const reqs = HANDBOOK_REQUIREMENTS[activePersona];
  const config = PERSONA_CONFIGS[activePersona];
  const parts: string[] = [];

  parts.push(`Du bist ${config.role} für ${professionName}. Erstelle einen Handbuch-Abschnitt für "${fieldCode}: ${fieldTitle}".`);

  if (fieldDescription) {
    parts.push(`Beschreibung: ${fieldDescription.slice(0, 300)}`);
  }

  if (subtopics.length > 0) {
    parts.push(`Kernthemen: ${subtopics.join(", ")}`);
  }

  if (competencies.length > 0) {
    const compList = competencies.map(c => {
      const misc = c.misconceptions.length > 0 ? ` (Fehlvorstellung: ${c.misconceptions[0]})` : "";
      return `${c.name} [${c.bloom}]${misc}`;
    }).join("\n- ");
    parts.push(`Kompetenzen:\n- ${compList}`);
  }

  if (sampleQuestions.length > 0) {
    parts.push(`Prüfungsfragen-Beispiele (Orientierung für Schwierigkeitsniveau):\n${sampleQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`);
  }

  // Mandatory structure from SSOT
  const structureBlock = reqs.mandatoryBlocks.map((b, i) => `${i + 1}. **${b}**`).join("\n");

  parts.push(`## Pflichtstruktur (Markdown):\n${structureBlock}`);

  // Persona-specific quality requirements
  parts.push(reqs.promptSuffix);

  parts.push(`Umfang: ca. ${Math.max(wordTarget, reqs.minWordTarget)} Wörter. Nur Markdown, keine Meta-Kommentare.`);

  return parts.join("\n\n");
}
