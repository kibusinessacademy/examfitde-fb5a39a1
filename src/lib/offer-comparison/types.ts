/**
 * AngebotsvergleichOS — SSOT Types.
 *
 * Strikt typisierter Datenkontrakt für Projekte, Anbieter, Kriterien,
 * Bewertungen, Risiken, Entscheidungen. Keine Business-Logik hier —
 * Logik lebt in scoring.ts / risk-engine.ts / decision-readiness.ts.
 */

export type ProjectCategory =
  | "weiterbildung"
  | "saas"
  | "hr_recruiting"
  | "beratung"
  | "dienstleister"
  | "einkauf"
  | "versicherung"
  | "sonstiges";

export type CriterionKey =
  | "preis"
  | "laufzeit"
  | "kuendigung"
  | "leistung"
  | "sla"
  | "datenschutz"
  | "skalierbarkeit"
  | "risiko"
  | "transparenz"
  | "support"
  | "flexibilitaet"
  | "integrationen"
  | "hidden_costs";

export type CriterionDirection = "higher_better" | "lower_better";

export interface CriterionDef {
  key: CriterionKey;
  label: string;
  description: string;
  unit?: string;
  direction: CriterionDirection;
  /** Standard-Gewicht 0–10 — vom User über Slider überschreibbar. */
  defaultWeight: number;
  group: "preis" | "vertrag" | "leistung" | "risiko" | "betrieb";
}

export interface OfferCriterionValue {
  key: CriterionKey;
  /** Normalisierter Roh-Wert (Zahl). Für Booleans: 1/0. */
  value: number;
  /** Display-Wert (mit Einheit). */
  display: string;
  /** Optional: Quelle aus dem Dokument (Seite/Abschnitt) — UX evidence. */
  evidence?: string;
}

export type RiskLevel = "info" | "low" | "medium" | "high" | "critical";

export interface RiskFinding {
  id: string;
  offerId: string;
  level: RiskLevel;
  title: string;
  detail: string;
  /** Verständnis-Hilfe: was bedeutet das? */
  meaning: string;
  /** Verhandlungs-Hebel. */
  negotiation: string;
  /** Optional: Vertragsstelle/Quelle. */
  evidence?: string;
}

export type OfferLabel =
  | "best_overall"
  | "lowest_risk"
  | "best_price"
  | "best_flexibility"
  | "negotiation_candidate"
  | "not_recommended";

export interface OfferScore {
  /** Gesamtscore 0–100. */
  overall: number;
  /** Subscores pro Dimension 0–100. */
  subscores: {
    preis: number;
    risiko: number;
    leistung: number;
    flexibilitaet: number;
    compliance: number;
    transparenz: number;
    skalierbarkeit: number;
    zukunftssicherheit: number;
  };
  labels: OfferLabel[];
  /** Aufschlüsselung: pro Kriterium normalisierter Beitrag 0–1 × Gewicht. */
  breakdown: Array<{
    key: CriterionKey;
    weight: number;
    normalized: number;
    contribution: number;
    reasoning: string;
  }>;
}

export type OfferAnalysisStatus =
  | "uploaded"
  | "processing"
  | "extracted"
  | "review_required"
  | "failed";

export interface Offer {
  id: string;
  projectId: string;
  vendor: string;
  productName: string;
  totalCostEur: number;
  annualCostEur: number;
  currency: "EUR";
  termMonths: number;
  noticePeriodDays: number;
  autoRenewal: boolean;
  values: OfferCriterionValue[];
  analysisStatus: OfferAnalysisStatus;
  documents: Array<{ name: string; pages: number }>;
  vendorNote?: string;
}

export interface DecisionEntry {
  id: string;
  at: string;
  actor: string;
  type: "comment" | "approval" | "rejection" | "negotiation_dispatched" | "criteria_updated";
  text: string;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  category: ProjectCategory;
  goal: string;
  budgetEur: number;
  /** User-Override für Kriterien-Gewichte. */
  weights: Partial<Record<CriterionKey, number>>;
  /** Reihenfolge & Auswahl aktiver Kriterien. */
  activeCriteria: CriterionKey[];
  offers: Offer[];
  risks: RiskFinding[];
  decisionLog: DecisionEntry[];
  createdAt: string;
  owner: string;
  status: "draft" | "in_analysis" | "in_negotiation" | "decided" | "archived";
}

export interface DecisionReadiness {
  score: number;
  factors: Array<{ key: string; label: string; done: boolean; weight: number }>;
}

export interface ExecutiveSummary {
  headline: string;
  body: string[];
  recommendation: {
    offerId: string;
    label: string;
    rationale: string;
  } | null;
  watchouts: string[];
}
