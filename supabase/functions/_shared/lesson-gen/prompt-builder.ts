/**
 * lesson-gen/prompt-builder.ts — Assemble system + user prompts
 * No DB calls. No LLM calls. Pure string assembly.
 */

import { STEP_PROMPTS, buildMiniCheckPrompt } from "../lesson-gen-prompts.ts";
import type { LessonData, LessonContext, LessonRequest, LessonPrompts } from "./types.ts";

/**
 * Build complete system + user prompts for the LLM call.
 */
export function buildLessonPrompts(
  req: LessonRequest,
  data: LessonData,
  ctx: LessonContext,
): LessonPrompts {
  const stepConfig = STEP_PROMPTS[req.stepKey] || STEP_PROMPTS.verstehen;

  const userPrompt = req.isMiniCheck
    ? buildMiniCheckPrompt(data.professionName, ctx.contextBlock)
    : `${stepConfig.system}\n\n${ctx.contextBlock}`;

  const systemPrompt = `Du bist IHK-Fachexperte (20 J. Erfahrung) für ${data.professionName}. Schreibe wie ein Ausbilder, nicht wie KI.
${data.glossaryContext}
PFLICHT: ⭐ IHK-Prüfungstipp + ⚠️ Prüfungsfalle. Praxis statt Theorie. Konkrete §§ bei Recht, vollständige Rechenwege bei Zahlen.
${data.lfData?.difficulty_tier === 'hard' ? 'SCHWER: Mehrstufige Berechnungen, Kombinationsaufgaben, Pro-Contra.' : ''}
${data.lfData?.ihk_focus_areas?.length ? `IHK-Schwerpunkte: ${data.lfData.ihk_focus_areas.join(", ")}` : ''}
Keine Floskeln. Keine Einleitungen. Direkt zum Inhalt.

ELITE-PFLICHT-STRUKTUR (jede Lektion MUSS enthalten):
1. Mindestens 3 Fachbegriffe als <strong>markiert</strong>
2. Mindestens 2 konkrete Praxisbeispiele (mit Zahlen, Rollen, konkreten Situationen)
3. Typische Fehler/Denkfehler mit Korrektur
4. Expliziter Prüfungsbezug (IHK-Prüfungshinweis)
5. Strukturiert mit Überschriften (<h3>/<h4>) UND Listen (<ul>/<ol>)
VERBOT: Keine generischen Floskeln, keine "In der Praxis ist es wichtig"-Sätze ohne konkrete Beispiele.

FORMAT: Antworte NUR mit validem JSON (kein Markdown, keine Fences).
${req.isMiniCheck
  ? '{"questions": [{"question": "...", "options": ["A","B","C","D"], "correct_answer": 0, "explanation": "..."}], "objectives": ["..."]}'
  : '{"html": "<h3>...</h3><p>...</p>", "objectives": ["..."], "key_terms": [{"term": "...", "definition": "...", "exam_relevance": "..."}], "common_mistakes": [{"mistake": "...", "correction": "...", "trap_type": "..."}], "exam_triggers": ["..."]}'}`;

  return { systemPrompt, userPrompt };
}
