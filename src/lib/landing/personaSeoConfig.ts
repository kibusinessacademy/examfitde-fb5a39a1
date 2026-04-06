/**
 * Persona-SEO Configuration — SSOT for persona-specific landing pages.
 * Maps persona profiles to SEO routing, messaging, and content strategy.
 */

import type { PersonaProfile } from "@/lib/persona-profiles";

export type SeoPersonaType = "azubi" | "sachkunde" | "fachwirt" | "studium";

export interface PersonaSeoConfig {
  persona: SeoPersonaType;
  routePrefix: string;
  intentLabel: string;
  heroTemplate: (title: string, price: string) => { headline: string; subline: string };
  ctaPrimary: string;
  ctaSecondary: string;
  keywords: (title: string) => string[];
  metaTemplate: (title: string, price: string) => { title: string; description: string };
  sections: string[];
  jsonLdEducationalLevel: string;
}

export const PERSONA_SEO_CONFIGS: Record<SeoPersonaType, PersonaSeoConfig> = {
  azubi: {
    persona: "azubi",
    routePrefix: "pruefungstraining-azubis",
    intentLabel: "Abschlussprüfung bestehen",
    heroTemplate: (title, price) => ({
      headline: `Bestehe deine Abschlussprüfung als ${title}`,
      subline: `Trainiere mit echten Prüfungsaufgaben, Simulation und persönlichem KI-Prüfungscoach – für nur ${price} € einmalig.`,
    }),
    ctaPrimary: "Jetzt Prüfungstraining starten",
    ctaSecondary: "Kostenlosen Prüfungsreife-Check machen",
    keywords: (title) => [
      `abschlussprüfung ${title} übungen`,
      `${title} prüfung fragen`,
      `ihk prüfung ${title} vorbereitung`,
      `${title} prüfungstraining`,
    ],
    metaTemplate: (title, price) => ({
      title: `${title} Prüfungstraining 2026 – Abschlussprüfung sicher bestehen`,
      description: `${title} gezielt bestehen: prüfungsnahe Fragen, Simulation, MiniChecks und KI-Tutor. Einmalig ${price} €. Jetzt starten!`,
    }),
    sections: ["hero", "stats", "exam_structure", "sample_questions", "common_mistakes", "faq", "cta"],
    jsonLdEducationalLevel: "Berufsausbildung (DQR 3-4)",
  },

  sachkunde: {
    persona: "sachkunde",
    routePrefix: "pruefungstraining-sachkunde",
    intentLabel: "Sachkundeprüfung bestehen",
    heroTemplate: (title, price) => ({
      headline: `Bestehe die ${title} sicher`,
      subline: `Trainiere echte Prüfungsfragen + typische Fallen – gezielt und ohne unnötige Theorie. Nur ${price} € einmalig.`,
    }),
    ctaPrimary: "Jetzt Sachkunde-Training starten",
    ctaSecondary: "Prüfungsreife testen",
    keywords: (title) => [
      `${title} prüfung fragen`,
      `sachkundeprüfung ${title}`,
      `§34 prüfung vorbereitung`,
      `${title} prüfung bestehen`,
    ],
    metaTemplate: (title, price) => ({
      title: `${title} – Sachkundeprüfung sicher bestehen (${new Date().getFullYear()})`,
      description: `${title}: Echte Prüfungsfragen, typische Fallen und §-Referenzen. Gezielt bestehen für nur ${price} €.`,
    }),
    sections: ["hero", "stats", "legal_refs", "trap_questions", "faq", "cta"],
    jsonLdEducationalLevel: "Sachkundeprüfung",
  },

  fachwirt: {
    persona: "fachwirt",
    routePrefix: "pruefungstraining-fachwirt",
    intentLabel: "Fachwirt-Prüfung bestehen",
    heroTemplate: (title, price) => ({
      headline: `Bestehe deine ${title}-Prüfung strukturiert`,
      subline: `Mit Prüfungsfragen, Fallbeispielen und Coaching – strukturiert auf die IHK-Fortbildungsprüfung vorbereiten. Nur ${price} €.`,
    }),
    ctaPrimary: "Jetzt Fortbildungstraining starten",
    ctaSecondary: "Prüfungsreife-Check starten",
    keywords: (title) => [
      `${title} prüfung vorbereitung`,
      `fachwirt prüfung bestehen`,
      `ihk fortbildungsprüfung ${title}`,
      `${title} prüfungsfragen`,
    ],
    metaTemplate: (title, price) => ({
      title: `${title} Prüfungstraining – IHK-Fortbildungsprüfung bestehen (${new Date().getFullYear()})`,
      description: `${title} strukturiert bestehen: Prüfungsfragen, Fallbeispiele, KI-Coach und Prüfungssimulation. Einmalig ${price} €.`,
    }),
    sections: ["hero", "stats", "competency_areas", "case_studies", "faq", "cta"],
    jsonLdEducationalLevel: "Fortbildung (DQR 6)",
  },

  studium: {
    persona: "studium",
    routePrefix: "pruefungstraining-studium",
    intentLabel: "Klausur bestehen",
    heroTemplate: (title, price) => ({
      headline: `Bereite dich optimal auf deine ${title}-Klausur vor`,
      subline: `Verstehen, anwenden, bestehen – mit KI-gestütztem Klausurtraining und Transferaufgaben. Nur ${price} €.`,
    }),
    ctaPrimary: "Jetzt Klausurtraining starten",
    ctaSecondary: "Wissensstand testen",
    keywords: (title) => [
      `klausur vorbereitung ${title}`,
      `${title} klausur fragen`,
      `${title} prüfung uni`,
      `${title} zusammenfassung klausur`,
    ],
    metaTemplate: (title, price) => ({
      title: `${title} Klausurvorbereitung – optimal bestehen (${new Date().getFullYear()})`,
      description: `${title} Klausur verstehen & bestehen: Transferaufgaben, Modellvergleiche und KI-Tutor. Einmalig ${price} €.`,
    }),
    sections: ["hero", "stats", "theory_overview", "transfer_tasks", "faq", "cta"],
    jsonLdEducationalLevel: "Hochschulstudium (DQR 6-7)",
  },
};

/** Map PersonaProfile → SeoPersonaType */
export function personaToSeoType(persona: PersonaProfile): SeoPersonaType {
  switch (persona) {
    case "AZUBI_HIGH_ROI":
    case "AZUBI_LOW_ROI":
      return "azubi";
    case "SACHKUNDE":
      return "sachkunde";
    case "FACHWIRT":
      return "fachwirt";
    case "STUDIUM":
      return "studium";
    default:
      return "azubi";
  }
}

/** Get config for a given persona type */
export function getPersonaSeoConfig(type: SeoPersonaType): PersonaSeoConfig {
  return PERSONA_SEO_CONFIGS[type];
}

/** Get all route prefixes for sitemap generation */
export function getAllSeoRoutePrefixes(): string[] {
  return Object.values(PERSONA_SEO_CONFIGS).map(c => c.routePrefix);
}
