// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAI, callAIWithFailover } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { getTutorOutputFormat, getTutorOutputFormatAcademic, SOURCE_CITATION_RULE, SOURCE_CITATION_RULE_ACADEMIC } from "../_shared/prompt-kit.ts";

/**
 * AI-Tutor – Profession-Aware + Deep Thinking + Post-Validation
 * 
 * SSOT-Konform: Context wird serverseitig per IDs geladen,
 * Client-Textfelder werden ignoriert.
 */

const AI_MODES = {
  LEARNING: 'learning',
  PRACTICE: 'practice',
  EXAM: 'exam'
} as const;

const AI_ROLES = {
  EXPLAINER: 'explainer',
  COACH: 'coach',
  EXAMINER: 'examiner',
  FEEDBACK: 'feedback',
  EXAM_TRANSFER: 'exam_transfer'
} as const;

type AIMode = typeof AI_MODES[keyof typeof AI_MODES];
type AIRole = typeof AI_ROLES[keyof typeof AI_ROLES];

/**
 * Mode system prompts are now FUNCTIONS that inject professionName
 * so the tutor always speaks in the context of the specific Berufsbild.
 */
type ProgramType = "vocational" | "higher_education";

function getModeRules(mode: AIMode, professionName: string, programType: ProgramType = "vocational"): { allowExplanations: boolean; systemPrompt: string } {
  if (programType === "higher_education") return getModeRulesAcademic(mode, professionName);
  const rules: Record<AIMode, { allowExplanations: boolean; systemPrompt: string }> = {
    [AI_MODES.LEARNING]: {
      allowExplanations: true,
      systemPrompt: `Du bist ein erfahrener IHK-Lern-Tutor für angehende ${professionName}.
Du kennst den Berufsalltag von ${professionName} genau und erklärst Zusammenhänge so, wie ein erfahrener Ausbilder im Betrieb es tun würde.

DEIN STIL:
- Erkläre mit konkreten Beispielen aus dem Arbeitsalltag von ${professionName}
- Nutze die Fachbegriffe, die ${professionName} täglich verwenden
- Gib praxisnahe Merkhilfen und Eselsbrücken
- Verweise auf typische IHK-Prüfungsfragen zum Thema
- Sei freundlich, ermutigend und pädagogisch wertvoll

FEHLERDIAGNOSE-MODUS (bei falschen Antworten):
- Identifiziere den KONKRETEN Denkfehler: "Du hast vermutlich [spezifischer Fehler] gemacht."
- Zeige den Fehler im Rechenweg/der Logik: "In Schritt 2 hast du [X] statt [Y] verwendet."
- Erkläre WARUM der Fehler häufig vorkommt: "Das ist eine typische Verwechslung, weil..."
- Gib eine Strategie zur Vermeidung: "Merktrick: Immer zuerst [X] prüfen, dann [Y]."
- NIEMALS nur sagen "Das ist falsch" — IMMER den Denkfehler präzise lokalisieren

PRÜFUNGSSTRATEGIE-COACHING:
- "In der IHK wird hier oft zuerst nach [X] gefragt. Achte darauf."
- "Zeitmanagement: Für diese Aufgabe solltest du ca. X Minuten einplanen."
- "Typische IHK-Falle bei diesem Thema: [konkret]"
- Generiere Transfer-Fragen: "Was würde sich ändern, wenn...?"

REGELN:
- Du referenzierst NUR das Curriculum und den SSOT-Kontext
- Erfinde KEINE Fakten, Gesetze oder Paragraphen
${SOURCE_CITATION_RULE}
- Deine Beispiele müssen zum Berufsbild ${professionName} passen`
    },
    [AI_MODES.PRACTICE]: {
      allowExplanations: true,
      systemPrompt: `Du bist ein Übungs-Tutor für angehende ${professionName} im Trainingsmodus.
Du simulierst typische Aufgaben und Situationen, die ${professionName} in der IHK-Prüfung und im Berufsalltag meistern müssen.

FEHLERDIAGNOSE (PFLICHT bei falscher Antwort):
1. LOKALISIERE den Fehler: "Du hast in Schritt [X] den Fehler gemacht, [konkreter Fehler]."
2. ERKLÄRE den Denkfehler: "Das passiert häufig, weil [Grund für den Fehler]."
3. ZEIGE den korrekten Weg: "Der richtige Rechenweg/die richtige Logik ist: [Schritte]."
4. GEBE Vermeidungsstrategie: "Merke dir: Immer zuerst [X] prüfen, bevor du [Y] machst."
5. STELLE Transferfrage: "Wie würde sich das Ergebnis ändern, wenn [Parameter] anders wäre?"

REGELN:
- Gib NIEMALS die Lösung BEVOR der Nutzer geantwortet hat
- Nach Antwort: Gib detailliertes Feedback mit Bezug zum Berufsalltag von ${professionName}
- Erkläre Denkfehler anhand konkreter beruflicher Situationen — NICHT generisch
- Zeige den korrekten Lösungsweg mit den Fachbegriffen von ${professionName}
- Bei Rechenaufgaben: Zeige JEDEN Schritt (Formel → Einsetzen → Zwischenergebnis → Ergebnis)
- Goldene Regel: Erst Antwort → dann Hilfe → dann Transferfrage`
    },
    [AI_MODES.EXAM]: {
      allowExplanations: false,
      systemPrompt: `Du bist ein Prüfungsassistent für ${professionName} im STRIKTEN PRÜFUNGSMODUS.
🚨 STRIKT VERBOTEN: Lösungen, Hinweise, Erklärungen, inhaltliche Hilfe.
✅ ERLAUBT: Organisatorisches, Technisches, Navigation, Zeitmanagement-Tipps.
Bei JEDER inhaltlichen Anfrage: "Im Prüfungsmodus kann ich keine inhaltliche Hilfe geben. Konzentriere dich auf die Aufgabe!"`
    }
  };
  return rules[mode];
}

function getModeRulesAcademic(mode: AIMode, subjectName: string): { allowExplanations: boolean; systemPrompt: string } {
  const rules: Record<AIMode, { allowExplanations: boolean; systemPrompt: string }> = {
    [AI_MODES.LEARNING]: {
      allowExplanations: true,
      systemPrompt: `Du bist ein erfahrener Hochschuldozent für ${subjectName}.
Du erklärst Zusammenhänge auf akademischem Niveau, wie ein Professor in der Sprechstunde.

DEIN STIL:
- Erkläre mit wissenschaftlichen Modellen, Theorien und empirischen Beispielen
- Nutze die akademische Fachterminologie für ${subjectName}
- Verweise auf typische Klausuraufgaben und Modulprüfungsformate
- Fordere kritisches Denken ein: "Warum gilt das nur unter bestimmten Annahmen?"
- Zeige Modellgrenzen und alternative Erklärungsansätze auf

FEHLERDIAGNOSE-MODUS (bei falschen Antworten):
- Identifiziere den KONKRETEN Denkfehler: "Dein Argumentationsfehler liegt in..."
- Zeige die fehlerhafte Annahme: "Du hast hier [Modell X] angewendet, obwohl [Bedingung Y] nicht erfüllt ist."
- Erkläre WARUM der Fehler häufig vorkommt: "Das ist ein typisches Missverständnis, weil..."
- Gib eine Strategie zur Vermeidung: "Prüfe immer zuerst, ob [Annahme] gegeben ist."

KLAUSURSTRATEGIE-COACHING:
- "In der Klausur wird hier oft nach der Begründung gefragt, nicht nur nach dem Ergebnis."
- "Zeitmanagement: Für diese Aufgabe solltest du ca. X Minuten einplanen."
- "Typischer Klausurfehler bei diesem Thema: [konkret]"
- Generiere Transfer-Fragen: "Was würde sich ändern, wenn sich die Rahmenbedingungen ändern?"

REGELN:
- Du referenzierst NUR den Curriculum-Kontext und akademische Quellen
- Erfinde KEINE Modelle, Autoren oder empirische Ergebnisse
${SOURCE_CITATION_RULE_ACADEMIC}
- Verwende NIEMALS IHK-Begriffe (Ausbilder, Betrieb, Berufsalltag, Azubi)
- Deine Sprache ist akademisch aber verständlich — kein Lehrbuchstil, sondern Sprechstunde`
    },
    [AI_MODES.PRACTICE]: {
      allowExplanations: true,
      systemPrompt: `Du bist ein Übungsleiter für ${subjectName} im akademischen Trainingsmodus.
Du simulierst typische Klausuraufgaben (Fallanalysen, Berechnungen, Transferaufgaben).

FEHLERDIAGNOSE (PFLICHT bei falscher Antwort):
1. LOKALISIERE den Fehler: "Dein Argumentationsfehler liegt in Schritt [X]."
2. ERKLÄRE den Denkfehler: "Das ist ein häufiges Missverständnis, weil [Grund]."
3. ZEIGE den korrekten Weg: "Die korrekte Argumentation wäre: [Schritte]."
4. GEBE Vermeidungsstrategie: "Prüfe immer zuerst, ob [Annahme] gegeben ist."
5. STELLE Transferfrage: "Wie verändert sich das Ergebnis bei veränderten Rahmenbedingungen?"

REGELN:
- Gib NIEMALS die Lösung BEVOR der Studierende geantwortet hat
- Nach Antwort: Gib detailliertes Feedback mit akademischem Tiefgang
- Erkläre Fehler anhand von Modellgrenzen und Annahmen — NICHT generisch
- Bei Rechenaufgaben: Zeige JEDEN Schritt (Formel → Einsetzen → Ergebnis → Interpretation)
- Goldene Regel: Erst Antwort → dann Feedback → dann Transferfrage
- Verwende NIEMALS IHK-Begriffe`
    },
    [AI_MODES.EXAM]: {
      allowExplanations: false,
      systemPrompt: `Du bist ein Klausurassistent für ${subjectName} im STRIKTEN KLAUSURMODUS.
🚨 STRIKT VERBOTEN: Lösungen, Hinweise, Erklärungen, inhaltliche Hilfe.
✅ ERLAUBT: Organisatorisches, Technisches, Navigation, Zeitmanagement-Tipps.
Bei JEDER inhaltlichen Anfrage: "Im Klausurmodus kann ich keine inhaltliche Hilfe geben. Konzentriere dich auf die Aufgabe!"`
    }
  };
  return rules[mode];
}

function getRolePrompt(role: AIRole, professionName: string, programType: ProgramType = "vocational"): string {
  if (programType === "higher_education") return getRolePromptAcademic(role, professionName);
  const prompts: Record<AIRole, string> = {
    [AI_ROLES.EXPLAINER]: `\nROLLE: Fach-Erklärer für ${professionName} – Erkläre Konzepte mit berufsspezifischen Analogien und Beispielen. Zerlege komplexe Themen in die Teilschritte, die ${professionName} im Arbeitsalltag durchführen. Bei Fehlern: Lokalisiere den KONKRETEN Denkfehler und zeige den korrekten Weg.
${getTutorOutputFormat("explainer", professionName)}`,
    [AI_ROLES.COACH]: `\nROLLE: Prüfungsstrategie-Coach für ${professionName} – Gib Tipps zur Lernstrategie und Prüfungstechnik. Identifiziere Wissenslücken und erstelle konkrete Lernpläne. Sage: "In der IHK wird hier oft [X] gefragt — achte auf [Y]." Motiviere bei schwierigen Themen mit dem Bezug zum Berufserfolg als ${professionName}.
${getTutorOutputFormat("coach", professionName)}`,
    [AI_ROLES.EXAMINER]: `\nROLLE: Prüfungs-Trainer für ${professionName} – Stelle Fragen im IHK-Prüfungsstil (Fallstudien, Berechnungen, Entscheidungsszenarien). Nach JEDER Antwort: 1) Bewerte Fachlichkeit + Struktur + Begriffssicherheit + Praxisbezug. 2) Bei Fehlern: Lokalisiere den EXAKTEN Denkfehler ("Du hast in Schritt X..."). 3) Gib Transferfrage ("Was wäre anders, wenn...?"). 4) Trainiere Zeitmanagement.
${getTutorOutputFormat("examiner", professionName)}`,
    [AI_ROLES.FEEDBACK]: `\nROLLE: Fehlerdiagnose-Experte für ${professionName} – Analysiere Leistung nach: Fachlichkeit (40%), Struktur (25%), Begriffssicherheit (20%), Praxisbezug (15%). Identifiziere KONKRETE Kompetenzlücken mit Bezug zum Lernfeld. Erstelle personalisierte Empfehlungen: "Du solltest [X] wiederholen, weil [Y]." Erstelle einen konkreten 48-Stunden-Lernplan bei Schwächen.
${getTutorOutputFormat("feedback", professionName)}`,
    [AI_ROLES.EXAM_TRANSFER]: `\nROLLE: Transfer-Tutor für ${professionName} – Du trainierst Studierende, Wissen in neuen Klausursituationen anzuwenden.

KERNPRINZIP: Nicht erklären, sondern weiterdenken lassen.

ANTWORTSTRUKTUR (PFLICHT):
1. KURZES FEEDBACK zum bisherigen Stand (max 2 Sätze)
2. TRANSFERFRAGE: Variiere den Kontext leicht, erzwinge Anwendung statt Reproduktion
3. TYPISCHE FEHLERQUELLE: Nenne den häufigsten Denkfehler aus dem Blueprint
4. OPTIONAL: Zweite Vertiefungsfrage bei teilweise richtiger Antwort

REGELN:
- Gib NIEMALS die volle Lösung sofort
- Stelle 1–3 gezielte Anschlussfragen
- Wenn der Studierende nur auswendig wiedergibt: Unterbrich und lenke auf Entscheidung, Begründung oder Anwendung
- Nutze typische Fehler und Misconceptions aus dem Blueprint-Kontext
- Erzwinge Transfer: "Was passiert, wenn sich die Ausgangsbedingung ändert?"

${getTutorOutputFormat("examiner", professionName)}`
  };
  return prompts[role];
}

function getRolePromptAcademic(role: AIRole, subjectName: string): string {
  const outputFmt = getTutorOutputFormatAcademic;
  const prompts: Record<AIRole, string> = {
    [AI_ROLES.EXPLAINER]: `\nROLLE: Akademischer Erklärer für ${subjectName} – Erkläre Konzepte mit wissenschaftlichen Modellen und empirischen Beispielen. Zeige Modellgrenzen und alternative Erklärungsansätze auf. Bei Fehlern: Identifiziere die fehlerhafte Annahme und zeige den korrekten Argumentationspfad.
${outputFmt("explainer", subjectName)}`,
    [AI_ROLES.COACH]: `\nROLLE: Klausurstrategie-Coach für ${subjectName} – Gib Tipps zur Lernstrategie und Klausurtechnik. Identifiziere Verständnislücken und erstelle konkrete Lernpläne. Sage: "In der Klausur wird hier typischerweise [X] gefragt — achte auf [Y]." Zeige Verbindungen zwischen Modulthemen auf.
${outputFmt("coach", subjectName)}`,
    [AI_ROLES.EXAMINER]: `\nROLLE: Klausur-Trainer für ${subjectName} – Stelle Fragen im Modulprüfungsstil (Fallanalysen, Berechnungen, Argumentationsaufgaben). Nach JEDER Antwort: 1) Bewerte Fachlichkeit + Argumentationsstruktur + Begriffsgenauigkeit + Transferleistung. 2) Bei Fehlern: Identifiziere die fehlerhafte Annahme. 3) Gib Transferfrage. 4) Trainiere Zeitmanagement.
${outputFmt("examiner", subjectName)}`,
    [AI_ROLES.FEEDBACK]: `\nROLLE: Akademischer Feedback-Experte für ${subjectName} – Analysiere Leistung nach: Fachlichkeit (40%), Argumentationsstruktur (25%), Begriffsgenauigkeit (20%), Transferleistung (15%). Identifiziere KONKRETE Verständnislücken. Erstelle personalisierte Empfehlungen mit akademischem Bezug.
${outputFmt("feedback", subjectName)}`,
    [AI_ROLES.EXAM_TRANSFER]: `\nROLLE: Akademischer Transfer-Tutor für ${subjectName} – Du trainierst Studierende, Wissen in neuen Klausursituationen anzuwenden.

KERNPRINZIP: Nicht erklären, sondern weiterdenken lassen.

ANTWORTSTRUKTUR (PFLICHT):
1. KURZES FEEDBACK zum bisherigen Stand (max 2 Sätze)
2. TRANSFERFRAGE: Variiere den Kontext leicht, erzwinge Anwendung statt Reproduktion
3. TYPISCHE FEHLERQUELLE: Nenne den häufigsten Denkfehler aus dem Blueprint
4. OPTIONAL: Zweite Vertiefungsfrage bei teilweise richtiger Antwort

REGELN:
- Gib NIEMALS die volle Lösung sofort
- Stelle 1–3 gezielte Anschlussfragen
- Wenn der Studierende nur auswendig wiedergibt: Unterbrich und lenke auf Entscheidung, Begründung oder Anwendung
- Nutze typische Fehler und Misconceptions aus dem Blueprint-Kontext
- Erzwinge Transfer: "Was passiert, wenn sich die Rahmenbedingungen ändern?"
- Verwende NIEMALS IHK-Begriffe (Ausbilder, Betrieb, Azubi)

${outputFmt("examiner", subjectName)}`
  };
  return prompts[role];
}

function isAllowedInExamMode(message: string): boolean {
  const lower = message.toLowerCase();
  const allowed = [/zeit|timer|uhr|minuten/, /speichern|gespeichert/, /nächste|vorherige|navigation/, /technisch|fehler|problem|lädt nicht/];
  for (const p of allowed) if (p.test(lower)) return true;
  const blocked = [/erkläre?|erklärung/, /was ist|was sind|was bedeutet/, /wie funktioniert/, /warum|weshalb/, /lösung|antwort|richtig/, /hilf mir/, /beispiel|zeig mir/];
  for (const p of blocked) if (p.test(lower)) return false;
  return true;
}

async function sha256(message: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SSOT Context Loader – loads context server-side by IDs
 */
async function loadSSOTContext(
  supabase: ReturnType<typeof createClient>,
  context: Record<string, unknown>
): Promise<{ contextPrompt: string; resolvedContext: Record<string, unknown>; professionName: string; programType: ProgramType }> {
  const { curriculumId, learningFieldId, competencyId, lessonId, lessonStep, miniCheckScore } = context;
  
  const resolved: Record<string, unknown> = {};
  const parts: string[] = [];
  let professionName = "Auszubildende";
  let programType: ProgramType = "vocational";

  // Load curriculum + profession name via SSOT resolver
  if (curriculumId) {
    const { data } = await supabase
      .from('curricula')
      .select('id, title, beruf_id')
      .eq('id', curriculumId)
      .single();
    if (data) {
      resolved.curriculum = data;
      parts.push(`Curriculum: ${data.title}`);
    }
    
    // Use shared resolver (user-facing, so allow generic fallback)
    try {
      const profResult = await resolveProfession(supabase, { curriculumId, allowGenericFallback: true });
      professionName = profResult.professionName;
    } catch {
      // For tutor, allow generic fallback
      professionName = "Auszubildende";
    }
    parts.push(`Beruf: ${professionName}`);
    resolved.professionName = professionName;
  }

  // Load learning field
  if (learningFieldId) {
    const { data } = await supabase
      .from('learning_fields')
      .select('id, title, code, description')
      .eq('id', learningFieldId)
      .single();
    if (data) {
      resolved.learningField = data;
      parts.push(`Lernfeld ${data.code}: ${data.title}`);
      if (data.description) parts.push(`Beschreibung: ${data.description}`);
    }
  }

  // Load competency
  if (competencyId) {
    const { data } = await supabase
      .from('competencies')
      .select('id, title, code, description, taxonomy_level')
      .eq('id', competencyId)
      .single();
    if (data) {
      resolved.competency = data;
      parts.push(`Kompetenz ${data.code}: ${data.title}`);
      if (data.taxonomy_level) parts.push(`Taxonomie: ${data.taxonomy_level}`);
      if (data.description) parts.push(`Beschreibung: ${data.description}`);
    }
  }

  // Load lesson content
  if (lessonId) {
    const { data } = await supabase
      .from('lessons')
      .select('id, title, step, content, competency_id')
      .eq('id', lessonId)
      .single();
    if (data) {
      resolved.lesson = { id: data.id, title: data.title, step: data.step };
      parts.push(`Lektion: ${data.title} (Schritt: ${data.step})`);
      const content = data.content as Record<string, unknown> | null;
      if (content?.objectives) {
        parts.push(`Lernziele: ${(content.objectives as string[]).join(', ')}`);
      }
    }
  }

  if (lessonStep) {
    parts.push(`Aktueller Schritt: ${lessonStep}`);
    resolved.lessonStep = lessonStep;
  }

  if (miniCheckScore !== undefined && miniCheckScore !== null) {
    parts.push(`MiniCheck-Ergebnis: ${miniCheckScore}%`);
    resolved.miniCheckScore = miniCheckScore;
  }

  // ── Learning Intelligence Context via build-learning-context ──
  if (curriculumId && context._userId) {
    try {
      const [readinessRes, gapsRes, recsRes] = await Promise.all([
        supabase
          .from('v_user_current_readiness')
          .select('readiness_score, risk_level, confidence_score, mastered_count, partial_count, not_mastered_count, weak_competencies')
          .eq('user_id', context._userId)
          .eq('curriculum_id', curriculumId)
          .maybeSingle(),
        supabase
          .from('v_user_top_gaps')
          .select('competency_title, competency_code, learning_field_code, learning_field_title, accuracy_pct, gap_type, weakness_score')
          .eq('user_id', context._userId)
          .eq('curriculum_id', curriculumId)
          .order('weakness_score', { ascending: false })
          .limit(5),
        supabase
          .from('v_user_active_recommendations')
          .select('recommendation_type, target_meta, reason_text, reason_code')
          .eq('user_id', context._userId)
          .eq('curriculum_id', curriculumId)
          .limit(3),
      ]);

      if (readinessRes.data) {
        const r = readinessRes.data;
        resolved.readiness = r;
        parts.push(`\nPRÜFUNGSREIFE: ${r.readiness_score}% (${r.risk_level})`);
        parts.push(`Beherrschte Kompetenzen: ${r.mastered_count}, teilweise: ${r.partial_count}, nicht beherrscht: ${r.not_mastered_count}`);
        
        // Coaching mode hint based on readiness
        const suggestedRole = !r.readiness_score || r.readiness_score < 40 ? 'explainer'
          : r.readiness_score < 70 ? 'coach' : 'examiner';
        parts.push(`EMPFOHLENER MODUS: ${suggestedRole}`);
      }

      if (gapsRes.data && gapsRes.data.length > 0) {
        resolved.topGaps = gapsRes.data;
        const gapLines = gapsRes.data.map((g: Record<string, unknown>) =>
          `- ${g.competency_code} ${g.competency_title} (${g.learning_field_code}): ${g.accuracy_pct}% Trefferquote, Typ: ${g.gap_type}`
        );
        parts.push(`\nTOP-SCHWÄCHEN des Lernenden:\n${gapLines.join('\n')}`);
        parts.push('WICHTIG: Beziehe dich auf diese Schwächen, wenn es thematisch passt. Erkläre gezielt Themen, in denen der Lernende Lücken hat.');
      }

      if (recsRes.data && recsRes.data.length > 0) {
        resolved.recommendations = recsRes.data;
        const recLines = recsRes.data.map((r: Record<string, unknown>) =>
          `- ${r.recommendation_type}: ${r.reason_text}`
        );
        parts.push(`\nAKTIVE EMPFEHLUNGEN:\n${recLines.join('\n')}`);
      }
    } catch (e) {
      console.warn('[ai-tutor] Learning context enrichment failed:', e);
    }
  }

  const contextPrompt = parts.length > 0
    ? `\n\n--- SSOT-KONTEXT (serverseitig geladen) ---\n${parts.join('\n')}`
    : '';

  return { contextPrompt, resolvedContext: resolved, professionName };
}

/**
 * Post-hoc Validation via ai-client (routed through model-routing)
 */
async function postValidateTutorResponse(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  prompt: string,
  response: string,
  resolvedContext: Record<string, unknown>,
  generationId: string,
  professionName: string,
) {
  try {
    const startTime = Date.now();
    // Use failover chain for validation (non-streaming)
    const valChain = await getModelChainAsync("council_review");
    const valResult = await callAIWithFailover(
      valChain.map(c => ({ provider: c.provider, model: c.model })),
      {
        messages: [
          { role: "system", content: `Du prüfst eine KI-Tutor-Antwort für ${professionName} auf fachliche Korrektheit. SCHNELL und PRÄZISE.
Kontext: ${JSON.stringify(resolvedContext).slice(0, 3000)}

PRÜFE:
1. Alle Fakten korrekt für den Beruf ${professionName}?
2. Keine erfundenen Gesetze/Paragraphen/Normen?
3. Fachbegriffe korrekt verwendet (so wie ${professionName} sie nutzen)?
4. Berufsbezug vorhanden (nicht generisch)?

Antworte NUR mit JSON:
{"score": 0-100, "decision": "approve|revise|reject", "correction_needed": false, "correction": null, "issues": []}` },
          { role: "user", content: `FRAGE: ${prompt}\n\nTUTOR-ANTWORT: ${response}` }
        ],
        temperature: 0.2,
      },
    );

    const latencyMs = Date.now() - startTime;
    const rawText = valResult.content || "";
    
    let result;
    try {
      result = JSON.parse(rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch { return; }

    await supabase.from("ai_validations").insert({
      generation_id: generationId,
      validator_model: "anthropic/claude-3-5-haiku-20241022",
      validation_mode: "automatic",
      overall_score: result.score || 0,
      decision: result.decision || "approve",
      dimension_scores: { fachlichkeit: result.score || 0 },
      critical_issues: result.issues || [],
      suggested_fixes: result.correction_needed ? [{ type: "correction", reason: result.correction }] : [],
      corrected_content: result.correction_needed ? { correction: result.correction } : null,
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
      cost_eur: 0,
      latency_ms: latencyMs,
    });

    await supabase.from("ai_generations").update({
      validation_decision: result.decision,
      validation_score: result.score,
      status: result.decision === "approve" ? "validated" : "draft",
    }).eq("id", generationId);

    if (result.correction_needed && result.correction) {
      console.log(`[Tutor PostVal] Correction needed for generation ${generationId}: ${result.correction}`);
    }
  } catch (err) {
    console.error("[Tutor PostVal] Error:", err);
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { message, mode, role = 'explainer', sessionId, sessionType = 'learning', conversationHistory = [], context = {}, mastery_context } = await req.json();

    const validMode = Object.values(AI_MODES).includes(mode) ? mode : AI_MODES.LEARNING;
    const validRole = Object.values(AI_ROLES).includes(role) ? role : AI_ROLES.EXPLAINER;

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    // Inject user_id into context so loadSSOTContext can filter by user
    if (user) context._userId = user.id;
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── SSOT Context Loader (server-side) ──
    const { contextPrompt, resolvedContext, professionName } = await loadSSOTContext(supabase, context);

    // ── Wave 3D: Mastery-aware role steering ──
    let effectiveRole = validRole as AIRole;
    if (mastery_context?.user_id && mastery_context?.curriculum_id) {
      try {
        const { data: readinessData } = await supabase.rpc("compute_readiness", {
          p_user_id: mastery_context.user_id,
          p_curriculum_id: mastery_context.curriculum_id,
        });
        if (readinessData && effectiveRole === AI_ROLES.EXPLAINER) {
          const risk = (readinessData as Record<string, unknown>).risk_level;
          if (risk === "low") effectiveRole = AI_ROLES.EXAMINER;
          else if (risk === "medium") effectiveRole = AI_ROLES.COACH;
          // high stays explainer
        }

        // Inject weakness context into prompt
        const { data: weakData } = await supabase
          .from("v_user_weakness_map")
          .select("competency_title, learning_field_title, mastery_level, score")
          .eq("user_id", mastery_context.user_id)
          .eq("curriculum_id", mastery_context.curriculum_id)
          .order("score", { ascending: true })
          .limit(5);

        if (weakData?.length) {
          const weakLines = weakData.map((w: Record<string, unknown>) =>
            `- ${w.competency_title} (${w.learning_field_title}) — ${Math.round(Number(w.score || 0) * 100)}% Score, Level: ${w.mastery_level}`
          );
          resolvedContext._masteryWeaknesses = weakData;
          resolvedContext._masteryReadiness = readinessData;
        }
      } catch (e) {
        console.warn("[ai-tutor] Mastery context enrichment failed:", e);
      }
    }

    // ── Exam Transfer Routing: auto-activate for higher_education programs ──
    let blueprintContext = "";
    if (context.competencyId || context.curriculumId) {
      try {
        // Check if this is a higher_education program
        let isHigherEd = false;
        if (context.curriculumId) {
          const { data: prog } = await supabase
            .from("programs")
            .select("program_type")
            .eq("id", (await supabase.from("curricula").select("program_id").eq("id", context.curriculumId).single()).data?.program_id)
            .single();
          isHigherEd = prog?.program_type === "higher_education";
        }

        // Load matching blueprint for this competency
        if (context.competencyId) {
          const { data: blueprints } = await supabase
            .from("question_blueprints")
            .select("name, canonical_statement, knowledge_type, cognitive_level, typical_exam_trap, trap_definition, typical_errors, rubric, exam_context_type, didactic_intent")
            .eq("competency_id", context.competencyId)
            .in("status", ["draft", "review", "approved"])
            .limit(3);

          if (blueprints?.length) {
            const bpParts: string[] = ["\n--- BLUEPRINT-KONTEXT ---"];
            for (const bp of blueprints) {
              bpParts.push(`Blueprint: ${bp.name}`);
              bpParts.push(`Kanonische Aussage: ${bp.canonical_statement}`);
              bpParts.push(`Wissenstyp: ${bp.knowledge_type}, Kognitionsstufe: ${bp.cognitive_level}`);
              if (bp.typical_exam_trap) bpParts.push(`Typische Prüfungsfalle: ${bp.typical_exam_trap}`);
              if (bp.trap_definition) {
                const trap = bp.trap_definition as Record<string, unknown>;
                if (trap.misconception) bpParts.push(`Misconception: ${trap.misconception}`);
                if (trap.error_model) bpParts.push(`Fehlermodell: ${trap.error_model}`);
              }
              if (bp.typical_errors && Array.isArray(bp.typical_errors)) {
                const errLines = (bp.typical_errors as Array<Record<string, unknown>>)
                  .map(e => `  - ${e.error} (Häufigkeit: ${e.frequency})`);
                if (errLines.length) bpParts.push(`Typische Fehler:\n${errLines.join("\n")}`);
              }
              if (bp.rubric) {
                const rubric = bp.rubric as Record<string, number>;
                const rubricStr = Object.entries(rubric).map(([k, v]) => `${k}: ${Math.round(v * 100)}%`).join(", ");
                bpParts.push(`Bewertungsraster: ${rubricStr}`);
              }
              bpParts.push("---");
            }
            blueprintContext = bpParts.join("\n");
            resolvedContext._blueprints = blueprints;

            // Auto-route to exam_transfer for higher_education when blueprint supports it
            if (isHigherEd && effectiveRole !== AI_ROLES.EXAM_TRANSFER) {
              const bp = blueprints[0];
              const cogLevel = bp.cognitive_level;
              const hasTrap = !!(bp.trap_definition || bp.typical_exam_trap);
              const hasErrors = Array.isArray(bp.typical_errors) && (bp.typical_errors as unknown[]).length > 0;

              if (["apply", "analyze", "evaluate"].includes(cogLevel) && (hasTrap || hasErrors)) {
                effectiveRole = AI_ROLES.EXAM_TRANSFER;
                console.log(`[ai-tutor] Auto-routed to exam_transfer for higher_education (cognitive_level=${cogLevel})`);
              }
            }
          }
        }
      } catch (e) {
        console.warn("[ai-tutor] Blueprint/exam_transfer routing failed:", e);
      }
    }

    // Now build mode and role prompts WITH profession name
    const modeRules = getModeRules(validMode as AIMode, professionName);
    const rolePrompt = getRolePrompt(effectiveRole, professionName);

    // Exam mode block
    if (validMode === AI_MODES.EXAM && !isAllowedInExamMode(message)) {
      const blocked = 'Im Prüfungsmodus kann ich keine inhaltliche Hilfe geben. Konzentriere dich auf die Aufgabe!';
      await logInteraction(supabase, user.id, sessionId, sessionType, validMode, message, blocked, 0, true, 'Inhaltliche Anfrage im Prüfungsmodus', conversationHistory.length);
      return new Response(JSON.stringify({ response: blocked, mode: validMode, wasBlocked: true, blockReason: 'exam_mode' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const systemPrompt = modeRules.systemPrompt + rolePrompt + contextPrompt + blueprintContext;
    const aiMessages = [
      { role: "system" as const, content: systemPrompt },
      ...conversationHistory.slice(-10).map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: message }
    ];

    // Create generation record BEFORE streaming
    const { data: genRecord } = await supabase.from("ai_generations").insert({
      entity_type: "tutor_response",
      generator_model: "lovable/gpt-5",
      input_context: { mode: validMode, role: validRole, context: resolvedContext, prompt: message, profession: professionName },
      output_content: {},
      status: "generated",
      created_by: user.id,
    }).select("id").single();

    const generationId = genRecord?.id;

    // Stream with manual failover: try primary, fallback to secondary
    const streamChain = await getModelChainAsync("support");
    let aiResponse: Response | null = null;
    let streamOk = false;
    let streamStatus = 0;

    for (const candidate of streamChain) {
      try {
        const attempt = await callAI({
          provider: candidate.provider,
          model: candidate.model,
          messages: aiMessages,
          stream: true,
        });
        aiResponse = attempt.raw;
        streamOk = attempt.ok;
        streamStatus = attempt.status;
        if (streamOk) break;
        console.warn(`[ai-tutor] Provider ${candidate.provider}/${candidate.model} returned ${streamStatus}, trying next...`);
      } catch (e) {
        console.warn(`[ai-tutor] Provider ${candidate.provider}/${candidate.model} failed:`, e);
        continue;
      }
    }

    if (!streamOk || !aiResponse) {
      if (streamStatus === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Bitte später erneut versuchen." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (streamStatus === 402) {
        return new Response(JSON.stringify({ error: "AI-Kontingent erschöpft." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      throw new Error(`All AI providers failed: ${streamStatus}`);
    }

    // Stream through + collect for post-validation
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = aiResponse.body!.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    let fullResponse = "";

    (async () => {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          await writer.write(encoder.encode(chunk));

          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) fullResponse += content;
            } catch { /* partial */ }
          }
        }
      } catch (e) {
        console.error("[ai-tutor] stream error:", e);
      } finally {
        writer.close();

        if (generationId) {
          await supabase.from("ai_generations").update({
            output_content: { response: fullResponse },
          }).eq("id", generationId);
        }

        logInteraction(supabase, user.id, sessionId, sessionType, validMode, message, fullResponse, 0, false, null, conversationHistory.length).catch(console.error);

        if (generationId && validMode !== AI_MODES.EXAM) {
          postValidateTutorResponse(supabase, user.id, message, fullResponse, resolvedContext, generationId, professionName).catch(console.error);
        }
      }
    })();

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });

  } catch (error) {
    console.error("AI Tutor error:", error);
    const origin = req.headers.get('origin');
    const corsHeaders = getCorsHeaders(origin);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function logInteraction(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  sessionId: string | null,
  sessionType: string,
  mode: string,
  prompt: string,
  response: string,
  tokensUsed: number,
  wasBlocked: boolean,
  blockReason: string | null,
  conversationLength: number
) {
  const [promptHash, responseHash] = await Promise.all([sha256(prompt), sha256(response)]);
  await supabase.from('ai_tutor_logs').insert({
    user_id: userId,
    session_id: sessionId || null,
    session_type: sessionType,
    mode,
    prompt_hash: promptHash,
    response_hash: responseHash,
    prompt_length: prompt.length,
    response_length: response.length,
    tokens_used: tokensUsed,
    was_blocked: wasBlocked,
    block_reason: blockReason,
    metadata: { conversation_length: conversationLength, generator: "openai/gpt-5-mini", validation: "async_google" },
  });
}