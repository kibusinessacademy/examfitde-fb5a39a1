/**
 * lesson-gen/prompt-builder.ts — Assemble system + user prompts
 * No DB calls. No LLM calls. Pure string assembly.
 * 
 * v3: Program-type-aware — academic vs. vocational prompt profiling
 *     including step-level prompt selection.
 */

import { STEP_PROMPTS, STEP_PROMPTS_ACADEMIC, buildMiniCheckPrompt } from "../lesson-gen-prompts.ts";
import type { LessonData, LessonContext, LessonRequest, LessonPrompts } from "./types.ts";

// ─── Academic prompt profiling ──────────────────────────────────────────────

const ACADEMIC_ROLE = (name: string) =>
  `Du bist Hochschuldozent (15+ J. Erfahrung) für ${name}. Schreibe wie ein akademischer Prüfungstrainer, nicht wie KI.`;

const VOCATIONAL_ROLE = (name: string) =>
  `Du bist IHK-Fachexperte (20 J. Erfahrung) für ${name}. Schreibe wie ein Ausbilder, nicht wie KI.`;

const ACADEMIC_EXAM_BLOCK = `PFLICHT: 📌 Klausur-/Modulprüfungstipp + ⚠️ Typischer Denkfehler. Theorie-Praxis-Transfer statt Reproduktion. Quellenverweise bei Modellen/Theorien.`;

const VOCATIONAL_EXAM_BLOCK = `PFLICHT: ⭐ IHK-Prüfungstipp + ⚠️ Prüfungsfalle. Praxis statt Theorie. Konkrete §§ bei Recht, vollständige Rechenwege bei Zahlen.`;

const ACADEMIC_ELITE = `ELITE-PFLICHT-STRUKTUR (jede Lektion MUSS enthalten):
1. Mindestens 3 Fachbegriffe als <strong>markiert</strong>
2. Mindestens 2 konkrete Anwendungsbeispiele (Fallstudien, Modelle, empirische Befunde)
3. Typische Denkfehler/Fehlkonzepte mit wissenschaftlicher Korrektur
4. Expliziter Prüfungsbezug (Klausur-/Modulprüfungshinweis)
5. Strukturiert mit Überschriften (<h3>/<h4>) UND Listen (<ul>/<ol>)
VERBOT: Keine generischen Floskeln, keine "In der Wissenschaft ist es wichtig"-Sätze ohne konkrete Belege.`;

const VOCATIONAL_ELITE = `ELITE-PFLICHT-STRUKTUR (jede Lektion MUSS enthalten):
1. Mindestens 3 Fachbegriffe als <strong>markiert</strong>
2. Mindestens 2 konkrete Praxisbeispiele (mit Zahlen, Rollen, konkreten Situationen)
3. Typische Fehler/Denkfehler mit Korrektur
4. Expliziter Prüfungsbezug (IHK-Prüfungshinweis)
5. Strukturiert mit Überschriften (<h3>/<h4>) UND Listen (<ul>/<ol>)
VERBOT: Keine generischen Floskeln, keine "In der Praxis ist es wichtig"-Sätze ohne konkrete Beispiele.`;

/**
 * Build complete system + user prompts for the LLM call.
 */
export function buildLessonPrompts(
  req: LessonRequest,
  data: LessonData,
  ctx: LessonContext,
): LessonPrompts {
  const isAcademic = data.programType === "higher_education";

  // Select the correct step prompt set based on program type
  const stepPrompts = isAcademic ? STEP_PROMPTS_ACADEMIC : STEP_PROMPTS;
  const stepConfig = stepPrompts[req.stepKey] || stepPrompts.verstehen
    || STEP_PROMPTS[req.stepKey] || STEP_PROMPTS.verstehen;

  const userPrompt = req.isMiniCheck
    ? isAcademic
      ? buildAcademicMiniCheckPrompt(data.professionName, ctx.contextBlock)
      : buildMiniCheckPrompt(data.professionName, ctx.contextBlock)
    : `${stepConfig.system}\n\n${ctx.contextBlock}`;

  const roleBlock = isAcademic
    ? ACADEMIC_ROLE(data.professionName)
    : VOCATIONAL_ROLE(data.professionName);

  const examBlock = isAcademic ? ACADEMIC_EXAM_BLOCK : VOCATIONAL_EXAM_BLOCK;
  const eliteBlock = isAcademic ? ACADEMIC_ELITE : VOCATIONAL_ELITE;

  const difficultyLine = data.lfData?.difficulty_tier === 'hard'
    ? isAcademic
      ? 'SCHWER: Mehrstufige Analysen, Modellvergleiche, kritische Reflexion, Transferaufgaben.'
      : 'SCHWER: Mehrstufige Berechnungen, Kombinationsaufgaben, Pro-Contra.'
    : '';

  const focusLine = data.lfData?.ihk_focus_areas?.length
    ? isAcademic
      ? `Modul-Schwerpunkte: ${data.lfData.ihk_focus_areas.join(", ")}`
      : `IHK-Schwerpunkte: ${data.lfData.ihk_focus_areas.join(", ")}`
    : '';

  const systemPrompt = `${roleBlock}
${data.glossaryContext}
${examBlock}
${difficultyLine}
${focusLine}
Keine Floskeln. Keine Einleitungen. Direkt zum Inhalt.

${eliteBlock}

FORMAT: Antworte NUR mit validem JSON (kein Markdown, keine Fences).
${req.isMiniCheck
  ? '{"questions": [{"question": "...", "options": ["A","B","C","D"], "correct_answer": 0, "explanation": "..."}], "objectives": ["..."]}'
  : '{"html": "<h3>...</h3><p>...</p>", "objectives": ["..."], "key_terms": [{"term": "...", "definition": "...", "exam_relevance": "..."}], "common_mistakes": [{"mistake": "...", "correction": "...", "trap_type": "..."}], "exam_triggers": ["..."]}'}`;

  return { systemPrompt, userPrompt };
}

/**
 * Academic variant of MiniCheck prompt — uses Klausur/Modulprüfung framing.
 */
function buildAcademicMiniCheckPrompt(programName: string, context: string): string {
  return `7-8 Klausur-/Modulprüfungsfragen für ${programName}.
${context}

VERTEILUNG: 2 Reproduktion (Wissen), 3 Anwendung (Transfer), 2-3 Analyse/Bewertung.
Anspruchsvoll = ≥2 Denkschritte + Modellvergleich oder kritische Reflexion.

PFLICHT: ≥2 Fallanalyse-Fragen, ≥1 Transferfrage, ≥1 Modellvergleich, ≥1 Bewertungsaufgabe.

DISTRAKTOREN (je 1 Fehlertyp):
A: Konzept-/Modellverwechslung | B: Anwendungsfehler | C: Kausalitätsfehler | D: Scheinkorrelation

ERKLÄRUNG pro Frage: Warum richtig? + Warum jede Option falsch? (Fehlertyp + Denkfehler) + "Merke/Tipp:" (1 Satz).
Keine "Was ist...?"-Fragen ohne Kontext. Keine offensichtlich falschen Distraktoren.`;
}
