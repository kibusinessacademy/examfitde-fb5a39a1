/**
 * Persona Profiles — SSOT for production depth per persona.
 *
 * Edge-function version. Client-side mirror: src/lib/persona-profiles.ts
 * Controls prompts, validation, tutor style, and content depth.
 */

import { normalizeTrack, type TrackKey } from "./track-normalize.ts";

// ── Types ──────────────────────────────────────────────────────

export type PersonaProfile =
  | "AZUBI_HIGH_ROI"
  | "AZUBI_LOW_ROI"
  | "SACHKUNDE"
  | "FACHWIRT"
  | "STUDIUM";

export type ExplanationDepth = "minimal" | "short" | "deep";
export type QuestionStyle = "exam" | "learning" | "analysis";
export type TutorMode = "full" | "limited_exam" | "exam_only";
export type ContentDepth = "light" | "full";
export type HandbookMode = "none" | "light" | "full";

export interface PersonaConfig {
  persona: PersonaProfile;
  track: TrackKey;

  role: string;
  promptStyle: string;
  explanationDepth: ExplanationDepth;
  questionStyle: QuestionStyle;
  tutorMode: TutorMode;
  contentDepth: ContentDepth;

  features: {
    learning: boolean;
    minichecks: boolean;
    handbook: HandbookMode;
    oral: boolean | "cert_based";
  };

  validation: {
    minQuestions: number;
    recommendedQuestions: number;
    bloomTarget: string[];
    explanationRequired: boolean;
  };

  examLabel: string;
  fieldLabel: string;
}

// ── Persona Configs ────────────────────────────────────────────

export const PERSONA_CONFIGS: Record<PersonaProfile, PersonaConfig> = {
  AZUBI_HIGH_ROI: {
    persona: "AZUBI_HIGH_ROI",
    track: "AUSBILDUNG_VOLL",
    role: "IHK-Ausbilder (20+ J. Erfahrung)",
    promptStyle: "didaktisch, praxisnah, mit konkreten Beispielen aus dem Berufsalltag",
    explanationDepth: "deep",
    questionStyle: "learning",
    tutorMode: "full",
    contentDepth: "full",
    features: { learning: true, minichecks: true, handbook: "full", oral: true },
    validation: {
      minQuestions: 800,
      recommendedQuestions: 1200,
      bloomTarget: ["understand", "apply", "analyze"],
      explanationRequired: true,
    },
    examLabel: "IHK-Prüfung",
    fieldLabel: "Lernfeld",
  },

  AZUBI_LOW_ROI: {
    persona: "AZUBI_LOW_ROI",
    track: "AUSBILDUNG_VOLL",
    role: "IHK-Prüfungscoach",
    promptStyle: "kurz, prüfungsfokussiert, nur das Wesentliche",
    explanationDepth: "short",
    questionStyle: "exam",
    tutorMode: "limited_exam",
    contentDepth: "light",
    features: { learning: false, minichecks: false, handbook: "light", oral: true },
    validation: {
      minQuestions: 300,
      recommendedQuestions: 500,
      bloomTarget: ["remember", "understand"],
      explanationRequired: false,
    },
    examLabel: "IHK-Prüfung",
    fieldLabel: "Lernfeld",
  },

  SACHKUNDE: {
    persona: "SACHKUNDE",
    track: "EXAM_FIRST",
    role: "Sachkundeprüfer (§34 GewO)",
    promptStyle: "kurz, entscheidungsorientiert, §-referenziert",
    explanationDepth: "minimal",
    questionStyle: "exam",
    tutorMode: "exam_only",
    contentDepth: "light",
    features: { learning: false, minichecks: false, handbook: "none", oral: true },
    validation: {
      minQuestions: 300,
      recommendedQuestions: 500,
      bloomTarget: ["remember", "understand"],
      explanationRequired: false,
    },
    examLabel: "Sachkundeprüfung",
    fieldLabel: "Prüfungsgebiet",
  },

  FACHWIRT: {
    persona: "FACHWIRT",
    track: "EXAM_FIRST_PLUS",
    role: "IHK-Aufstiegsfortbildungs-Coach",
    promptStyle: "strukturiert, praxisnah, mit Handlungskompetenz-Fokus",
    explanationDepth: "deep",
    questionStyle: "exam",
    tutorMode: "limited_exam",
    contentDepth: "full",
    features: { learning: false, minichecks: false, handbook: "full", oral: "cert_based" },
    validation: {
      minQuestions: 300,
      recommendedQuestions: 600,
      bloomTarget: ["understand", "apply", "analyze"],
      explanationRequired: true,
    },
    examLabel: "IHK-Fortbildungsprüfung",
    fieldLabel: "Handlungsbereich",
  },

  STUDIUM: {
    persona: "STUDIUM",
    track: "STUDIUM",
    role: "Hochschuldozent (15+ J. Erfahrung)",
    promptStyle: "analytisch, theoretisch, mit Modellvergleichen und empirischen Befunden",
    explanationDepth: "deep",
    questionStyle: "analysis",
    tutorMode: "full",
    contentDepth: "full",
    features: { learning: true, minichecks: true, handbook: "full", oral: false },
    validation: {
      minQuestions: 400,
      recommendedQuestions: 700,
      bloomTarget: ["analyze", "evaluate"],
      explanationRequired: true,
    },
    examLabel: "Klausur/Modulprüfung",
    fieldLabel: "Modul",
  },
};

// ── Resolver ───────────────────────────────────────────────────

export function resolvePersonaProfile(pkg: {
  track?: unknown;
  persona_profile?: string | null;
}): PersonaProfile {
  if (pkg.persona_profile && pkg.persona_profile in PERSONA_CONFIGS) {
    return pkg.persona_profile as PersonaProfile;
  }
  const track = normalizeTrack(pkg.track);
  switch (track) {
    case "STUDIUM": return "STUDIUM";
    case "EXAM_FIRST": return "SACHKUNDE";
    case "EXAM_FIRST_PLUS": return "FACHWIRT";
    default: return "AZUBI_LOW_ROI";
  }
}

export function getPersonaConfig(pkg: {
  track?: unknown;
  persona_profile?: string | null;
}): PersonaConfig {
  return PERSONA_CONFIGS[resolvePersonaProfile(pkg)];
}
