/**
 * Track Content Profiles (SSOT)
 * 
 * Parametrizes content generation (glossary, minicheck, handbook) per track.
 * Now persona-aware: uses persona config for depth/style differentiation.
 * 
 * Usage: import { getContentProfile } from "./track-content-profiles.ts";
 */

import { normalizeTrack, type TrackKey } from "./track-normalize.ts";
import { getPersonaConfig, type PersonaProfile } from "./persona-profiles.ts";

export interface ContentProfile {
  track: TrackKey;
  persona: PersonaProfile;

  // ── Glossary ──────────────────────────────────────
  glossary: {
    depth: "minimal" | "medium" | "deep";
    persona: string;
    termRange: [number, number];
    includeFormulas: boolean;
    includeExamTraps: boolean;
    includeScenarios: boolean;
    includeCalculations: boolean;
    includeModels: boolean;
    examLabel: string;
    fieldLabel: string;
  };

  // ── MiniChecks ────────────────────────────────────
  minicheck: {
    type: "exam" | "understanding";
    persona: string;
    questionStyle: string;
    bloomDistribution: string;
    distractorStyle: string;
    examLabel: string;
  };

  // ── Handbook ──────────────────────────────────────
  handbook: {
    type: "exam_summary" | "learning_script" | "compact_reference";
    persona: string;
    structurePrompt: string;
    examLabel: string;
  };
}

// ── Persona-specific profiles ─────────────────────────────────

const AZUBI_HIGH_ROI_PROFILE: ContentProfile = {
  track: "AUSBILDUNG_VOLL",
  persona: "AZUBI_HIGH_ROI",
  glossary: {
    depth: "deep",
    persona: "IHK-Ausbilder mit 20+ Jahren Erfahrung",
    termRange: [60, 100],
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
    bloomDistribution: "20% leicht (remember), 40% mittel (understand/apply), 40% schwer (analyze)",
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

const AZUBI_LOW_ROI_PROFILE: ContentProfile = {
  track: "AUSBILDUNG_VOLL",
  persona: "AZUBI_LOW_ROI",
  glossary: {
    depth: "medium",
    persona: "IHK-Prüfungscoach",
    termRange: [30, 50],
    includeFormulas: true,
    includeExamTraps: true,
    includeScenarios: false,
    includeCalculations: true,
    includeModels: false,
    examLabel: "IHK-Prüfung",
    fieldLabel: "Lernfeld",
  },
  minicheck: {
    type: "exam",
    persona: "IHK-Prüfungscoach",
    questionStyle: "Prüfungsfokussierte Wissensfragen",
    bloomDistribution: "40% leicht (remember), 40% mittel (understand), 20% schwer (apply)",
    distractorStyle: "typische IHK-Fallen (Normverwechslung, Rechenfehler)",
    examLabel: "IHK-Prüfung",
  },
  handbook: {
    type: "compact_reference",
    persona: "Prüfungscoach",
    structurePrompt: `## Kompaktstruktur (Markdown):
1. **Kernfakten** — Die 5–8 wichtigsten Fakten zum Thema
2. **Prüfungsfallen** — 2–3 typische Fehler
3. **Zusammenfassung** — Stichpunkte zum schnellen Wiederholen`,
    examLabel: "IHK-Prüfung",
  },
};

const SACHKUNDE_PROFILE: ContentProfile = {
  track: "EXAM_FIRST",
  persona: "SACHKUNDE",
  glossary: {
    depth: "minimal",
    persona: "Sachkundeprüfer (§34 GewO)",
    termRange: [20, 40],
    includeFormulas: false,
    includeExamTraps: true,
    includeScenarios: false,
    includeCalculations: false,
    includeModels: false,
    examLabel: "Sachkundeprüfung",
    fieldLabel: "Prüfungsgebiet",
  },
  minicheck: {
    type: "exam",
    persona: "Sachkundeprüfer",
    questionStyle: "§-referenzierte Entscheidungsfragen (erlaubt/verboten)",
    bloomDistribution: "50% leicht (remember), 30% mittel (understand), 20% schwer (apply)",
    distractorStyle: "§-Verwechslung, Grenzwert-Fehler, Zuständigkeitsverwechslung",
    examLabel: "Sachkundeprüfung",
  },
  handbook: {
    type: "compact_reference",
    persona: "Sachkundeprüfer",
    structurePrompt: `## Sachkunde-Kompakt (Markdown):
1. **Rechtsgrundlagen** — Relevante §§ mit Kurzerklärung
2. **Erlaubt/Verboten** — Klare Entscheidungstabelle
3. **Prüfungsfallen** — 2–3 typische Verwechslungen`,
    examLabel: "Sachkundeprüfung",
  },
};

const FACHWIRT_PROFILE: ContentProfile = {
  track: "EXAM_FIRST_PLUS",
  persona: "FACHWIRT",
  glossary: {
    depth: "deep",
    persona: "IHK-Aufstiegsfortbildungs-Coach",
    termRange: [50, 80],
    includeFormulas: true,
    includeExamTraps: true,
    includeScenarios: true,
    includeCalculations: true,
    includeModels: false,
    examLabel: "IHK-Fortbildungsprüfung",
    fieldLabel: "Handlungsbereich",
  },
  minicheck: {
    type: "exam",
    persona: "IHK-Fortbildungsprüfer",
    questionStyle: "Handlungsorientierte Situationsaufgaben mit Entscheidungsbegründung",
    bloomDistribution: "20% leicht (remember), 40% mittel (apply), 40% schwer (analyze)",
    distractorStyle: "Maßnahmenverwechslung, falsche Priorisierung, unvollständige Begründung",
    examLabel: "IHK-Fortbildungsprüfung",
  },
  handbook: {
    type: "exam_summary",
    persona: "Fortbildungscoach",
    structurePrompt: `## Pflichtstruktur (Markdown):
1. **Handlungsbereiche** — Kernthemen mit Kompetenzbezug
2. **Entscheidungssituationen** — Typische Szenarien mit Lösungsansätzen
3. **Formeln & Berechnungen** — falls relevant
4. **Prüfungsfallen** — mind. 3 typische Fehler
5. **Zusammenfassung** — 5–8 klausurrelevante Kernaussagen`,
    examLabel: "IHK-Fortbildungsprüfung",
  },
};

const STUDIUM_PROFILE: ContentProfile = {
  track: "STUDIUM",
  persona: "STUDIUM",
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

// ── Profile lookup ────────────────────────────────────────────

const PERSONA_PROFILES: Record<string, ContentProfile> = {
  AZUBI_HIGH_ROI: AZUBI_HIGH_ROI_PROFILE,
  AZUBI_LOW_ROI: AZUBI_LOW_ROI_PROFILE,
  SACHKUNDE: SACHKUNDE_PROFILE,
  FACHWIRT: FACHWIRT_PROFILE,
  STUDIUM: STUDIUM_PROFILE,
};

// Legacy track-based lookup (backward compat)
const TRACK_PROFILES: Record<TrackKey, ContentProfile> = {
  AUSBILDUNG_VOLL: AZUBI_LOW_ROI_PROFILE,  // Conservative default
  EXAM_FIRST: SACHKUNDE_PROFILE,
  EXAM_FIRST_PLUS: FACHWIRT_PROFILE,
  STUDIUM: STUDIUM_PROFILE,
};

/**
 * Get the content generation profile.
 * Priority: persona_profile > track fallback.
 */
export function getContentProfile(track: unknown, personaProfile?: string | null): ContentProfile {
  // Direct persona lookup
  if (personaProfile && PERSONA_PROFILES[personaProfile]) {
    return PERSONA_PROFILES[personaProfile];
  }
  // Track fallback
  const key = normalizeTrack(track);
  return TRACK_PROFILES[key];
}
