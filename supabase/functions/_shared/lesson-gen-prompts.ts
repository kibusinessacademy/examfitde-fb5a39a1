/**
 * lesson-gen-prompts.ts — Step prompts, tool schemas, and constants
 * for lesson-generate-content. Extracted to reduce bundle size.
 * 
 * v2: Program-type-aware — academic vs. vocational step prompts.
 */

import { DEPTH_SELF_CHECK, DEPTH_SELF_CHECK_ACADEMIC, REGULATORY_GUARD, REGULATORY_GUARD_ACADEMIC, buildMiniCheckPrompt } from "./prompt-kit.ts";

// Re-export for convenience
export { buildMiniCheckPrompt };

// ─── Vocational (IHK) step prompts ──────────────────────────────────────────

export const STEP_PROMPTS: Record<string, { system: string; minChars: number; minWords: number }> = {
  einstieg: {
    system: `Erstelle eine **aktivierende Einstiegsaktivität** (IHK-Prüfungsvorbereitung, 250+ Wörter).

OUTPUT-STRUKTUR (Wortlimits einhalten!):
1. <h3>Motivierender Titel</h3>
2. Praxisszenario aus dem Arbeitsalltag (120+ Wörter, konkrete Zahlen/Rollen)
3. 2-3 Reflexionsfragen als <ul><li>, davon 1 Hypothese ("Was glaubst du, warum...?")
4. ⭐ IHK-Prüfungstipp + ⚠️ Prüfungsfalle

Kein passiver Einstieg. Direkt ins Szenario.
${DEPTH_SELF_CHECK}
${REGULATORY_GUARD}`,
    minChars: 600,
    minWords: 250,
  },
  verstehen: {
    system: `Erstelle **Lernmaterial** (IHK-Prüfungsvorbereitung, 400+ Wörter).

OUTPUT-STRUKTUR:
1. <h3>Konzept-Titel</h3> + Definition mit Gegenbeispiel (80+ Wörter)
2. 3 Praxisbeispiele (je 40+ Wörter, verschiedene Schwierigkeitsgrade)
3. Fachbegriffe als <strong>, Merksätze als <blockquote> mit ⭐
4. ⭐ IHK-Prüfungstipp ×2 + ⚠️ Prüfungsfallen ×2 (mit Denkfehler-Erklärung)
5. Bei Rechnung: vollständiger Rechenweg. Bei Recht: konkrete §§.

Bloom: 30% Reproduktion, 40% Anwendung, 30% Transfer.
${DEPTH_SELF_CHECK}
${REGULATORY_GUARD}`,
    minChars: 1800,
    minWords: 400,
  },
  anwenden: {
    system: `Erstelle ein **Entscheidungsszenario mit Fallstudie** (IHK-Niveau, 350+ Wörter).

OUTPUT-STRUKTUR:
1. <h3>Fallstudie: [Titel]</h3>
2. Situationsbeschreibung (100+ Wörter, konkrete Zahlen/Rollen/Parameter)
3. 3-4 Teilaufgaben mit steigender Komplexität
4. ≥2 Entscheidungsoptionen mit Pro-Contra + Begründungspflicht
5. ⚠️ Prüfungsfallen markiert

Jede Aufgabe ≥2 Denkschritte. Keine 1-Fakt-Aufgaben.
${DEPTH_SELF_CHECK}
${REGULATORY_GUARD}`,
    minChars: 1400,
    minWords: 350,
  },
  wiederholen: {
    system: `Erstelle eine **PRÜFUNGSVERDICHTUNG** mit Retrieval-Mechanik (300+ Wörter).

OUTPUT-STRUKTUR:
1. <h3>Prüfungsverdichtung</h3>
2. 3 Leitfragen (Azubi antwortet vor Lösung)
3. 5-7 Merksätze mit Fachbegriffen
4. 1 Abgrenzungstabelle als <table>
5. 3 Prüfungsfallen mit Korrektur
6. 2 Transferübungen mit Musterlösung

KEINE erneute Erklärung. NUR Verdichtung + aktive Wiederholung.
${DEPTH_SELF_CHECK}`,
    minChars: 1200,
    minWords: 300,
  },
};

// ─── Academic (Higher Education) step prompts ───────────────────────────────

export const STEP_PROMPTS_ACADEMIC: Record<string, { system: string; minChars: number; minWords: number }> = {
  einstieg: {
    system: `Erstelle eine **aktivierende Einstiegsaktivität** (Klausur-/Modulprüfungsvorbereitung, 250+ Wörter).

OUTPUT-STRUKTUR (Wortlimits einhalten!):
1. <h3>Motivierender Titel</h3>
2. Fallszenario aus dem akademischen/beruflichen Kontext (120+ Wörter, konkrete Parameter/Daten)
3. 2-3 Reflexionsfragen als <ul><li>, davon 1 Hypothese ("Welche theoretischen Erklärungen gibt es für...?")
4. 📌 Klausurtipp + ⚠️ Typischer Denkfehler

Kein passiver Einstieg. Direkt in die Problemstellung.
${DEPTH_SELF_CHECK_ACADEMIC}
${REGULATORY_GUARD_ACADEMIC}`,
    minChars: 600,
    minWords: 250,
  },
  verstehen: {
    system: `Erstelle **Lernmaterial** (Klausur-/Modulprüfungsvorbereitung, 400+ Wörter).

OUTPUT-STRUKTUR:
1. <h3>Konzept-Titel</h3> + wissenschaftliche Definition mit Gegenbeispiel (80+ Wörter)
2. 3 Anwendungsbeispiele (je 40+ Wörter, verschiedene Komplexitätsgrade — Fallstudien, empirische Befunde)
3. Fachbegriffe als <strong>, Merksätze als <blockquote> mit 📌
4. 📌 Klausurtipp ×2 + ⚠️ Typische Denkfehler ×2 (mit wissenschaftlicher Korrektur)
5. Bei Modellen: Annahmen + Grenzen. Bei Theorien: Quellenverweise.

Bloom: 20% Reproduktion, 40% Anwendung, 40% Analyse/Transfer.
${DEPTH_SELF_CHECK_ACADEMIC}
${REGULATORY_GUARD_ACADEMIC}`,
    minChars: 1800,
    minWords: 400,
  },
  anwenden: {
    system: `Erstelle ein **Entscheidungsszenario mit Fallanalyse** (Klausurniveau, 350+ Wörter).

OUTPUT-STRUKTUR:
1. <h3>Fallanalyse: [Titel]</h3>
2. Situationsbeschreibung (100+ Wörter, konkrete Daten/Parameter/Kontextfaktoren)
3. 3-4 Teilaufgaben mit steigender Komplexität (Analyse → Bewertung → Gestaltung)
4. ≥2 Lösungsansätze mit theoretischer Begründung + Pro-Contra
5. ⚠️ Typische Klausurfehler markiert

Jede Aufgabe ≥2 Denkschritte + Modellbezug. Keine 1-Fakt-Aufgaben.
${DEPTH_SELF_CHECK_ACADEMIC}
${REGULATORY_GUARD_ACADEMIC}`,
    minChars: 1400,
    minWords: 350,
  },
  reflektieren: {
    system: `Erstelle eine **kritische Reflexionsaufgabe** (Modulprüfungsniveau, 300+ Wörter).

OUTPUT-STRUKTUR:
1. <h3>Kritische Reflexion: [Thema]</h3>
2. Gegenüberstellung zweier Theorien/Modelle/Ansätze (je 60+ Wörter)
3. 2-3 Leitfragen zur kritischen Auseinandersetzung (z.B. "Unter welchen Bedingungen versagt Modell X?")
4. Bewertungsmatrix oder Vergleichstabelle als <table>
5. 📌 Klausurhinweis: Wie wird Reflexionskompetenz in Prüfungen bewertet?

Ziel: Eigenständige Urteilsbildung, nicht Reproduktion.
Bloom: Analyze + Evaluate.
${DEPTH_SELF_CHECK_ACADEMIC}`,
    minChars: 1200,
    minWords: 300,
  },
  transfer: {
    system: `Erstelle eine **Transferaufgabe** (Modulprüfungsniveau, 350+ Wörter).

OUTPUT-STRUKTUR:
1. <h3>Transfer: [Titel]</h3>
2. Neues Anwendungsszenario, das gelerntes Wissen in unbekanntem Kontext erfordert (100+ Wörter)
3. 2-3 Transferfragen: Konzepte auf neue Branchen/Situationen/Problemstellungen übertragen
4. ≥1 interdisziplinärer Bezug (z.B. BWL ↔ VWL, Recht ↔ Ethik)
5. Musterlösung mit Begründungskette (nicht nur Ergebnis)
6. ⚠️ Typischer Transferfehler + Korrektur

Keine Wiederholung des Einstiegsszenarios. Neuer Kontext = echter Transfer.
Bloom: Apply + Analyze + Create.
${DEPTH_SELF_CHECK_ACADEMIC}
${REGULATORY_GUARD_ACADEMIC}`,
    minChars: 1400,
    minWords: 350,
  },
  wiederholen: {
    system: `Erstelle eine **KLAUSURVERDICHTUNG** mit Retrieval-Mechanik (300+ Wörter).

OUTPUT-STRUKTUR:
1. <h3>Klausurverdichtung</h3>
2. 3 Leitfragen (Studierende beantworten vor Musterlösung)
3. 5-7 Kernaussagen mit Fachbegriffen und Modellbezügen
4. 1 Abgrenzungstabelle als <table> (Theorie A vs. Theorie B)
5. 3 typische Klausurfehler mit wissenschaftlicher Korrektur
6. 2 Transferübungen mit Musterlösung

KEINE erneute Erklärung. NUR Verdichtung + aktive Wiederholung.
${DEPTH_SELF_CHECK_ACADEMIC}`,
    minChars: 1200,
    minWords: 300,
  },
};

export const CONTENT_TOOL = {
  type: "function" as const,
  function: {
    name: "create_lesson_content",
    description: "Erstelle strukturierten Lerninhalt für eine Lektion.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "HTML-Inhalt der Lektion" },
        objectives: { type: "array", items: { type: "string" } },
        key_terms: { type: "array", items: { type: "object", properties: { term: { type: "string" }, definition: { type: "string" }, exam_relevance: { type: "string" } }, required: ["term", "definition", "exam_relevance"] } },
        common_mistakes: { type: "array", items: { type: "object", properties: { mistake: { type: "string" }, correction: { type: "string" }, trap_type: { type: "string" } }, required: ["mistake", "correction", "trap_type"] } },
        exam_triggers: { type: "array", items: { type: "string" } },
        transfer_questions: { type: "array", items: { type: "string" } },
      },
      required: ["html", "objectives", "key_terms", "common_mistakes", "exam_triggers"],
      additionalProperties: false,
    },
  },
};

export const MINICHECK_TOOL = {
  type: "function" as const,
  function: {
    name: "create_mini_check",
    description: "Erstelle 7-8 MiniCheck-Fragen zur Wissensüberprüfung mit Schwierigkeitsverteilung.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array", minItems: 7, maxItems: 8,
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "Fragetext mit konkretem Szenario" },
              options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
              correct_answer: { type: "integer", minimum: 0, maximum: 3 },
              explanation: { type: "string", description: "Erklärung: warum richtig + warum jeder Distraktor falsch ist (mind. 80 Zeichen)" },
              difficulty: { type: "string", enum: ["leicht", "mittel", "anspruchsvoll"], description: "Verteilung: 2 leicht, 3 mittel, 2-3 anspruchsvoll" },
              bloom_level: { type: "string", enum: ["remember", "understand", "apply", "analyze", "evaluate"], description: "Kognitive Stufe nach Bloom" },
              trap_type: { type: "string", description: "Art der Prüfungsfalle (z.B. 'Normverwechslung', 'Rechenfehler', 'False Friend'). Mind. 8 Zeichen wenn vorhanden." },
            },
            required: ["question", "options", "correct_answer", "explanation", "difficulty", "bloom_level"],
          },
        },
        objectives: { type: "array", items: { type: "string" } },
      },
      required: ["questions", "objectives"],
    },
  },
};

export const STEP_BLOOM_MAP: Record<string, string> = {
  einstieg: "remember", verstehen: "understand", anwenden: "apply",
  reflektieren: "analyze", transfer: "apply",
  wiederholen: "analyze", mini_check: "apply",
};
