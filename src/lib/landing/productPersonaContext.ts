/**
 * Product Persona Context (Routing/Copy SSOT)
 * ─────────────────────────────────────────────
 * Drei Einstiegspfade für EIN Produkt. Persona ist NUR Routing-/Copy-Kontext,
 * keine neue Produktwahrheit, kein eigenes Datenmodell.
 *
 *   /pruefungstraining/:slug/azubi
 *   /pruefungstraining/:slug/betrieb
 *   /pruefungstraining/:slug/institution
 */

export const PRODUCT_PERSONAS = ["azubi", "betrieb", "institution"] as const;
export type ProductPersona = (typeof PRODUCT_PERSONAS)[number];

export function isProductPersona(value: unknown): value is ProductPersona {
  return typeof value === "string" && (PRODUCT_PERSONAS as readonly string[]).includes(value);
}

export interface ProductPersonaContext {
  persona: ProductPersona;
  /** Kurzer Audience-Chip oberhalb des Hero */
  intentChip: string;
  /** Hero-Headline-Präfix (vor Produktnamen) */
  headlinePrefix: (productName: string) => string;
  /** Sub-Hero / Value-Prop für diese Audience */
  subline: (productName: string) => string;
  /** Primärer CTA-Text — führt IMMER zum Diagnose-Quiz */
  ctaPrimary: string;
  /** Erklärung neben dem Diagnose-CTA */
  ctaHint: string;
  /** SEO Title-Suffix */
  seoTitleSuffix: string;
  /** SEO Description-Override (productName, price) */
  seoDescription: (productName: string, price: string) => string;
  /** Persona-Diagnose-Quiz Ziel-Pfad (wird mit slug + package_id ergänzt) */
  diagnoseTargetPath: string;
}

export const PRODUCT_PERSONA_CONTEXTS: Record<ProductPersona, ProductPersonaContext> = {
  azubi: {
    persona: "azubi",
    intentChip: "Für Azubis",
    headlinePrefix: (name) => `${name} bestehen — als Azubi sicher in die Prüfung`,
    subline: (name) =>
      `Kostenloser Prüfungsreife-Check zeigt dir in 5 Minuten, wo du wirklich stehst — speziell für Azubis im ${name}-Training.`,
    ctaPrimary: "Kostenlosen Prüfungsreife-Check starten",
    ctaHint: "5 Minuten · keine Anmeldung · sofort Ergebnis",
    seoTitleSuffix: "für Azubis",
    seoDescription: (name, price) =>
      `${name} für Azubis: Prüfungsreife-Check, echte Prüfungsfragen, Simulation und KI-Coach. Einmalig ${price} €. Jetzt starten.`,
    diagnoseTargetPath: "/pruefungscheck",
  },
  betrieb: {
    persona: "betrieb",
    intentChip: "Für Ausbildungsbetriebe",
    headlinePrefix: (name) => `${name} — Prüfungsvorbereitung für Ihre Azubis`,
    subline: (name) =>
      `Geben Sie Ihren Azubis ein strukturiertes ${name}-Training an die Hand. Mit Diagnose-Check ermitteln Sie den Wissensstand pro Auszubildendem.`,
    ctaPrimary: "Diagnose-Check für Ihre Azubis starten",
    ctaHint: "Bedarfsanalyse · Mengenrabatte verfügbar · Rechnung möglich",
    seoTitleSuffix: "für Ausbildungsbetriebe",
    seoDescription: (name, price) =>
      `${name} für Ausbildungsbetriebe: Diagnose-Check, Lizenzpakete für Ihre Azubis und KI-Coach mit Quellenangaben. Ab ${price} € pro Lizenz.`,
    diagnoseTargetPath: "/pruefungscheck",
  },
  institution: {
    persona: "institution",
    intentChip: "Für Berufsschulen & Kammern",
    headlinePrefix: (name) => `${name} — Prüfungstraining für Ihre Lerngruppen`,
    subline: (name) =>
      `Setzen Sie ${name}-Training in Ihrer Institution ein. Mit dem Diagnose-Check messen Sie den Lernstand der gesamten Gruppe nachvollziehbar.`,
    ctaPrimary: "Gruppen-Diagnose-Check starten",
    ctaHint: "Klassen-Lizenzen · Reporting · DSGVO-konform",
    seoTitleSuffix: "für Berufsschulen & Kammern",
    seoDescription: (name, price) =>
      `${name} für Bildungsinstitutionen: Gruppen-Diagnose, Klassenlizenzen und Reporting. Ab ${price} € pro Lizenz.`,
    diagnoseTargetPath: "/pruefungscheck",
  },
};

export function getProductPersonaContext(p: ProductPersona): ProductPersonaContext {
  return PRODUCT_PERSONA_CONTEXTS[p];
}
