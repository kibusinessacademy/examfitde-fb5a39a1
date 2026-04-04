/**
 * Centralized Pricing SSOT — Single Source of Truth for all price displays & Stripe IDs.
 * 
 * IMPORTANT: All UI price strings MUST reference this file.
 * Server-side (create-payment) resolves prices from DB/Stripe, but these IDs
 * must stay in sync with what's configured in the pricing_plans table.
 */

export const PRICING = {
  individual: {
    ausbildung: {
      priceDisplay: '24,90 €',
      priceCents: 2490,
      stripePriceId: 'price_1TITzmDxqdaWCpJ6TibglfNr',
      productId: 'prod_UGgwt89kfo6vz2',
      access: '12 Monate',
      label: 'Einzellizenz Ausbildung',
    },
    studium: {
      priceDisplay: '24,90 €',
      priceCents: 2490,
      stripePriceId: 'price_1TITztDxqdaWCpJ6LgODwvtc',
      productId: 'prod_UGgxoWqiuLfzUl',
      access: '12 Monate',
      label: 'Einzellizenz Studium',
    },
  },
  b2b: {
    tiers: [
      { seats: 10, unitPriceCents: 1900, unitPriceDisplay: '19 €', name: 'Starter' },
      { seats: 25, unitPriceCents: 1600, unitPriceDisplay: '16 €', name: 'Business' },
      { seats: 50, unitPriceCents: 1200, unitPriceDisplay: '12 €', name: 'Enterprise' },
    ] as const,
  },
  /** Common display helpers */
  defaultPrice: '24,90 €',
  defaultAccess: '12 Monate',
  noSubscription: 'Kein Abo',
  /** Anchor pricing for marketing copy */
  anchor: {
    ihkRange: '300–1.000 €',
    examFit: '24,90 €',
  },
} as const;

export type B2BTier = (typeof PRICING.b2b.tiers)[number];
