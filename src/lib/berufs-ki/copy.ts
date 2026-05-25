/**
 * Berufs-KI SSOT — Tone & Copy.
 *
 * Berufs-KI ≠ ChatGPT-Klon. Sprache: warm, professionell, ergebnisorientiert.
 * „Die KI kennt deinen Beruf."
 */
import type { WorkflowCategory } from "./types";

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
