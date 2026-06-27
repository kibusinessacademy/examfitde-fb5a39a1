import { describe, it, expect } from "vitest";
import {
  project, computeCost, computeRevenue, classify, recommend,
  computeConfidence, inputsHash, EVALUATOR_VERSION, COST_DEFAULTS,
  ALLOWED_RECOMMENDATIONS, type EvalInput,
} from "../../../supabase/functions/_shared/courseProfitability/index.ts";

const baseInput = (over: Partial<EvalInput> = {}): EvalInput => ({
  product: {
    product_id: "p-1", product_title: "Test", product_slug: "test",
    modules: 5, lessons: 30, is_sellable: true, published_at: new Date().toISOString(),
  },
  sales: { units_sold: 10, gross_revenue_cents: 24900 * 10, refunds_cents: 0 },
  window_days: 90,
  ...over,
});

describe("courseProfitability — cost model", () => {
  it("computes AI cost as lessons × default", () => {
    expect(computeCost({ ...baseInput().product }).ai_cost_cents).toBe(30 * COST_DEFAULTS.AI_COST_PER_LESSON_CENTS);
  });
  it("computes build cost from modules × minutes × hourly", () => {
    const c = computeCost({ ...baseInput().product, modules: 10, lessons: 0 });
    expect(c.build_cost_cents).toBe(Math.round((10 * 12 / 60) * 6000));
  });
  it("includes overhead", () => {
    expect(computeCost(baseInput().product).overhead_cents).toBe(COST_DEFAULTS.OVERHEAD_PER_PRODUCT_CENTS);
  });
  it("total = sum of parts", () => {
    const c = computeCost(baseInput().product);
    expect(c.total_cost_cents).toBe(c.ai_cost_cents + c.build_cost_cents + c.overhead_cents);
  });
  it("treats negative inputs as zero", () => {
    const c = computeCost({ ...baseInput().product, modules: -5, lessons: -3 });
    expect(c.ai_cost_cents).toBe(0);
    expect(c.build_cost_cents).toBe(0);
  });
});

describe("courseProfitability — revenue model", () => {
  it("uses known fees when provided", () => {
    const r = computeRevenue({ units_sold: 10, gross_revenue_cents: 100000, refunds_cents: 0, stripe_fees_cents_known: 1500 });
    expect(r.stripe_fees_cents).toBe(1500);
    expect(r.net_revenue_cents).toBe(98500);
  });
  it("estimates fees when missing", () => {
    const r = computeRevenue({ units_sold: 10, gross_revenue_cents: 100000, refunds_cents: 0 });
    expect(r.stripe_fees_cents).toBe(Math.round(100000 * 0.014) + 10 * 25);
  });
  it("subtracts refunds from net", () => {
    const r = computeRevenue({ units_sold: 10, gross_revenue_cents: 100000, refunds_cents: 20000, stripe_fees_cents_known: 0 });
    expect(r.net_revenue_cents).toBe(80000);
  });
  it("net never goes negative", () => {
    const r = computeRevenue({ units_sold: 1, gross_revenue_cents: 1000, refunds_cents: 99999, stripe_fees_cents_known: 0 });
    expect(r.net_revenue_cents).toBe(0);
  });
});

describe("courseProfitability — classify", () => {
  it("insufficient_data for new product with no sales", () => {
    expect(classify(0, 0, 0, 0, 0, new Date().toISOString())).toBe("insufficient_data");
  });
  it("long_tail for old product with no sales", () => {
    const old = new Date(Date.now() - 120 * 86_400_000).toISOString();
    expect(classify(0, 0, 0, 0, 0, old)).toBe("long_tail");
  });
  it("loser when refund share > 25%", () => {
    expect(classify(10, 1000, 0.1, 30000, 100000, null)).toBe("loser");
  });
  it("winner when margin > 0 and ratio >= 0.4", () => {
    expect(classify(10, 50000, 0.5, 0, 100000, null)).toBe("winner");
  });
  it("building when margin > 0 but ratio < 0.4", () => {
    expect(classify(10, 1000, 0.1, 0, 100000, null)).toBe("building");
  });
  it("loser when margin negative", () => {
    expect(classify(10, -5000, -0.1, 0, 100000, null)).toBe("loser");
  });
});

describe("courseProfitability — recommend", () => {
  it("only emits whitelisted codes", () => {
    const snap = project(baseInput());
    expect(ALLOWED_RECOMMENDATIONS).toContain(snap.recommendation_code);
  });
  it("INVESTIGATE_REFUNDS dominates", () => {
    const snap = project(baseInput({
      sales: { units_sold: 10, gross_revenue_cents: 100000, refunds_cents: 30000 },
    }));
    expect(snap.recommendation_code).toBe("INVESTIGATE_REFUNDS");
  });
  it("SCALE for winners with traction", () => {
    const snap = project(baseInput({
      product: { ...baseInput().product, modules: 1, lessons: 1 },
      sales: { units_sold: 50, gross_revenue_cents: 24900 * 50, refunds_cents: 0 },
    }));
    expect(snap.class).toBe("winner");
    expect(snap.recommendation_code).toBe("SCALE");
  });
  it("FREEZE_PRODUCTION for losers", () => {
    const snap = project(baseInput({
      product: { ...baseInput().product, modules: 100, lessons: 500 },
      sales: { units_sold: 1, gross_revenue_cents: 24900, refunds_cents: 0 },
    }));
    expect(snap.recommendation_code).toBe("FREEZE_PRODUCTION");
  });
});

describe("courseProfitability — confidence", () => {
  it("ranges 0..1", () => {
    expect(computeConfidence(0, 0)).toBe(0);
    expect(computeConfidence(100, 365)).toBe(1);
  });
  it("weights sample 70%", () => {
    expect(computeConfidence(20, 0)).toBe(0.7);
  });
});

describe("courseProfitability — determinism", () => {
  it("identical input → identical hash", () => {
    expect(inputsHash(baseInput())).toBe(inputsHash(baseInput()));
  });
  it("different input → different hash", () => {
    const a = inputsHash(baseInput());
    const b = inputsHash(baseInput({ sales: { units_sold: 11, gross_revenue_cents: 24900 * 11, refunds_cents: 0 } }));
    expect(a).not.toBe(b);
  });
  it("snapshot fields are stable", () => {
    const s1 = project(baseInput());
    const s2 = project(baseInput());
    expect(s1.margin_cents).toBe(s2.margin_cents);
    expect(s1.class).toBe(s2.class);
    expect(s1.recommendation_code).toBe(s2.recommendation_code);
    expect(s1.inputs_hash).toBe(s2.inputs_hash);
  });
  it("emits version stamp", () => {
    expect(project(baseInput()).evaluator_version).toBe(EVALUATOR_VERSION);
  });
});

describe("courseProfitability — payback", () => {
  it("null when no units sold", () => {
    expect(project(baseInput({ sales: { units_sold: 0, gross_revenue_cents: 0, refunds_cents: 0 } })).payback_units).toBeNull();
  });
  it("integer ceiling", () => {
    const s = project(baseInput({
      product: { ...baseInput().product, modules: 5, lessons: 30 },
      sales: { units_sold: 100, gross_revenue_cents: 24900 * 100, refunds_cents: 0 },
    }));
    if (s.payback_units != null) expect(Number.isInteger(s.payback_units)).toBe(true);
  });
});
