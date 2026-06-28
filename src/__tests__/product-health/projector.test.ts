import { describe, it, expect } from "vitest";
import {
  project,
  classifyDrift,
  buildActionQueue,
  buildDuplicateClusters,
  PROJECTOR_VERSION,
} from "@/lib/productHealth";

const now = "2026-06-28T00:00:00.000Z";

const deliv = [
  // public but undeliverable — TOP severity
  { course_package_id: "p1", curriculum_id: null, product_id: "prod1", package_status: "active", is_published: true, delivery_ready: false, delivery_blocking_reasons: null, product_public: true, has_stripe_price: true, is_sellable_and_deliverable: false },
  // private but priced
  { course_package_id: "p2", curriculum_id: null, product_id: "prod2", package_status: "active", is_published: true, delivery_ready: true, delivery_blocking_reasons: null, product_public: false, has_stripe_price: true, is_sellable_and_deliverable: false },
  // no price
  { course_package_id: "p3", curriculum_id: null, product_id: "prod3", package_status: "draft", is_published: false, delivery_ready: null, delivery_blocking_reasons: null, product_public: false, has_stripe_price: false, is_sellable_and_deliverable: false },
  // healthy
  { course_package_id: "p4", curriculum_id: null, product_id: "prod4", package_status: "active", is_published: true, delivery_ready: true, delivery_blocking_reasons: null, product_public: true, has_stripe_price: true, is_sellable_and_deliverable: true },
];

const gaps = [
  { package_id: "p5", package_title: "P5", product_id: "prod5", product_status: "active", product_visibility: "public", active_price_count: 1, active_stripe_price_count: 0, gap_type: "STRIPE_PRICE_ID_MISSING" },
  { package_id: "p6", package_title: "P6", product_id: "prod6", product_status: "active", product_visibility: "public", active_price_count: 1, active_stripe_price_count: 1, gap_type: "OK" },
];

const merges = [
  { certification_id: "c1", canonical_product_id: "canon1", duplicate_product_id: "dup1", canonical_title: "Canon", duplicate_title: "Dup", duplicate_slug: "dup-slug" },
  { certification_id: "c1", canonical_product_id: "canon1", duplicate_product_id: "dup2", canonical_title: "Canon", duplicate_title: "Dup2", duplicate_slug: "dup2-slug" },
];

const stripe_sync = [
  { product_id: "prod7", product_title: "P7", amount_cents: 2990, current_stripe_price_id: "price_x", suggested_stripe_price_id: "price_y", suggested_tier_label: "T1", action_needed: "manual_review_needed", reason: "tier_mismatch" },
];

const catalog = [
  { beruf_id: "b1", title: "B1", package_id: "p10", is_sellable: false, has_published_course: false, has_active_product: true, has_stripe_price: true, block_reason: "course_not_published", lesson_count: 10, lesson_ready_count: 0, teaser_is_real_usp: true },
  { beruf_id: "b2", title: "B2", package_id: "p11", is_sellable: false, has_published_course: true, has_active_product: true, has_stripe_price: true, block_reason: "lessons_gap_unknown", lesson_count: null, lesson_ready_count: null, teaser_is_real_usp: false },
];

const teaser = [
  { category: "cat-low", entries: 20, with_real_usp: 4, with_fallback_only: 16, pct_real_usp: 0.2 },
  { category: "cat-ok", entries: 10, with_real_usp: 9, with_fallback_only: 1, pct_real_usp: 0.9 },
  { category: "cat-small", entries: 2, with_real_usp: 0, with_fallback_only: 2, pct_real_usp: 0 },
];

describe("productHealth projector", () => {
  it("emits stable projector version", () => {
    expect(PROJECTOR_VERSION).toBe("product-health-os-1.0.0");
  });

  it("classifies drift deterministically", () => {
    expect(classifyDrift(deliv[0] as any).classification).toBe("PUBLIC_BUT_UNDELIVERABLE");
    expect(classifyDrift(deliv[1] as any).classification).toBe("PRIVATE_BUT_PRICED");
    expect(classifyDrift(deliv[2] as any).classification).toBe("NO_PRICE");
    expect(classifyDrift(deliv[3] as any).classification).toBe("OK");
  });

  it("builds totals", () => {
    const p = project({ deliverable: deliv as any, gaps: gaps as any, merges: merges as any, stripe_sync: stripe_sync as any, catalog: catalog as any, teaser: teaser as any, now_iso: now });
    expect(p.totals.packages_total).toBe(4);
    expect(p.totals.sellable_and_deliverable).toBe(1);
    expect(p.totals.public_but_undeliverable).toBe(1);
    expect(p.totals.private_but_priced).toBe(1);
    expect(p.totals.no_price).toBe(1);
    expect(p.totals.missing_stripe_price_id).toBe(1);
    expect(p.totals.duplicate_products).toBe(2);
    expect(p.totals.stripe_manual_review).toBe(1);
    expect(p.totals.course_not_published).toBe(1);
  });

  it("ranks PUBLIC_BUT_UNDELIVERABLE first (highest priority × critical)", () => {
    const q = buildActionQueue({ deliverable: deliv as any, gaps: gaps as any, merges: merges as any, stripe_sync: stripe_sync as any, catalog: catalog as any, teaser: teaser as any });
    expect(q.length).toBeGreaterThan(0);
    expect(q[0].code).toBe("PUBLIC_BUT_UNDELIVERABLE");
    expect(q[0].severity).toBe("critical");
  });

  it("emits one queue item per duplicate", () => {
    const q = buildActionQueue({ deliverable: [], gaps: [], merges: merges as any, stripe_sync: [], catalog: [], teaser: [] });
    const dupes = q.filter((x) => x.code === "DUPLICATE_PRODUCT");
    expect(dupes).toHaveLength(2);
  });

  it("clusters duplicates per certification", () => {
    const c = buildDuplicateClusters(merges as any);
    expect(c).toHaveLength(1);
    expect(c[0].canonical).toBe("canon1");
    expect(c[0].duplicates).toEqual(expect.arrayContaining(["dup1", "dup2"]));
  });

  it("suppresses noisy teaser categories with low entry counts", () => {
    const q = buildActionQueue({ deliverable: [], gaps: [], merges: [], stripe_sync: [], catalog: [], teaser: teaser as any });
    const teaserItems = q.filter((x) => x.code === "TEASER_FALLBACK_HEAVY");
    expect(teaserItems).toHaveLength(1);          // cat-small (entries=2) excluded
    expect(teaserItems[0].target).toBe("cat-low");
  });

  it("emits STRIPE_PRICE_MISSING per gap row", () => {
    const q = buildActionQueue({ deliverable: [], gaps: gaps as any, merges: [], stripe_sync: [], catalog: [], teaser: [] });
    const missing = q.filter((x) => x.code === "STRIPE_PRICE_MISSING");
    expect(missing).toHaveLength(1);
    expect(missing[0].target).toBe("p5");
  });

  it("aggregates PRIVATE_BUT_PRICED into a single bulk item", () => {
    const many = Array.from({ length: 75 }, (_, i) => ({ ...deliv[1], course_package_id: `pp${i}` }));
    const q = buildActionQueue({ deliverable: many as any, gaps: [], merges: [], stripe_sync: [], catalog: [], teaser: [] });
    const pp = q.filter((x) => x.code === "PRIVATE_BUT_PRICED");
    expect(pp).toHaveLength(1);
    expect(pp[0].severity).toBe("high"); // 75 ≥ 50
    expect(pp[0].metric).toBe(75);
  });

  it("orders drift_top with PUBLIC_BUT_UNDELIVERABLE first", () => {
    const p = project({ deliverable: deliv as any, gaps: gaps as any, merges: merges as any, stripe_sync: stripe_sync as any, catalog: catalog as any, teaser: teaser as any, now_iso: now });
    expect(p.drift_top[0].classification).toBe("PUBLIC_BUT_UNDELIVERABLE");
  });

  it("derives sellable_rate and public_conversion_rate", () => {
    const p = project({ deliverable: deliv as any, gaps: gaps as any, merges: merges as any, stripe_sync: stripe_sync as any, catalog: catalog as any, teaser: teaser as any, now_iso: now });
    expect(p.totals.sellable_rate).toBeCloseTo(0.25);
    // public=2 (p1,p4), sellable=1 → 2/1 = 2.0
    expect(p.totals.public_conversion_rate).toBe(2);
  });

  it("scores ordered by priority×severity", () => {
    const q = buildActionQueue({ deliverable: deliv as any, gaps: gaps as any, merges: merges as any, stripe_sync: stripe_sync as any, catalog: catalog as any, teaser: teaser as any });
    for (let i = 1; i < q.length; i++) {
      expect(q[i - 1].score).toBeGreaterThanOrEqual(q[i].score);
    }
  });

  it("block_reason_breakdown sorted desc", () => {
    const p = project({ deliverable: deliv as any, gaps: gaps as any, merges: merges as any, stripe_sync: stripe_sync as any, catalog: catalog as any, teaser: teaser as any, now_iso: now });
    expect(p.block_reason_breakdown[0].count).toBeGreaterThanOrEqual(p.block_reason_breakdown[p.block_reason_breakdown.length - 1].count);
  });
});
