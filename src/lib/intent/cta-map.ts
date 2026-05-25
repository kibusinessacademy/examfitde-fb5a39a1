/**
 * W1 Cut 2 — Intent → CTA Mapping (deterministic).
 *
 * SSOT for adaptive CTAs. Surfaces consume `ctaFor(intent)` — never
 * hard-code CTA copy inline.
 */

import type { IntentKind, RecommendedSurface, ResolvedIntent } from "./types";

export interface IntentCta {
  primary: { label: string; surface: RecommendedSurface };
  secondary?: { label: string; surface: RecommendedSurface };
  /** Microcopy under the CTA (trust / framing). */
  hint?: string;
}

const MAP: Readonly<Record<IntentKind, IntentCta>> = {
  bestehen: {
    primary: { label: "Prüfungsreife in 4 Minuten prüfen", surface: "diagnose_quiz" },
    secondary: { label: "Prüfung simulieren", surface: "exam_simulation" },
    hint: "Kostenlos. Ohne Account. Sofort Ergebnis.",
  },
  pruefung_angst: {
    primary: { label: "Bist du wirklich gefährdet? Jetzt prüfen", surface: "readiness_check" },
    secondary: { label: "Realistische Prüfung simulieren", surface: "exam_simulation" },
    hint: "Kein Marketing. Nur deine echten Risiken.",
  },
  letzte_wochen: {
    primary: { label: "4-Wochen-Intensivplan starten", surface: "study_plan" },
    secondary: { label: "Häufigste Prüfungsfehler ansehen", surface: "weakness_training" },
    hint: "Fokus auf das, was wirklich drankommt.",
  },
  muendliche_pruefung: {
    primary: { label: "Mündliche Prüfung simulieren", surface: "oral_simulation" },
    secondary: { label: "Typische IHK-Fragen trainieren", surface: "exam_simulation" },
    hint: "Antwortstruktur statt Auswendiglernen.",
  },
  unsicherheit: {
    primary: { label: "Prüfungsreife jetzt prüfen", surface: "readiness_check" },
    secondary: { label: "Schwächen analysieren", surface: "weakness_training" },
    hint: "Klare Antwort statt Bauchgefühl.",
  },
  lernplan: {
    primary: { label: "Persönlichen Lernplan erstellen", surface: "study_plan" },
    secondary: { label: "Mit Diagnose starten", surface: "diagnose_quiz" },
    hint: "Adaptiv. An IHK-Rahmenplan gebunden.",
  },
  simulation: {
    primary: { label: "Prüfung jetzt simulieren", surface: "exam_simulation" },
    secondary: { label: "Schwächen vorher prüfen", surface: "readiness_check" },
    hint: "Bewertung nach prüfungsnaher Logik.",
  },
  ihk_fragen: {
    primary: { label: "Typische IHK-Fragen trainieren", surface: "exam_simulation" },
    secondary: { label: "Antwortstruktur üben", surface: "oral_simulation" },
    hint: "Aus dem Ausbildungsrahmenplan abgeleitet.",
  },
  durchgefallen: {
    primary: { label: "Wiederholungsplan starten", surface: "weakness_training" },
    secondary: { label: "Echte Schwachstellen analysieren", surface: "readiness_check" },
    hint: "Diesmal gezielt. Nicht nochmal alles.",
  },
  wiederholung: {
    primary: { label: "Wiederholung gezielt starten", surface: "weakness_training" },
    secondary: { label: "Prüfung simulieren", surface: "exam_simulation" },
    hint: "Spaced Repetition statt Endlos-Bulk.",
  },
  karriere: {
    primary: { label: "Karrierepfad erkunden", surface: "product_landing" },
    secondary: { label: "Prüfungsreife prüfen", surface: "readiness_check" },
    hint: "Prüfung bestehen ist Schritt eins.",
  },
  gehalt: {
    primary: { label: "Beruf & Perspektiven ansehen", surface: "product_landing" },
    secondary: { label: "Jetzt durchstarten", surface: "diagnose_quiz" },
    hint: "Erst Prüfung, dann Verhandlung.",
  },
  kompetenzproblem: {
    primary: { label: "Schwächen gezielt trainieren", surface: "weakness_training" },
    secondary: { label: "Mit Tutor erklären lassen", surface: "tutor" },
    hint: "Pro Kompetenz statt pro Kapitel.",
  },
  zeitmangel: {
    primary: { label: "Express-Lernplan starten", surface: "study_plan" },
    secondary: { label: "Prüfung simulieren", surface: "exam_simulation" },
    hint: "Was wirklich drankommt — kompakt.",
  },
  motivation: {
    primary: { label: "Mit Tutor sprechen", surface: "tutor" },
    secondary: { label: "Kleinen Lernschritt starten", surface: "weakness_training" },
    hint: "Schritt für Schritt zurück in den Flow.",
  },
  unknown: {
    primary: { label: "Prüfungsreife in 4 Minuten prüfen", surface: "diagnose_quiz" },
    hint: "Kostenlos. Ohne Account.",
  },
};

export function ctaFor(intent: IntentKind | ResolvedIntent): IntentCta {
  const key = typeof intent === "string" ? intent : intent.primary;
  return MAP[key] ?? MAP.unknown;
}
