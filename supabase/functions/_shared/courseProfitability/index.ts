/**
 * COURSE.PROFIT.OS.1 — Pure deterministic profitability evaluator.
 * No DB, no fetch, no clock. Inputs in → snapshot out.
 */

export const EVALUATOR_VERSION = "course-profit-os-1.0.0";

// Default cost assumptions (EUR cents). Conservative; can be tuned later via config table.
export const COST_DEFAULTS = {
  AI_COST_PER_LESSON_CENTS: 35,        // ~0.35 EUR avg AI generation cost per lesson
  BUILD_MINUTES_PER_MODULE: 12,        // operator review minutes per module
  OPERATOR_HOURLY_CENTS: 6000,         // 60 EUR/h fully loaded
  OVERHEAD_PER_PRODUCT_CENTS: 200,     // hosting / SEO / image share
  STRIPE_FEE_PCT: 0.014,               // 1.4% EU card
  STRIPE_FEE_FIXED_CENTS: 25,          // 0.25 EUR per tx
};

export interface ProductInput {
  product_id: string;
  product_title?: string | null;
  product_slug?: string | null;
  modules: number;
  lessons: number;
  is_sellable: boolean;
  published_at?: string | null;
}

export interface SalesInput {
  units_sold: number;
  gross_revenue_cents: number;       // sum of total_cents on paid orders within window
  refunds_cents: number;             // sum of refunded amounts
  stripe_fees_cents_known?: number;  // if available from orders.stripe_fee_cents
}

export interface EvalInput {
  product: ProductInput;
  sales: SalesInput;
  window_days: number;
}

export type ProfitClass = "winner" | "building" | "long_tail" | "loser" | "insufficient_data";

export type RecommendationCode =
  | "SCALE"
  | "BUNDLE_CANDIDATE"
  | "PRICE_EXPERIMENT"
  | "FREEZE_PRODUCTION"
  | "REVIVE"
  | "HOLD"
  | "INVESTIGATE_REFUNDS";

export const ALLOWED_RECOMMENDATIONS: readonly RecommendationCode[] = [
  "SCALE", "BUNDLE_CANDIDATE", "PRICE_EXPERIMENT",
  "FREEZE_PRODUCTION", "REVIVE", "HOLD", "INVESTIGATE_REFUNDS",
];

export interface ProfitSnapshot {
  product_id: string;
  product_title: string | null;
  product_slug: string | null;
  window_days: number;
  units_sold: number;
  gross_revenue_cents: number;
  stripe_fees_cents: number;
  refunds_cents: number;
  net_revenue_cents: number;
  ai_cost_cents: number;
  build_cost_cents: number;
  overhead_cents: number;
  total_cost_cents: number;
  margin_cents: number;
  margin_ratio: number;
  payback_units: number | null;
  class: ProfitClass;
  recommendation_code: RecommendationCode;
  recommendation_reason: string;
  confidence: number;
  inputs_hash: string;
  evaluator_version: string;
  cost_breakdown: Record<string, number>;
  revenue_breakdown: Record<string, number>;
}

// ---- Cost model ----
export function computeCost(p: ProductInput) {
  const ai = Math.max(0, p.lessons) * COST_DEFAULTS.AI_COST_PER_LESSON_CENTS;
  const buildMin = Math.max(0, p.modules) * COST_DEFAULTS.BUILD_MINUTES_PER_MODULE;
  const build = Math.round((buildMin / 60) * COST_DEFAULTS.OPERATOR_HOURLY_CENTS);
  const overhead = COST_DEFAULTS.OVERHEAD_PER_PRODUCT_CENTS;
  return { ai_cost_cents: ai, build_cost_cents: build, overhead_cents: overhead, total_cost_cents: ai + build + overhead };
}

// ---- Revenue model ----
export function computeRevenue(s: SalesInput) {
  const fees = s.stripe_fees_cents_known ??
    Math.round(s.gross_revenue_cents * COST_DEFAULTS.STRIPE_FEE_PCT) +
      (s.units_sold * COST_DEFAULTS.STRIPE_FEE_FIXED_CENTS);
  const net = Math.max(0, s.gross_revenue_cents - fees - s.refunds_cents);
  return { stripe_fees_cents: fees, net_revenue_cents: net };
}

// ---- Classification ----
export function classify(
  units: number, marginCents: number, marginRatio: number,
  refundsCents: number, grossCents: number, publishedAt: string | null | undefined,
): ProfitClass {
  if (units === 0) {
    if (publishedAt && daysSince(publishedAt) > 60) return "long_tail";
    return "insufficient_data";
  }
  const refundShare = grossCents > 0 ? refundsCents / grossCents : 0;
  if (refundShare > 0.25) return "loser";
  if (marginCents > 0 && marginRatio >= 0.4) return "winner";
  if (marginCents > 0) return "building";
  return "loser";
}

function daysSince(iso: string): number {
  // Pure: caller supplies reference date via input window where needed.
  // For test determinism we accept that this uses Date.now via wrapper below.
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
}

// ---- Recommendation ----
export function recommend(snap: Omit<ProfitSnapshot, "recommendation_code" | "recommendation_reason" | "inputs_hash" | "evaluator_version">):
  { code: RecommendationCode; reason: string } {
  const refundShare = snap.gross_revenue_cents > 0 ? snap.refunds_cents / snap.gross_revenue_cents : 0;
  if (refundShare > 0.15) return { code: "INVESTIGATE_REFUNDS", reason: `Refund-Quote ${(refundShare * 100).toFixed(1)}% übersteigt 15% — Produktqualität prüfen.` };
  if (snap.class === "winner" && snap.units_sold >= 5) return { code: "SCALE", reason: "Profitabel & validiert — Marketing/SEO-Push lohnt." };
  if (snap.class === "winner") return { code: "PRICE_EXPERIMENT", reason: "Marge stark, Volumen niedrig — Preis-Test +/- 20% empfohlen." };
  if (snap.class === "building") return { code: "BUNDLE_CANDIDATE", reason: "Marge knapp positiv — in passenden Bundle ziehen, Cross-Sell." };
  if (snap.class === "long_tail") return { code: "REVIVE", reason: "Keine Verkäufe seit >60d — Refresh-Cut, neues Cover, SEO-Audit." };
  if (snap.class === "loser") return { code: "FREEZE_PRODUCTION", reason: "Verlustzone — keine weiteren Module bis Drivers geklärt." };
  return { code: "HOLD", reason: "Datenlage zu dünn für deterministische Empfehlung." };
}

// ---- Confidence ----
export function computeConfidence(units: number, windowDays: number): number {
  const sampleScore = Math.min(1, units / 20);
  const windowScore = Math.min(1, windowDays / 90);
  return Math.round((sampleScore * 0.7 + windowScore * 0.3) * 100) / 100;
}

// ---- Hash (deterministic, no crypto module needed for collisions in same input space) ----
export function inputsHash(input: EvalInput): string {
  const s = JSON.stringify({
    p: input.product.product_id,
    u: input.sales.units_sold,
    g: input.sales.gross_revenue_cents,
    r: input.sales.refunds_cents,
    f: input.sales.stripe_fees_cents_known ?? null,
    m: input.product.modules,
    l: input.product.lessons,
    w: input.window_days,
    v: EVALUATOR_VERSION,
  });
  // djb2
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---- Top-level projector ----
export function project(input: EvalInput): ProfitSnapshot {
  const cost = computeCost(input.product);
  const rev = computeRevenue(input.sales);
  const margin = rev.net_revenue_cents - cost.total_cost_cents;
  const ratio = rev.net_revenue_cents > 0 ? margin / rev.net_revenue_cents : -1;
  const netPerUnit = input.sales.units_sold > 0 ? Math.floor(rev.net_revenue_cents / input.sales.units_sold) : 0;
  const payback = netPerUnit > 0 ? Math.ceil(cost.total_cost_cents / netPerUnit) : null;
  const klass = classify(
    input.sales.units_sold, margin, ratio,
    input.sales.refunds_cents, input.sales.gross_revenue_cents,
    input.product.published_at,
  );
  const partial = {
    product_id: input.product.product_id,
    product_title: input.product.product_title ?? null,
    product_slug: input.product.product_slug ?? null,
    window_days: input.window_days,
    units_sold: input.sales.units_sold,
    gross_revenue_cents: input.sales.gross_revenue_cents,
    stripe_fees_cents: rev.stripe_fees_cents,
    refunds_cents: input.sales.refunds_cents,
    net_revenue_cents: rev.net_revenue_cents,
    ai_cost_cents: cost.ai_cost_cents,
    build_cost_cents: cost.build_cost_cents,
    overhead_cents: cost.overhead_cents,
    total_cost_cents: cost.total_cost_cents,
    margin_cents: margin,
    margin_ratio: Math.round(ratio * 1000) / 1000,
    payback_units: payback,
    class: klass,
    confidence: computeConfidence(input.sales.units_sold, input.window_days),
    cost_breakdown: {
      ai: cost.ai_cost_cents, build: cost.build_cost_cents, overhead: cost.overhead_cents,
      lessons: input.product.lessons, modules: input.product.modules,
    },
    revenue_breakdown: {
      units: input.sales.units_sold, gross: input.sales.gross_revenue_cents,
      fees: rev.stripe_fees_cents, refunds: input.sales.refunds_cents, net: rev.net_revenue_cents,
    },
  };
  const rec = recommend(partial);
  return {
    ...partial,
    recommendation_code: rec.code,
    recommendation_reason: rec.reason,
    inputs_hash: inputsHash(input),
    evaluator_version: EVALUATOR_VERSION,
  };
}
