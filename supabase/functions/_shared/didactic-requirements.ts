/**
 * didactic-requirements.ts — SSOT for didactic quality rules.
 *
 * Guardrail A: Central definition of what makes content "elite".
 * Used by: handbook-context (P1), expand-handbook-section (P3),
 *          exam-pool validation (P2), MiniCheck generators, content audits.
 *
 * Every prompt and validator MUST reference these constants instead of
 * hardcoding quality expectations inline.
 *
 * v2: Hardened — typed marker keys, hard/soft split, structural checks,
 *     fixed technical_terms regex, DB-persistable verification result.
 */

import type { PersonaProfile } from "./persona-profiles.ts";

// ── Typed Marker Keys ─────────────────────────────────────────────────────
export type VerificationMarkerKey =
  | "praxis_example"
  | "exam_trap"
  | "decision_logic"
  | "transfer"
  | "technical_terms"
  | "mnemonic"
  | "calculation"
  | "exam_relevance"
  | "misconception"
  | "sample_task";

// ── Output Verification Markers (Guardrail B) ─────────────────────────────
export const VERIFICATION_MARKERS: Record<VerificationMarkerKey, { pattern: RegExp; label: string; minCount?: number }> = {
  praxis_example:  { pattern: /beispiel|praxisbeispiel|fallbeispiel|berechnungsbeispiel|rechenbeispiel|z\.?\s?B\./i, label: "Praxisbeispiel" },
  exam_trap:       { pattern: /prüfungsfalle|prüfungsfallen|typischer?\s+fehler|häufiger?\s+fehler|achtung.*prüfung/i, label: "Prüfungsfalle" },
  decision_logic:  { pattern: /unterschied|abgrenzung|vergleich|gegenüberstellung|im\s+gegensatz|dagegen|hingegen/i, label: "Entscheidungslogik" },
  transfer:        { pattern: /transfer|praxisbezug|anwendung.*praxis|betriebliche.*praxis|in\s+der\s+praxis/i, label: "Transferbezug" },
  technical_terms: { pattern: /\*\*[^*]{3,40}\*\*/g, label: "Fachbegriffe markiert", minCount: 3 },
  mnemonic:        { pattern: /merke|merkregel|eselsbrücke|checkliste|faustformel|merksatz/i, label: "Merkhilfe" },
  calculation:     { pattern: /berechnung|formel|rechnung|ergebnis\s*[:=]|€|%.*=|=.*€/i, label: "Berechnung/Formel" },
  exam_relevance:  { pattern: /prüfungsrelevant|prüfungswissen|ihk.*prüfung|klausur|prüfungstipp/i, label: "Prüfungsrelevanz" },
  misconception:   { pattern: /fehlvorstellung|irrtum|verwechsl|falsche\s+annahme|denkfehler/i, label: "Fehlvorstellung" },
  sample_task:     { pattern: /musteraufgabe|musterlösung|lösungsweg|aufgabe.*lösung|übungsaufgabe/i, label: "Musteraufgabe" },
};

// ── Hard / Soft Marker Split per Persona ──────────────────────────────────
// Hard markers: MUST be present → content fails without them.
// Soft markers: SHOULD be present → lower score but not a hard fail.
export const HARD_MARKERS_BY_PERSONA: Record<PersonaProfile, VerificationMarkerKey[]> = {
  AZUBI_HIGH_ROI: ["praxis_example", "exam_trap", "technical_terms"],
  AZUBI_LOW_ROI:  ["exam_trap"],
  SACHKUNDE:      ["decision_logic", "technical_terms"],
  FACHWIRT:       ["praxis_example", "exam_trap", "decision_logic"],
  STUDIUM:        ["decision_logic", "technical_terms", "misconception"],
};

export const SOFT_MARKERS_BY_PERSONA: Record<PersonaProfile, VerificationMarkerKey[]> = {
  AZUBI_HIGH_ROI: ["transfer", "mnemonic", "calculation", "misconception"],
  AZUBI_LOW_ROI:  ["technical_terms", "mnemonic"],
  SACHKUNDE:      ["exam_relevance", "misconception"],
  FACHWIRT:       ["transfer", "mnemonic", "sample_task"],
  STUDIUM:        ["praxis_example", "transfer", "sample_task", "calculation"],
};

// Legacy compat: combined list
export const MIN_MARKERS_BY_PERSONA: Record<PersonaProfile, VerificationMarkerKey[]> = {
  AZUBI_HIGH_ROI: [...HARD_MARKERS_BY_PERSONA.AZUBI_HIGH_ROI, ...SOFT_MARKERS_BY_PERSONA.AZUBI_HIGH_ROI],
  AZUBI_LOW_ROI:  [...HARD_MARKERS_BY_PERSONA.AZUBI_LOW_ROI, ...SOFT_MARKERS_BY_PERSONA.AZUBI_LOW_ROI],
  SACHKUNDE:      [...HARD_MARKERS_BY_PERSONA.SACHKUNDE, ...SOFT_MARKERS_BY_PERSONA.SACHKUNDE],
  FACHWIRT:       [...HARD_MARKERS_BY_PERSONA.FACHWIRT, ...SOFT_MARKERS_BY_PERSONA.FACHWIRT],
  STUDIUM:        [...HARD_MARKERS_BY_PERSONA.STUDIUM, ...SOFT_MARKERS_BY_PERSONA.STUDIUM],
};

// ── Structural Minimums per Persona ───────────────────────────────────────
export interface StructuralMinimums {
  minWords: number;
  minHeadings: number;       // ## or ### headings
  minListItems: number;      // - or * or 1. items
  minParagraphs: number;     // non-empty paragraphs
  // requireCalculation removed — must be topic/field-driven, not persona-global.
  // Use `markers.calculation` check only when learning_field signals numeric content.
}

export const STRUCTURAL_MINIMUMS: Record<PersonaProfile, StructuralMinimums> = {
  AZUBI_HIGH_ROI: { minWords: 1500, minHeadings: 5, minListItems: 8, minParagraphs: 10 },
  AZUBI_LOW_ROI:  { minWords: 500,  minHeadings: 3, minListItems: 3, minParagraphs: 5 },
  SACHKUNDE:      { minWords: 700,  minHeadings: 3, minListItems: 5, minParagraphs: 6 },
  FACHWIRT:       { minWords: 1200, minHeadings: 4, minListItems: 6, minParagraphs: 8 },
  STUDIUM:        { minWords: 1500, minHeadings: 5, minListItems: 6, minParagraphs: 10 },
};

// ── Content Verification Result (DB-persistable) ──────────────────────────
export interface ContentVerificationResult {
  passed: boolean;
  hardPassed: boolean;         // all hard markers present
  score: number;               // 0-100 composite
  markers: Record<VerificationMarkerKey, boolean>;
  missing: string[];           // human-readable labels
  missingHard: string[];       // hard-only missing labels
  missingSoft: string[];       // soft-only missing labels
  wordCount: number;
  headingCount: number;
  listCount: number;
  paragraphCount: number;
  structuralPassed: boolean;
  version: number;             // schema version for DB tracking
}

/**
 * Verify generated content against didactic requirements.
 * Two-layer check: (A) marker presence, (B) structural depth.
 */
export function verifyContentQuality(
  content: string,
  persona: PersonaProfile,
): ContentVerificationResult {
  const hardRequired = HARD_MARKERS_BY_PERSONA[persona];
  const softRequired = SOFT_MARKERS_BY_PERSONA[persona];
  const structural = STRUCTURAL_MINIMUMS[persona];

  // Layer A: Marker presence (count-aware for markers with minCount)
  const markers = {} as Record<VerificationMarkerKey, boolean>;
  for (const [key, def] of Object.entries(VERIFICATION_MARKERS)) {
    const k = key as VerificationMarkerKey;
    if (def.minCount && def.minCount > 1) {
      // Count-based check (e.g. technical_terms needs ≥3 bold terms)
      const matches = content.match(def.pattern);
      markers[k] = (matches?.length ?? 0) >= def.minCount;
    } else {
      markers[k] = def.pattern.test(content);
    }
  }

  const missingHard: string[] = [];
  const missingSoft: string[] = [];
  for (const key of hardRequired) {
    if (!markers[key]) missingHard.push(VERIFICATION_MARKERS[key].label);
  }
  for (const key of softRequired) {
    if (!markers[key]) missingSoft.push(VERIFICATION_MARKERS[key].label);
  }

  // Layer B: Structural checks (no requireCalculation — topic-driven, not persona-global)
  const words = content.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const headingCount = (content.match(/^#{2,4}\s+.+$/gm) || []).length;
  const listCount = (content.match(/^[\s]*[-*]\s+.+$|^[\s]*\d+\.\s+.+$/gm) || []).length;
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 30);
  const paragraphCount = paragraphs.length;

  const structuralPassed =
    wordCount >= structural.minWords &&
    headingCount >= structural.minHeadings &&
    listCount >= structural.minListItems &&
    paragraphCount >= structural.minParagraphs;

  // Composite score: markers = 60%, structural = 40%
  const allRequired = [...hardRequired, ...softRequired];
  const foundCount = allRequired.filter(k => markers[k]).length;
  const markerScore = allRequired.length > 0
    ? (foundCount / allRequired.length) * 60
    : 60;

  const structScore =
    (Math.min(wordCount / structural.minWords, 1) * 10) +
    (Math.min(headingCount / Math.max(structural.minHeadings, 1), 1) * 10) +
    (Math.min(listCount / Math.max(structural.minListItems, 1), 1) * 10) +
    (Math.min(paragraphCount / Math.max(structural.minParagraphs, 1), 1) * 10);

  const score = Math.round(Math.min(100, markerScore + structScore));
  const hardPassed = missingHard.length === 0;
  // passed = hard gates + structural gates; score is for ranking/audit only
  const passed = hardPassed && structuralPassed;

  return {
    passed,
    hardPassed,
    score,
    markers,
    missing: [...missingHard, ...missingSoft],
    missingHard,
    missingSoft,
    wordCount,
    headingCount,
    listCount,
    paragraphCount,
    structuralPassed,
    version: 3,
  };
}

// ── Handbook Prompt Requirements (per persona) ────────────────────────────

export interface HandbookPromptRequirements {
  mandatoryBlocks: string[];
  hardMarkers: VerificationMarkerKey[];
  softMarkers: VerificationMarkerKey[];
  promptSuffix: string;
  minWordTarget: number;
  expandDepthInstructions: string;
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
    hardMarkers: ["praxis_example", "exam_trap", "technical_terms"],
    softMarkers: ["transfer", "mnemonic", "calculation", "misconception"],
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
    hardMarkers: ["exam_trap"],
    softMarkers: ["technical_terms", "mnemonic"],
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
    hardMarkers: ["decision_logic", "technical_terms"],
    softMarkers: ["exam_relevance", "misconception"],
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
    hardMarkers: ["praxis_example", "exam_trap", "decision_logic"],
    softMarkers: ["transfer", "mnemonic", "sample_task"],
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
    hardMarkers: ["decision_logic", "technical_terms", "misconception"],
    softMarkers: ["praxis_example", "transfer", "sample_task", "calculation"],
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

export const WRONG_ANSWER_PATTERNS = [
  /\b(falsch|nicht\s+korrekt|inkorrekt|irrtümlich|fehler|verwechsl)\b/i,
  /\b(trifft\s+nicht\s+zu|fehlerhaft|unzutreffend|stimmt\s+nicht)\b/i,
  /\b(ist\s+nicht\s+richtig|wäre\s+falsch|nicht\s+zutreffend)\b/i,
  /\b(option\s+[a-d]|antwort\s+[a-d]|aussage\s+[a-d])\b/i,
  /\b(dagegen|hingegen|im\s+gegensatz|jedoch\s+nicht|allerdings\s+nicht)\b/i,
  /\bweil\b.*\bnicht\b/i,
  /\bda\b.*\b(falsch|nicht|kein)\b/i,
];

export const TIP_PATTERNS = [
  /\b(tipp|merke|merksatz|prüfungstipp|achtung|wichtig|beachte)\b/i,
  /\b(eselsbrücke|faustformel|merkregel|gedächtnisstütze)\b/i,
  /\b(richtig\s+ist|korrekt\s+ist|die\s+richtige\s+antwort)\b/i,
  /\b(zusammengefasst|fazit|kern(aussage|punkt))\b/i,
];
