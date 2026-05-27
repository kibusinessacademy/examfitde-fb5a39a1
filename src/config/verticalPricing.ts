/**
 * BerufOS Vertical-Pricing-SSOT (B2B SaaS Subscriptions)
 *
 * Separater SKU-Set von B2C-EXAM_FIRST (24,90 € Bundle).
 * Diese Preise gelten für Branchenbetriebssysteme (PraxisOS, SteuerOS, etc.).
 *
 * Limit-Logik: "intelligente Vorgänge / Monat" (nicht Tokens / Credits).
 * Ein Vorgang = ein abgeschlossener Workflow / Agent-Run für den Endnutzer.
 *
 * Anti-Drift:
 *  - Niemals "unlimited AI" anbieten
 *  - Bei Überschreitung Soft-Cap (Hinweis), kein automatischer Bezug zusätzlicher Vorgänge
 *  - Enterprise = Sales-Kontakt, niemals Selfservice
 */

export type VerticalTier = "starter" | "professional" | "enterprise";

export interface VerticalTierConfig {
  key: VerticalTier;
  label: string;
  priceDisplay: string;
  priceCents: number | null; // null = Sales-only
  /** Stripe Price ID — null für Enterprise (Sales-Kontakt) */
  stripePriceId: string | null;
  stripeProductId: string | null;
  billingInterval: "month" | "year";
  monthlyVorgangLimit: number;
  /** UI-Bullet-Liste */
  features: string[];
  /** Empfohlen-Badge für Mid-Tier */
  recommended?: boolean;
  /** CTA-Label */
  ctaLabel: string;
}

export const VERTICAL_TIERS: VerticalTierConfig[] = [
  {
    key: "starter",
    label: "Branchen Starter",
    priceDisplay: "149 €",
    priceCents: 14900,
    stripeProductId: "prod_UauqfaosjBeCsD",
    stripePriceId: "price_1Tbj0MDxqdaWCpJ6QNObZfxB",
    billingInterval: "month",
    monthlyVorgangLimit: 300,
    ctaLabel: "Starter sichern",
    features: [
      "1 Branchen-Agent",
      "1–3 Nutzer",
      "300 intelligente Vorgänge / Monat",
      "Standard-Workflows der Branche",
      "Tagesbrief light",
      "Dokumenten-Vorlagen",
      "EU-Hosting + DSGVO by Default",
    ],
  },
  {
    key: "professional",
    label: "Branchen Professional",
    priceDisplay: "499 €",
    priceCents: 49900,
    stripeProductId: "prod_Uauqzm7neV4XUo",
    stripePriceId: "price_1Tbj0ODxqdaWCpJ6Uf5p8JsL",
    billingInterval: "month",
    monthlyVorgangLimit: 3000,
    ctaLabel: "Professional starten",
    recommended: true,
    features: [
      "Mehrere Rollen-Agenten",
      "Bis 15 Nutzer",
      "3.000 intelligente Vorgänge / Monat",
      "Mission Control + Fix Queue",
      "Outcome Intelligence",
      "Persona Simulation",
      "Team- und Rollenrechte",
      "Audit-Trail (AI-Act-ready)",
    ],
  },
  {
    key: "enterprise",
    label: "Branchen Enterprise",
    priceDisplay: "ab 1.500 €",
    priceCents: null,
    stripeProductId: null,
    stripePriceId: null,
    billingInterval: "month",
    monthlyVorgangLimit: 25000,
    ctaLabel: "Sales kontaktieren",
    features: [
      "Multi-Team und Multi-Standort",
      "Eigene Branchen-DNA und Workflows",
      "SSO + SCIM",
      "Eigene Governance- und Approval-Policies",
      "Isolierte Runtime",
      "Custom-Integrationen (z. B. DATEV, MediForm, GDT)",
      "Persönlicher Customer-Success",
    ],
  },
];

export function getVerticalTier(key: VerticalTier): VerticalTierConfig {
  const t = VERTICAL_TIERS.find((x) => x.key === key);
  if (!t) throw new Error(`Unknown vertical tier: ${key}`);
  return t;
}
