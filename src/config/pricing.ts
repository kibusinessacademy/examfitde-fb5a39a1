/**
 * Centralized Pricing SSOT — Single Source of Truth for all price displays & Stripe IDs.
 *
 * IMPORTANT: All UI price strings MUST reference this file.
 * Server-side (create-payment) resolves prices from DB/Stripe, but these IDs
 * must stay in sync with what's configured in the pricing_plans table.
 *
 * Updated: 2026-04-10 — New 4-category pricing strategy
 */

export type PricingCategory = 'ausbildung' | 'studium' | 'zertifizierung' | 'weiterbildung';

export interface CategoryPricing {
  label: string;
  tagline: string;
  priceCents: number;
  priceDisplay: string;
  stripeProductId: string;
  stripePriceId: string;
  access: string;
  b2b: {
    pricePerSeatDisplay: string;
    tiers: readonly B2BTeamTier[];
  };
}

export interface B2BTeamTier {
  seats: number;
  totalCents: number;
  totalDisplay: string;
  perSeatCents: number;
  perSeatDisplay: string;
  stripeProductId: string;
  stripePriceId: string;
}

// Bundle-only SSOT: Es gibt nur EIN kaufbares Produkt — das Bundle zu 24,90 €.
// Die Kategorie-Struktur bleibt erhalten, damit bestehende Imports nicht brechen,
// aber alle Kategorien zeigen auf denselben Preis (24,90 €).
const BUNDLE_PRICE_CENTS = 2490;
const BUNDLE_PRICE_DISPLAY = '24,90 €';
const BUNDLE_STRIPE_PRODUCT_ID = 'prod_UJIqaKAx185ofq';
const BUNDLE_STRIPE_PRICE_ID = 'price_1TKgFDDxqdaWCpJ6cquKeCog';

const BUNDLE_B2B_TIERS = [
  { seats: 5, totalCents: 12450, totalDisplay: '124,50 €/Jahr', perSeatCents: 2490, perSeatDisplay: '24,90 €/Jahr', stripeProductId: BUNDLE_STRIPE_PRODUCT_ID, stripePriceId: BUNDLE_STRIPE_PRICE_ID },
  { seats: 10, totalCents: 22900, totalDisplay: '229 €/Jahr', perSeatCents: 2290, perSeatDisplay: '22,90 €/Jahr', stripeProductId: BUNDLE_STRIPE_PRODUCT_ID, stripePriceId: BUNDLE_STRIPE_PRICE_ID },
  { seats: 25, totalCents: 52450, totalDisplay: '524,50 €/Jahr', perSeatCents: 2098, perSeatDisplay: '20,98 €/Jahr', stripeProductId: BUNDLE_STRIPE_PRODUCT_ID, stripePriceId: BUNDLE_STRIPE_PRICE_ID },
] as const;

const BUNDLE_CATEGORY: CategoryPricing = {
  label: 'Bundle',
  tagline: 'Bestehe deine Prüfung sicher — alles in einem Paket',
  priceCents: BUNDLE_PRICE_CENTS,
  priceDisplay: BUNDLE_PRICE_DISPLAY,
  stripeProductId: BUNDLE_STRIPE_PRODUCT_ID,
  stripePriceId: BUNDLE_STRIPE_PRICE_ID,
  access: '12 Monate',
  b2b: {
    pricePerSeatDisplay: BUNDLE_PRICE_DISPLAY,
    tiers: BUNDLE_B2B_TIERS,
  },
};

export const PRICING_CATEGORIES: Record<PricingCategory, CategoryPricing> = {
  ausbildung: { ...BUNDLE_CATEGORY, label: 'Ausbildung', tagline: 'Bestehe deine IHK-Abschlussprüfung sicher' },
  studium: { ...BUNDLE_CATEGORY, label: 'Studium', tagline: 'Bestehe deine Klausuren & Prüfungen effizient' },
  zertifizierung: { ...BUNDLE_CATEGORY, label: 'Zertifizierung', tagline: 'Bestehe deine Zertifizierung beim ersten Versuch' },
  weiterbildung: { ...BUNDLE_CATEGORY, label: 'Fort-/Weiterbildung', tagline: 'Sichere dir deinen nächsten Karriereschritt' },
} as const;

/** Helper: resolve price by category */
export function getPriceByCategory(category: PricingCategory): CategoryPricing {
  return PRICING_CATEGORIES[category];
}

/** Helper: get B2B tier for a category + seat count */
export function getB2BTier(category: PricingCategory, seats: number): B2BTeamTier | undefined {
  return PRICING_CATEGORIES[category].b2b.tiers.find(t => t.seats === seats);
}

/** All categories in display order */
export const CATEGORY_ORDER: PricingCategory[] = ['ausbildung', 'studium', 'zertifizierung', 'weiterbildung'];

/** Common display helpers */
export const PRICING_DEFAULTS = {
  access: '12 Monate',
  noSubscription: 'Kein Abo',
} as const;

/**
 * @deprecated Use PRICING_CATEGORIES instead. Kept for backward compatibility.
 */
export const PRICING = {
  individual: {
    ausbildung: {
      priceDisplay: '29,90 €',
      priceCents: 2990,
      stripePriceId: 'price_1TKgFDDxqdaWCpJ6cquKeCog',
      productId: 'prod_UJIqaKAx185ofq',
      access: '12 Monate',
      label: 'Einzellizenz Ausbildung',
    },
    studium: {
      priceDisplay: '39,90 €',
      priceCents: 3990,
      stripePriceId: 'price_1TKgFEDxqdaWCpJ6cW3P1l3T',
      productId: 'prod_UJIqjVdABzAGp4',
      access: '12 Monate',
      label: 'Einzellizenz Studium',
    },
    zertifizierung: {
      priceDisplay: '49,90 €',
      priceCents: 4990,
      stripePriceId: 'price_1TKgFGDxqdaWCpJ6lUWDo5LR',
      productId: 'prod_UJIqM3J1DzNajW',
      access: '12 Monate',
      label: 'Einzellizenz Zertifizierung',
    },
    weiterbildung: {
      priceDisplay: '59,90 €',
      priceCents: 5990,
      stripePriceId: 'price_1TKgFHDxqdaWCpJ67SfmQl10',
      productId: 'prod_UJIq9m2R4Kr1Gl',
      access: '12 Monate',
      label: 'Einzellizenz Fort-/Weiterbildung',
    },
  },
  b2b: {
    tiers: [
      { seats: 5, unitPriceCents: 2980, unitPriceDisplay: '29,80 €', name: 'Team 5' },
      { seats: 10, unitPriceCents: 2790, unitPriceDisplay: '27,90 €', name: 'Team 10' },
      { seats: 25, unitPriceCents: 2596, unitPriceDisplay: '25,96 €', name: 'Team 25' },
    ] as const,
  },
  defaultPrice: '29,90 €',
  defaultAccess: '12 Monate',
  noSubscription: 'Kein Abo',
  anchor: {
    ihkRange: '300–1.000 €',
    examFit: '29,90 €',
  },
} as const;

export type B2BTier = (typeof PRICING.b2b.tiers)[number];
