/**
 * didactic-requirements.ts — SSOT for didactic quality rules.
 *
 * Guardrail A: Central definition of what makes content "elite".
 * Used by: handbook-context (P1), expand-handbook-section (P3),
 *          exam-pool validation (P2), MiniCheck generators, content audits.
 *
 * Every prompt and validator MUST reference these constants instead of
 * hardcoding quality expectations inline.
 */

import type { PersonaProfile } from "./persona-profiles.ts";

// ── Output Verification Markers (Guardrail B) ─────────────────────────────
// Regex patterns to verify that generated content actually contains
// the required didactic elements. Used post-generation to score/reject.

export interface ContentVerificationResult {
  passed: boolean;
  score: number;        // 0-100
  markers: Record<string, boolean>;
  missing: string[];
}

export const VERIFICATION_MARKERS = {
  praxis_example:     { pattern: /beispiel|praxisbeispiel|fallbeispiel|berechnungsbeispiel|rechenbeispiel|z\.?\s?B\./i, label: "Praxisbeispiel" },
  exam_trap:          { pattern: /prüfungsfalle|prüfungsfallen|typischer?\s+fehler|häufiger?\s+fehler|achtung.*prüfung/i, label: "Prüfungsfalle" },
  decision_logic:     { pattern: /unterschied|abgrenzung|vergleich|gegenüberstellung|im\s+gegensatz|dagegen|hingegen/i, label: "Entscheidungslogik" },
  transfer:           { pattern: /transfer|praxisbezug|anwendung.*praxis|betriebliche.*praxis|in\s+der\s+praxis/i, label: "Transferbezug" },
  technical_terms:    { pattern: /<strong>|<b>|\*\*[A-ZÄÖÜ]/i, label: "Fachbegriffe markiert" },
  mnemonic:           { pattern: /merke|merkregel|eselsbrücke|checkliste|faustformel|merksatz/i, label: "Merkhilfe" },
  calculation:        { pattern: /berechnung|formel|rechnung|ergebnis\s*[:=]|€|%.*=|=.*€/i, label: "Berechnung/Formel" },
  exam_relevance:     { pattern: /prüfungsrelevant|prüfungswissen|ihk.*prüfung|klausur|prüfungstipp/i, label: "Prüfungsrelevanz" },
  misconception:      { pattern: /fehlvorstellung|irrtum|verwechsl|falsche\s+annahme|denkfehler/i, label: "Fehlvorstellung" },
  sample_task:        { pattern: /musteraufgabe|musterlösung|lösungsweg|aufgabe.*lösung|übungsaufgabe/i, label: "Musteraufgabe" },
} as const;

// Minimum required markers per persona for "elite" quality
export const MIN_MARKERS_BY_PERSONA: Record<PersonaProfile, string[]> = {
  AZUBI_HIGH_ROI: ["praxis_example", "exam_trap", "transfer", "technical_terms", "mnemonic"],
  AZUBI_LOW_ROI:  ["exam_trap", "technical_terms"],
  SACHKUNDE:      ["decision_logic", "exam_relevance", "technical_terms"],
  FACHWIRT:       ["praxis_example", "exam_trap", "decision_logic", "transfer"],
  STUDIUM:        ["praxis_example", "decision_logic", "transfer", "technical_terms", "misconception"],
};

/**
 * Verify generated content against didactic requirements.
 * Returns a structured result with score and missing markers.
 */
export function verifyContentQuality(
  content: string,
  persona: PersonaProfile,
): ContentVerificationResult {
  const required = MIN_MARKERS_BY_PERSONA[persona];
  const markers: Record<string, boolean> = {};
  const missing: string[] = [];

  for (const [key, def] of Object.entries(VERIFICATION_MARKERS)) {
    markers[key] = def.pattern.test(content);
  }

  for (const req of required) {
    if (!markers[req]) {
      const def = VERIFICATION_MARKERS[req as keyof typeof VERIFICATION_MARKERS];
      missing.push(def?.label || req);
    }
  }

  const requiredCount = required.length;
  const foundCount = required.filter(r => markers[r]).length;
  const score = requiredCount > 0 ? Math.round((foundCount / requiredCount) * 100) : 100;

  return {
    passed: missing.length === 0,
    score,
    markers,
    missing,
  };
}

// ── Handbook Prompt Requirements (per persona) ────────────────────────────
// Used by buildElitePrompt (P1) and expand-handbook-section (P3).

export interface HandbookPromptRequirements {
  mandatoryBlocks: string[];   // Structural sections the handbook MUST contain
  promptSuffix: string;        // Appended to the LLM prompt
  minWordTarget: number;
  expandDepthInstructions: string; // Extra instructions for the expand step
}

export const HANDBOOK_REQUIREMENTS: Record<PersonaProfile, HandbookPromptRequirements> = {
  AZUBI_HIGH_ROI: {
    mandatoryBlocks: [
      "Fachliche Grundlagen",
      "Praxisbeispiele (mit Zahlen, Rollen, konkreten Situationen)",
      "Formeln & Berechnungen (mit durchgerechneten Beispielen)",
      "Prüfungsfallen (mind. 3, mit Erklärung WARUM Prüflinge sie falsch beantworten)",
      "Entscheidungslogik (Abgrenzungen, Unterschiede, Vergleichstabellen)",
      "Transferbeispiele (Anwendung im Berufsalltag)",
      "Merkschemata (Eselsbrücken, Checklisten, Faustregeln)",
      "Zusammenfassung (5–8 prüfungsrelevante Kernfakten)",
    ],
    promptSuffix: `VERBOTEN: Generische Floskeln ohne konkretes Beispiel. Keine "In der Praxis ist es wichtig"-Sätze.
PFLICHT: Jedes Praxisbeispiel MUSS Zahlen, Rollen und eine konkrete Situation enthalten.
PFLICHT: Jede Prüfungsfalle MUSS erklären, WARUM der Fehler passiert und WIE man ihn vermeidet.
PFLICHT: Verwandte Begriffe MÜSSEN explizit voneinander abgegrenzt werden.`,
    minWordTarget: 2000,
    expandDepthInstructions: `PFLICHT-VERTIEFUNG:
1. Mind. 3 durchgerechnete Praxisbeispiele mit Zahlen + vollständigem Lösungsweg
2. Mind. 5 Prüfungsfallen mit "Warum falsch?" + "So vermeidest du den Fehler"
3. Mind. 2 IHK-Musteraufgaben mit Lösungsweg
4. "So denkt der Prüfer"-Hinweise pro Themenschwerpunkt
5. Abgrenzungstabellen für verwechselbare Begriffe
6. Transferbeispiele: konkreter Betrieb, konkrete Rolle, konkretes Problem`,
  },

  AZUBI_LOW_ROI: {
    mandatoryBlocks: [
      "Kernwissen (kompakt)",
      "Prüfungsfallen (mind. 2)",
      "Merkschemata",
      "Zusammenfassung",
    ],
    promptSuffix: `NUR prüfungsrelevantes Wissen. Keine ausführlichen Erklärungen. Kompakt und merkbar.`,
    minWordTarget: 800,
    expandDepthInstructions: `KOMPAKT-VERTIEFUNG:
1. Mind. 1 Rechenbeispiel falls relevant
2. Mind. 3 Prüfungsfallen mit kurzer Erklärung
3. Checkliste der prüfungsrelevanten Fakten`,
  },

  SACHKUNDE: {
    mandatoryBlocks: [
      "Rechtliche Grundlagen (§-Referenzen)",
      "Erlaubt/Verboten-Entscheidungen",
      "Prüfungsfallen",
      "Zusammenfassung",
    ],
    promptSuffix: `PFLICHT: §-Referenzen bei jeder Regelaussage. Keine Praxisgeschichten. Nur Regelwissen und Entscheidungslogik.`,
    minWordTarget: 1000,
    expandDepthInstructions: `SACHKUNDE-VERTIEFUNG:
1. Vollständige §-Referenz-Tabelle
2. Erlaubt/Verboten-Matrix
3. Mind. 3 Prüfungsfallen mit §-Bezug`,
  },

  FACHWIRT: {
    mandatoryBlocks: [
      "Fachliche Grundlagen",
      "Handlungssituationen (Entscheidung + Begründung)",
      "Praxisbeispiele",
      "Prüfungsfallen",
      "Merkschemata",
      "Zusammenfassung",
    ],
    promptSuffix: `PFLICHT: Handlungskompetenz-Fokus. Jedes Beispiel MUSS eine Entscheidung + Begründung enthalten.
PFLICHT: Maßnahmen ableiten und bewerten. Nicht nur beschreiben.`,
    minWordTarget: 1800,
    expandDepthInstructions: `FORTBILDUNGS-VERTIEFUNG:
1. Mind. 3 Handlungssituationen mit Entscheidung + Begründung
2. Mind. 3 Prüfungsfallen mit Erklärung
3. Maßnahmen-Bewertungstabelle
4. Transferbeispiele aus der Führungspraxis`,
  },

  STUDIUM: {
    mandatoryBlocks: [
      "Theoretische Grundlagen (Modelle, Theorien, Definitionen)",
      "Anwendungsbeispiele (Fallstudien, empirische Befunde)",
      "Modellvergleiche & Abgrenzungen",
      "Typische Denkfehler & Fehlkonzepte",
      "Klausur-/Prüfungshinweise",
      "Zusammenfassung",
    ],
    promptSuffix: `PFLICHT: Quellenverweise bei Modellen/Theorien. Keine Reproduktion — Transfer und Analyse.
PFLICHT: Mind. 1 Modellvergleich mit Gegenüberstellung.
PFLICHT: Typische Denkfehler mit wissenschaftlicher Korrektur.`,
    minWordTarget: 2200,
    expandDepthInstructions: `AKADEMISCHE VERTIEFUNG:
1. Mind. 2 Fallstudien mit Analyse
2. Mind. 2 Modellvergleiche (Gegenüberstellungstabelle)
3. Mind. 3 typische Denkfehler mit wissenschaftlicher Korrektur
4. Transferaufgaben: Theorie → Praxis
5. Klausurhinweise mit Beispiel-Fragestellungen`,
  },
};

// ── Explanation Quality Patterns (for P2: hasQualityExplanation) ───────────
// Broadened patterns to reduce false negatives while keeping quality bar.

export const WRONG_ANSWER_PATTERNS = [
  // German patterns for "why this is wrong"
  /\b(falsch|nicht\s+korrekt|inkorrekt|irrtümlich|fehler|verwechsl)\b/i,
  /\b(trifft\s+nicht\s+zu|fehlerhaft|unzutreffend|stimmt\s+nicht)\b/i,
  /\b(ist\s+nicht\s+richtig|wäre\s+falsch|nicht\s+zutreffend)\b/i,
  // Option reference patterns (A/B/C/D or "Option X")
  /\b(option\s+[a-d]|antwort\s+[a-d]|aussage\s+[a-d])\b/i,
  // Negative reasoning
  /\b(dagegen|hingegen|im\s+gegensatz|jedoch\s+nicht|allerdings\s+nicht)\b/i,
  // "weil ... nicht" patterns
  /\bweil\b.*\bnicht\b/i,
  /\bda\b.*\b(falsch|nicht|kein)\b/i,
];

export const TIP_PATTERNS = [
  /\b(tipp|merke|merksatz|prüfungstipp|achtung|wichtig|beachte)\b/i,
  /\b(eselsbrücke|faustformel|merkregel|gedächtnisstütze)\b/i,
  /\b(richtig\s+ist|korrekt\s+ist|die\s+richtige\s+antwort)\b/i,
  /\b(zusammengefasst|fazit|kern(aussage|punkt))\b/i,
];
