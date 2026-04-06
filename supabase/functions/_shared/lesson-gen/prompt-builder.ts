/**
 * lesson-gen/prompt-builder.ts — Assemble system + user prompts
 * No DB calls. No LLM calls. Pure string assembly.
 * 
 * v4: Persona-profile-aware — replaces binary academic/vocational split
 *     with 5 distinct persona profiles for role, style, and depth.
 */

import { STEP_PROMPTS, STEP_PROMPTS_ACADEMIC, buildMiniCheckPrompt } from "../lesson-gen-prompts.ts";
import { getPersonaConfig, type PersonaProfile } from "../persona-profiles.ts";
import type { LessonData, LessonContext, LessonRequest, LessonPrompts } from "./types.ts";

// ── Persona-specific exam blocks ────────────────────────────────────────────

const EXAM_BLOCKS: Record<PersonaProfile, string> = {
  AZUBI_HIGH_ROI: `PFLICHT: ⭐ IHK-Prüfungstipp + ⚠️ Prüfungsfalle. Praxis statt Theorie. Konkrete §§ bei Recht, vollständige Rechenwege bei Zahlen. Ausführliche Erklärungen mit Beispielen aus dem Berufsalltag.`,
  AZUBI_LOW_ROI: `PFLICHT: ⭐ IHK-Prüfungstipp + ⚠️ Prüfungsfalle. NUR prüfungsrelevante Fakten. Kurz und prägnant. Keine ausführlichen Erklärungen.`,
  SACHKUNDE: `PFLICHT: ⭐ Prüfungstipp + ⚠️ Prüfungsfalle. §-Referenzen bei Recht. Entscheidungsorientiert: Was ist erlaubt/verboten? Kurze, klare Aussagen.`,
  FACHWIRT: `PFLICHT: ⭐ Prüfungstipp + ⚠️ Prüfungsfalle. Handlungskompetenz-Fokus: Entscheidungen begründen, Maßnahmen ableiten. Praxis + Struktur.`,
  STUDIUM: `PFLICHT: 📌 Klausur-/Modulprüfungstipp + ⚠️ Typischer Denkfehler. Theorie-Praxis-Transfer statt Reproduktion. Quellenverweise bei Modellen/Theorien.`,
};

const ELITE_BLOCKS: Record<PersonaProfile, string> = {
  AZUBI_HIGH_ROI: `ELITE-PFLICHT-STRUKTUR (jede Lektion MUSS enthalten):
1. Mindestens 3 Fachbegriffe als <strong>markiert</strong>
2. Mindestens 2 konkrete Praxisbeispiele (mit Zahlen, Rollen, konkreten Situationen)
3. Typische Fehler/Denkfehler mit Korrektur
4. Expliziter Prüfungsbezug (IHK-Prüfungshinweis)
5. Strukturiert mit Überschriften (<h3>/<h4>) UND Listen (<ul>/<ol>)
VERBOT: Keine generischen Floskeln, keine "In der Praxis ist es wichtig"-Sätze ohne konkrete Beispiele.`,

  AZUBI_LOW_ROI: `KOMPAKT-STRUKTUR (kurz + prüfungsfokussiert):
1. Mindestens 2 Fachbegriffe als <strong>markiert</strong>
2. 1 konkretes Prüfungsbeispiel
3. Typische Prüfungsfalle mit Korrektur
4. Prüfungsbezug (IHK)
5. Kompakte Struktur, keine langen Erklärungen
VERBOT: Keine ausführlichen Herleitungen. Kein "Pädagogik-Modus". Nur Prüfungswissen.`,

  SACHKUNDE: `SACHKUNDE-STRUKTUR (§-fokussiert):
1. Fachbegriffe + §-Referenzen als <strong>markiert</strong>
2. Erlaubt/Verboten-Entscheidungen klar benennen
3. Typische Prüfungsfalle mit Korrektur
4. Keine ausführlichen Erklärungen — nur entscheidungsrelevante Fakten
VERBOT: Keine Praxisgeschichten. Keine langen Szenarien. Nur Regelwissen.`,

  FACHWIRT: `FORTBILDUNGS-STRUKTUR (Handlungskompetenz):
1. Mindestens 3 Fachbegriffe als <strong>markiert</strong>
2. Mindestens 2 Handlungssituationen (Entscheidung + Begründung)
3. Maßnahmen ableiten und bewerten
4. Expliziter Prüfungsbezug (IHK-Fortbildungsprüfung)
5. Strukturiert mit Überschriften + Listen
VERBOT: Keine reinen Reproduktionsinhalte. Fokus auf Handlungskompetenz.`,

  STUDIUM: `ELITE-PFLICHT-STRUKTUR (jede Lektion MUSS enthalten):
1. Mindestens 3 Fachbegriffe als <strong>markiert</strong>
2. Mindestens 2 konkrete Anwendungsbeispiele (Fallstudien, Modelle, empirische Befunde)
3. Typische Denkfehler/Fehlkonzepte mit wissenschaftlicher Korrektur
4. Expliziter Prüfungsbezug (Klausur-/Modulprüfungshinweis)
5. Strukturiert mit Überschriften (<h3>/<h4>) UND Listen (<ul>/<ol>)
VERBOT: Keine generischen Floskeln, keine "In der Wissenschaft ist es wichtig"-Sätze ohne konkrete Belege.`,
};

// ── MiniCheck prompts per persona ───────────────────────────────────────────

function buildPersonaMiniCheckPrompt(persona: PersonaProfile, professionName: string, context: string): string {
  switch (persona) {
    case "STUDIUM":
      return `7-8 Klausur-/Modulprüfungsfragen für ${professionName}.
${context}

VERTEILUNG: 2 Reproduktion (Wissen), 3 Anwendung (Transfer), 2-3 Analyse/Bewertung.
Anspruchsvoll = ≥2 Denkschritte + Modellvergleich oder kritische Reflexion.

PFLICHT: ≥2 Fallanalyse-Fragen, ≥1 Transferfrage, ≥1 Modellvergleich, ≥1 Bewertungsaufgabe.

DISTRAKTOREN (je 1 Fehlertyp):
A: Konzept-/Modellverwechslung | B: Anwendungsfehler | C: Kausalitätsfehler | D: Scheinkorrelation

ERKLÄRUNG pro Frage: Warum richtig? + Warum jede Option falsch? (Fehlertyp + Denkfehler) + "Merke/Tipp:" (1 Satz).
Keine "Was ist...?"-Fragen ohne Kontext. Keine offensichtlich falschen Distraktoren.`;

    case "AZUBI_HIGH_ROI":
      return buildMiniCheckPrompt(professionName, context);

    default:
      // LOW_ROI, SACHKUNDE, FACHWIRT — should not generate minichecks, but fallback
      return buildMiniCheckPrompt(professionName, context);
  }
}

/**
 * Build complete system + user prompts for the LLM call.
 * Now persona-aware instead of binary academic/vocational.
 */
export function buildLessonPrompts(
  req: LessonRequest,
  data: LessonData,
  ctx: LessonContext,
): LessonPrompts {
  const isAcademic = data.programType === "higher_education";

  // Resolve persona from package data (fallback to track-based)
  const personaPkg = {
    track: isAcademic ? "STUDIUM" : undefined,
    persona_profile: (data as any).personaProfile || null,
  };
  const personaConfig = getPersonaConfig(personaPkg);
  const persona = personaConfig.persona;

  // Select the correct step prompt set
  const stepPrompts = isAcademic ? STEP_PROMPTS_ACADEMIC : STEP_PROMPTS;
  const stepConfig = stepPrompts[req.stepKey] || stepPrompts.verstehen
    || STEP_PROMPTS[req.stepKey] || STEP_PROMPTS.verstehen;

  const userPrompt = req.isMiniCheck
    ? buildPersonaMiniCheckPrompt(persona, data.professionName, ctx.contextBlock)
    : `${stepConfig.system}\n\n${ctx.contextBlock}`;

  const roleBlock = `Du bist ${personaConfig.role} für ${data.professionName}. Schreibe wie ein ${personaConfig.role.split("(")[0].trim()}, nicht wie KI.`;

  const examBlock = EXAM_BLOCKS[persona];
  const eliteBlock = ELITE_BLOCKS[persona];

  const difficultyLine = data.lfData?.difficulty_tier === 'hard'
    ? isAcademic
      ? 'SCHWER: Mehrstufige Analysen, Modellvergleiche, kritische Reflexion, Transferaufgaben.'
      : 'SCHWER: Mehrstufige Berechnungen, Kombinationsaufgaben, Pro-Contra.'
    : '';

  const focusLine = data.lfData?.ihk_focus_areas?.length
    ? `${personaConfig.fieldLabel}-Schwerpunkte: ${data.lfData.ihk_focus_areas.join(", ")}`
    : '';

  const styleLine = `STIL: ${personaConfig.promptStyle}`;
  const depthLine = `ERKLÄRUNGSTIEFE: ${personaConfig.explanationDepth === 'deep' ? 'Ausführlich mit Beispielen' : personaConfig.explanationDepth === 'short' ? 'Kurz und prüfungsfokussiert' : 'Minimal — nur Fakten'}`;

  const systemPrompt = `${roleBlock}
${data.glossaryContext}
${examBlock}
${difficultyLine}
${focusLine}
${styleLine}
${depthLine}
Keine Floskeln. Keine Einleitungen. Direkt zum Inhalt.

${eliteBlock}

FORMAT: Antworte NUR mit validem JSON (kein Markdown, keine Fences).
${req.isMiniCheck
  ? '{"questions": [{"question": "...", "options": ["A","B","C","D"], "correct_answer": 0, "explanation": "..."}], "objectives": ["..."]}'
  : '{"html": "<h3>...</h3><p>...</p>", "objectives": ["..."], "key_terms": [{"term": "...", "definition": "...", "exam_relevance": "..."}], "common_mistakes": [{"mistake": "...", "correction": "...", "trap_type": "..."}], "exam_triggers": ["..."]}'}`;

  return { systemPrompt, userPrompt };
}
