/**
 * Berufs-KI SSOT — Tone & Copy.
 *
 * Berufs-KI ≠ ChatGPT-Klon. Sprache: warm, professionell, ergebnisorientiert.
 * „Die KI kennt deinen Beruf."
 */
import type { WorkflowCategory, WorkflowTier } from "./types";

export const BERUFS_KI = {
  brand: {
    name: "Berufs-KI",
    tagline: "Die KI kennt deinen Beruf.",
    promise: "Professionelle KI-Workflows für echte Arbeitsaufgaben — strukturiert, berufsspezifisch, sofort einsetzbar.",
  },
  hub: {
    eyebrow: "Berufs-KI",
    headline: "Arbeite besser. Mit einer KI, die deinen Beruf kennt.",
    subline:
      "Vorgefertigte Profi-Workflows für Kommunikation, Analyse, Dokumentation und Fachgespräche — keine Prompt-Sammlung, sondern strukturierte Ergebnisse auf Premium-Niveau.",
    cta_primary: "Workflow starten",
    cta_secondary: "Wie funktioniert das?",
  },
  workbench: {
    placeholder: "Was möchtest du erledigen?",
  },
  tier: {
    free: { label: "Kostenlos", short: "Free", color: "secondary" as const },
    pro: { label: "Pro", short: "Pro", color: "default" as const },
    business: { label: "Business", short: "Business", color: "default" as const },
  } satisfies Record<WorkflowTier, { label: string; short: string; color: "secondary" | "default" }>,
} as const;

export const CATEGORY_LABEL: Record<WorkflowCategory, string> = {
  kommunikation: "Kommunikation",
  analyse: "Analyse & Daten",
  dokumentation: "Dokumentation",
  organisation: "Organisation",
  fach: "Fachgespräch & Beruf",
  lernhilfe: "Lernhilfe",
};

export const CATEGORY_DESCRIPTION: Record<WorkflowCategory, string> = {
  kommunikation: "Kundenmails, Reklamationen, schwierige Gespräche.",
  analyse: "KPIs, Datenauswertungen, Auffälligkeiten erklären.",
  dokumentation: "Protokolle, SOPs, Berichte strukturiert erstellen.",
  organisation: "Tagesplanung, Priorisierung, Abläufe ordnen.",
  fach: "Fachgespräche, Kundengespräche, Prüfungssituationen.",
  lernhilfe: "Themen verständlich auf deinem Niveau erklären.",
};

export function tierLabel(t: WorkflowTier): string {
  return BERUFS_KI.tier[t].label;
}

export function lockMessage(tier: WorkflowTier, beruf?: string | null): string {
  if (tier === "business") {
    return "Business-Workflow — verfügbar mit Business-Lizenz für Teams.";
  }
  if (tier === "pro") {
    return beruf
      ? `Pro-Workflow — wird mit deinem ExamFit-Zugang für ${beruf} freigeschaltet.`
      : "Pro-Workflow — verfügbar mit aktivem ExamFit-Lernpaket.";
  }
  return "";
}
