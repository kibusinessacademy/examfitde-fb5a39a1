/**
 * Track Content Profiles (SSOT)
 * 
 * Parametrizes content generation (glossary, minicheck, handbook) per track.
 * Same pipeline steps, different content depth and didactic framing.
 * 
 * Usage: import { getContentProfile } from "./track-content-profiles.ts";
 */

import { normalizeTrack, type TrackKey } from "./track-normalize.ts";

export interface ContentProfile {
  track: TrackKey;

  // ── Glossary ──────────────────────────────────────
  glossary: {
    /** Depth of glossary generation */
    depth: "medium" | "deep";
    /** Persona for LLM prompt */
    persona: string;
    /** Term count range */
    termRange: [number, number];
    /** Include formulas section */
    includeFormulas: boolean;
    /** Include exam traps */
    includeExamTraps: boolean;
    /** Include practice scenarios */
    includeScenarios: boolean;
    /** Include calculation examples */
    includeCalculations: boolean;
    /** Custom section: theoretical models (academic only) */
    includeModels: boolean;
    /** Exam framing label */
    examLabel: string;
    /** Field grouping label (Lernfeld vs Modul) */
    fieldLabel: string;
  };

  // ── MiniChecks ────────────────────────────────────
  minicheck: {
    /** Type of checks */
    type: "exam" | "understanding";
    /** Persona for LLM prompt */
    persona: string;
    /** Question framing */
    questionStyle: string;
    /** Bloom level distribution description */
    bloomDistribution: string;
    /** Distractor style */
    distractorStyle: string;
    /** Exam framing label */
    examLabel: string;
  };

  // ── Handbook ──────────────────────────────────────
  handbook: {
    /** Output type */
    type: "exam_summary" | "learning_script";
    /** Persona for system prompt */
    persona: string;
    /** Section structure prompt */
    structurePrompt: string;
    /** Exam framing label */
    examLabel: string;
  };
}

const AUSBILDUNG_PROFILE: ContentProfile = {
  track: "AUSBILDUNG_VOLL",
  glossary: {
    depth: "medium",
    persona: "IHK-Prüfungsexperte",
    termRange: [50, 80],
    includeFormulas: true,
    includeExamTraps: true,
    includeScenarios: true,
    includeCalculations: true,
    includeModels: false,
    examLabel: "IHK-Prüfung",
    fieldLabel: "Lernfeld",
  },
  minicheck: {
    type: "exam",
    persona: "erfahrener IHK-Prüfungsexperte und Fachdidaktiker",
    questionStyle: "Anwendungs-/Transferfragen mit IHK-Prüfungsbezug",
    bloomDistribution: "30% leicht (remember/understand), 40% mittel (apply), 30% schwer (analyze)",
    distractorStyle: "typische IHK-Fallen (Normverwechslung, Rechenfehler, False Friend)",
    examLabel: "IHK-Prüfung",
  },
  handbook: {
    type: "exam_summary",
    persona: "IHK-Prüfungscoach",
    structurePrompt: `## Pflichtstruktur (Markdown):
1. **Fachliche Grundlagen** — Kernthemen systematisch erklären, Definitionen, Zusammenhänge
2. **Formeln & Berechnungen** — falls relevant, mit je einem Beispiel
3. **Prüfungsfallen** — mind. 3 typische Fehler mit Erklärung
4. **Merkschemata** — Eselsbrücken, Checklisten
5. **Zusammenfassung** — 5–8 wichtigste Fakten`,
    examLabel: "IHK-Prüfung",
  },
};

const STUDIUM_PROFILE: ContentProfile = {
  track: "STUDIUM",
  glossary: {
    depth: "deep",
    persona: "Hochschuldozent mit 15+ Jahren Erfahrung",
    termRange: [60, 100],
    includeFormulas: true,
    includeExamTraps: true,
    includeScenarios: true,
    includeCalculations: true,
    includeModels: true,
    examLabel: "Klausur/Modulprüfung",
    fieldLabel: "Modul",
  },
  minicheck: {
    type: "understanding",
    persona: "erfahrener Hochschuldozent und Klausurprüfer",
    questionStyle: "Verständnis-, Transfer- und Analysefragen mit Klausurbezug. Fokus auf Modellvergleiche, kritische Reflexion und Theorie-Praxis-Transfer",
    bloomDistribution: "20% leicht (remember/understand), 40% mittel (apply/analyze), 40% schwer (evaluate/create)",
    distractorStyle: "Konzeptverwechslung, Anwendungsfehler, Kausalitätsfehler, Scheinkorrelation",
    examLabel: "Klausur/Modulprüfung",
  },
  handbook: {
    type: "learning_script",
    persona: "Hochschuldozent und Klausurtrainer",
    structurePrompt: `## Pflichtstruktur (Markdown):
1. **Theoretische Grundlagen** — Kernkonzepte, Modelle, Definitionen mit wissenschaftlichem Kontext
2. **Modellvergleiche & Abgrenzungen** — Theorien gegenüberstellen, Annahmen + Grenzen
3. **Anwendung & Transfer** — Fallbeispiele, empirische Befunde, Praxisbezug
4. **Typische Klausurfehler** — mind. 3 Denkfehler mit wissenschaftlicher Korrektur
5. **Prüfungsverdichtung** — 5–8 klausurrelevante Kernaussagen mit Modellbezügen`,
    examLabel: "Klausur/Modulprüfung",
  },
};

const EXAM_FIRST_PROFILE: ContentProfile = {
  ...AUSBILDUNG_PROFILE,
  track: "EXAM_FIRST",
};

const PROFILES: Record<TrackKey, ContentProfile> = {
  AUSBILDUNG_VOLL: AUSBILDUNG_PROFILE,
  EXAM_FIRST: EXAM_FIRST_PROFILE,
  STUDIUM: STUDIUM_PROFILE,
};

/**
 * Get the content generation profile for a given track.
 * Normalizes track aliases automatically.
 */
export function getContentProfile(track: unknown): ContentProfile {
  const key = normalizeTrack(track);
  return PROFILES[key];
}
