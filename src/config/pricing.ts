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
        { seats: 5, totalCents: 14900, totalDisplay: '149 €', perSeatCents: 2980, perSeatDisplay: '29,80 €', stripeProductId: 'prod_UJIrziUlU2W7WT', stripePriceId: 'price_1TKgFVDxqdaWCpJ66EI2Btx7' },
        { seats: 10, totalCents: 27900, totalDisplay: '279 €', perSeatCents: 2790, perSeatDisplay: '27,90 €', stripeProductId: 'prod_UJIrdT0gOQDYkW', stripePriceId: 'price_1TKgFXDxqdaWCpJ6mAYDd7Er' },
        { seats: 25, totalCents: 64900, totalDisplay: '649 €', perSeatCents: 2596, perSeatDisplay: '25,96 €', stripeProductId: 'prod_UJIrefyjEi59Um', stripePriceId: 'price_1TKgFXDxqdaWCpJ6ehraLcMJ' },
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
        { seats: 5, totalCents: 19900, totalDisplay: '199 €', perSeatCents: 3980, perSeatDisplay: '39,80 €', stripeProductId: 'prod_UJIr4seNyF7CtN', stripePriceId: 'price_1TKgFZDxqdaWCpJ6Jt8Jdu1a' },
        { seats: 10, totalCents: 37900, totalDisplay: '379 €', perSeatCents: 3790, perSeatDisplay: '37,90 €', stripeProductId: 'prod_UJIrtKAde9Ek8i', stripePriceId: 'price_1TKgFaDxqdaWCpJ6C7lGl2UI' },
        { seats: 25, totalCents: 84900, totalDisplay: '849 €', perSeatCents: 3396, perSeatDisplay: '33,96 €', stripeProductId: 'prod_UJIrBwwdC1r9y9', stripePriceId: 'price_1TKgFbDxqdaWCpJ6YalUB0ZS' },
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
        { seats: 5, totalCents: 24900, totalDisplay: '249 €', perSeatCents: 4980, perSeatDisplay: '49,80 €', stripeProductId: 'prod_UJIrSZhqc9JWLM', stripePriceId: 'price_1TKgFbDxqdaWCpJ6xmHCY2Gu' },
        { seats: 10, totalCents: 46900, totalDisplay: '469 €', perSeatCents: 4690, perSeatDisplay: '46,90 €', stripeProductId: 'prod_UJIrLoi9wTfTgI', stripePriceId: 'price_1TKgFdDxqdaWCpJ6PSrM67wz' },
        { seats: 25, totalCents: 104900, totalDisplay: '1.049 €', perSeatCents: 4196, perSeatDisplay: '41,96 €', stripeProductId: 'prod_UJIrWobv2KXTIb', stripePriceId: 'price_1TKgFeDxqdaWCpJ6Z4j2LckG' },
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
        { seats: 5, totalCents: 29900, totalDisplay: '299 €', perSeatCents: 5980, perSeatDisplay: '59,80 €', stripeProductId: 'prod_UJIrHL7bNxTHcF', stripePriceId: 'price_1TKgFfDxqdaWCpJ6OER5ohFk' },
        { seats: 10, totalCents: 55900, totalDisplay: '559 €', perSeatCents: 5590, perSeatDisplay: '55,90 €', stripeProductId: 'prod_UJIrdZyairGppT', stripePriceId: 'price_1TKgFgDxqdaWCpJ6tmT1THIE' },
        { seats: 25, totalCents: 124900, totalDisplay: '1.249 €', perSeatCents: 4996, perSeatDisplay: '49,96 €', stripeProductId: 'prod_UJIrGOZWrtK5sK', stripePriceId: 'price_1TKgFhDxqdaWCpJ6jpAeZt9s' },
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
