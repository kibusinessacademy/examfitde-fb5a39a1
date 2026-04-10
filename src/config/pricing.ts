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

export const PRICING_CATEGORIES: Record<PricingCategory, CategoryPricing> = {
  ausbildung: {
    label: 'Ausbildung',
    tagline: 'Bestehe deine IHK-Abschlussprüfung sicher',
    priceCents: 2990,
    priceDisplay: '29,90 €',
    stripeProductId: 'prod_UJIqaKAx185ofq',
    stripePriceId: 'price_1TKgFDDxqdaWCpJ6cquKeCog',
    access: '12 Monate',
    b2b: {
      pricePerSeatDisplay: '39 €',
      tiers: [
        { seats: 5, totalCents: 14900, totalDisplay: '149 €/Jahr', perSeatCents: 2980, perSeatDisplay: '29,80 €/Jahr', stripeProductId: 'prod_UJJJMKF3JXiJl4', stripePriceId: 'price_1TKggjDxqdaWCpJ6yxAXNuOI' },
        { seats: 10, totalCents: 27900, totalDisplay: '279 €/Jahr', perSeatCents: 2790, perSeatDisplay: '27,90 €/Jahr', stripeProductId: 'prod_UJJJMKF3JXiJl4', stripePriceId: 'price_1TKggpDxqdaWCpJ6w2gtCyVi' },
        { seats: 25, totalCents: 64900, totalDisplay: '649 €/Jahr', perSeatCents: 2596, perSeatDisplay: '25,96 €/Jahr', stripeProductId: 'prod_UJJJMKF3JXiJl4', stripePriceId: 'price_1TKggtDxqdaWCpJ6zimlOVL0' },
      ] as const,
    },
  },
  studium: {
    label: 'Studium',
    tagline: 'Bestehe deine Klausuren & Prüfungen effizient',
    priceCents: 3990,
    priceDisplay: '39,90 €',
    stripeProductId: 'prod_UJIqjVdABzAGp4',
    stripePriceId: 'price_1TKgFEDxqdaWCpJ6cW3P1l3T',
    access: '12 Monate',
    b2b: {
      pricePerSeatDisplay: '49 €',
      tiers: [
        { seats: 5, totalCents: 19900, totalDisplay: '199 €/Jahr', perSeatCents: 3980, perSeatDisplay: '39,80 €/Jahr', stripeProductId: 'prod_UJJJZI03sRtqaB', stripePriceId: 'price_1TKggvDxqdaWCpJ63Jo0sMuk' },
        { seats: 10, totalCents: 37900, totalDisplay: '379 €/Jahr', perSeatCents: 3790, perSeatDisplay: '37,90 €/Jahr', stripeProductId: 'prod_UJJJZI03sRtqaB', stripePriceId: 'price_1TKgh1DxqdaWCpJ6zUzoeVor' },
        { seats: 25, totalCents: 89900, totalDisplay: '899 €/Jahr', perSeatCents: 3596, perSeatDisplay: '35,96 €/Jahr', stripeProductId: 'prod_UJJJZI03sRtqaB', stripePriceId: 'price_1TKgh2DxqdaWCpJ6d7laYYTJ' },
      ] as const,
    },
  },
  zertifizierung: {
    label: 'Zertifizierung',
    tagline: 'Bestehe deine Zertifizierung beim ersten Versuch',
    priceCents: 4990,
    priceDisplay: '49,90 €',
    stripeProductId: 'prod_UJIqM3J1DzNajW',
    stripePriceId: 'price_1TKgFGDxqdaWCpJ6lUWDo5LR',
    access: '12 Monate',
    b2b: {
      pricePerSeatDisplay: '59 €',
      tiers: [
        { seats: 5, totalCents: 24900, totalDisplay: '249 €/Jahr', perSeatCents: 4980, perSeatDisplay: '49,80 €/Jahr', stripeProductId: 'prod_UJJJMCaQBaHe3V', stripePriceId: 'price_1TKggvDxqdaWCpJ6TXVKDj4I' },
        { seats: 10, totalCents: 47900, totalDisplay: '479 €/Jahr', perSeatCents: 4790, perSeatDisplay: '47,90 €/Jahr', stripeProductId: 'prod_UJJJMCaQBaHe3V', stripePriceId: 'price_1TKgh2DxqdaWCpJ6MBkODaB5' },
        { seats: 25, totalCents: 114900, totalDisplay: '1.149 €/Jahr', perSeatCents: 4596, perSeatDisplay: '45,96 €/Jahr', stripeProductId: 'prod_UJJJMCaQBaHe3V', stripePriceId: 'price_1TKgh4DxqdaWCpJ63wKN2X6G' },
      ] as const,
    },
  },
  weiterbildung: {
    label: 'Fort-/Weiterbildung',
    tagline: 'Sichere dir deinen nächsten Karriereschritt',
    priceCents: 5990,
    priceDisplay: '59,90 €',
    stripeProductId: 'prod_UJIq9m2R4Kr1Gl',
    stripePriceId: 'price_1TKgFHDxqdaWCpJ67SfmQl10',
    access: '12 Monate',
    b2b: {
      pricePerSeatDisplay: '69 €',
      tiers: [
        { seats: 5, totalCents: 29900, totalDisplay: '299 €/Jahr', perSeatCents: 5980, perSeatDisplay: '59,80 €/Jahr', stripeProductId: 'prod_UJJJOdGKo0p39X', stripePriceId: 'price_1TKggwDxqdaWCpJ6ktZucksn' },
        { seats: 10, totalCents: 57900, totalDisplay: '579 €/Jahr', perSeatCents: 5790, perSeatDisplay: '57,90 €/Jahr', stripeProductId: 'prod_UJJJOdGKo0p39X', stripePriceId: 'price_1TKgh4DxqdaWCpJ6vlbodQIt' },
        { seats: 25, totalCents: 124900, totalDisplay: '1.249 €/Jahr', perSeatCents: 4996, perSeatDisplay: '49,96 €/Jahr', stripeProductId: 'prod_UJJJOdGKo0p39X', stripePriceId: 'price_1TKgh5DxqdaWCpJ6xSt0Ptme' },
      ] as const,
    },
  },
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
