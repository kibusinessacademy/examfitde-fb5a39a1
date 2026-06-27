import { describe, it, expect } from "vitest";
import {
  project,
  buildActionQueue,
  buildReadinessGaps,
  buildBridgeMatrix,
  buildOrphanByRole,
  buildDeadEndReasons,
  PROJECTOR_VERSION,
  type ReadinessRow,
  type BridgeRow,
  type OrphanRow,
  type DeadEndRow,
  type CanonicalDriftRow,
} from "@/lib/seoHealth";

const r = (overrides: Partial<ReadinessRow>): ReadinessRow => ({
  package_id: "pkg_1",
  package_title: "Pkg 1",
  track: "default",
  seo_customer_safe: true,
  internal_link_ready: true,
  intent_pipeline_healthy: true,
  pillar_ready: true,
  spoke_ready: true,
  blog_ready: true,
  pillar_count: 1,
  spoke_count: 5,
  spoke_pending_count: 0,
  blog_count: 3,
  blog_pending_count: 0,
  orphaned_pillar_count: 0,
  thin_content_risk_count: 0,
  internal_link_active_count: 10,
  internal_link_suggested_count: 0,
  reasons: null,
  ...overrides,
});

const emptyInputs = {
  readiness: [] as ReadinessRow[],
  bridge: [] as BridgeRow[],
  orphans: [] as OrphanRow[],
  dead_ends: [] as DeadEndRow[],
  canonical: [] as CanonicalDriftRow[],
};

describe("seoHealth projector", () => {
  it("exports a stable version", () => {
    expect(PROJECTOR_VERSION).toBe("seo-health-os-1.0.0");
  });

  it("returns zero totals for empty inputs", () => {
    const p = project({ ...emptyInputs, now_iso: "2026-01-01T00:00:00Z" });
    expect(p.totals.packages_total).toBe(0);
    expect(p.totals.customer_safe_rate).toBe(0);
    expect(p.action_queue).toEqual([]);
  });

  it("computes customer_safe_rate correctly", () => {
    const readiness = [
      r({ package_id: "a", seo_customer_safe: true }),
      r({ package_id: "b", seo_customer_safe: false }),
      r({ package_id: "c", seo_customer_safe: true }),
      r({ package_id: "d", seo_customer_safe: false }),
    ];
    const p = project({ ...emptyInputs, readiness, now_iso: "2026-01-01T00:00:00Z" });
    expect(p.totals.packages_total).toBe(4);
    expect(p.totals.packages_customer_safe).toBe(2);
    expect(p.totals.customer_safe_rate).toBe(0.5);
  });

  it("ranks CANONICAL_DRIFT critical above DEAD_END_PACKAGE high", () => {
    const queue = buildActionQueue({
      readiness: [],
      bridge: [],
      orphans: [],
      dead_ends: [
        { package_id: "p1", package_title: "P1", product_slug: "p-1", is_seo_dead_end: true,
          blocking_reason: "no_spokes", recommended_next_action: "publish", spokes_published: 0,
          blog_published: 0, links_active: 0 },
      ],
      canonical: [
        { page_id: "x1", slug: "/x", package_id: null, drift_severity: "CRITICAL", canonical_check_status: "fail" },
      ],
    });
    expect(queue[0].code).toBe("CANONICAL_DRIFT");
    expect(queue[0].severity).toBe("critical");
  });

  it("does not emit READINESS_GAP for dead-end packages", () => {
    const queue = buildActionQueue({
      readiness: [r({ package_id: "p1", seo_customer_safe: false, spoke_ready: false })],
      bridge: [],
      orphans: [],
      dead_ends: [
        { package_id: "p1", package_title: "P1", product_slug: null, is_seo_dead_end: true,
          blocking_reason: "x", recommended_next_action: null, spokes_published: 0, blog_published: 0, links_active: 0 },
      ],
      canonical: [],
    });
    expect(queue.some((q) => q.code === "READINESS_GAP" && q.target === "p1")).toBe(false);
    expect(queue.some((q) => q.code === "DEAD_END_PACKAGE" && q.target === "p1")).toBe(true);
  });

  it("emits READINESS_GAP with severity scaling with gap count", () => {
    const gaps = buildReadinessGaps([
      r({ package_id: "low", seo_customer_safe: false }),
      r({ package_id: "high", seo_customer_safe: false, spoke_ready: false, blog_ready: false,
         internal_link_ready: false, pillar_ready: false }),
    ]);
    const high = gaps.find((g) => g.package_id === "high")!;
    const low = gaps.find((g) => g.package_id === "low")!;
    expect(high.missing.length).toBeGreaterThan(low.missing.length);
    expect(gaps[0].package_id).toBe("high"); // sorted desc
  });

  it("aggregates bridge_layer_matrix correctly", () => {
    const m = buildBridgeMatrix([
      { source_url: "a", target_url: "b", source_layer: "pillar", target_layer: "spoke",
        similarity_score: 0.9, decision: "READY" },
      { source_url: "a", target_url: "c", source_layer: "pillar", target_layer: "spoke",
        similarity_score: 0.8, decision: "READY" },
      { source_url: "a", target_url: "d", source_layer: "pillar", target_layer: "spoke",
        similarity_score: 0.7, decision: "BLOCKED_DUPLICATE_EXISTING" },
    ]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ source_layer: "pillar", target_layer: "spoke", ready: 2, blocked_dupe: 1 });
  });

  it("only emits BRIDGE_READY when count >= 3 per layer pair", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({
      source_url: `s${i}`, target_url: `t${i}`, source_layer: "pillar", target_layer: "spoke",
      similarity_score: 0.9, decision: "READY",
    } as BridgeRow));
    const q1 = buildActionQueue({ readiness: [], bridge: mk(2), orphans: [], dead_ends: [], canonical: [] });
    const q2 = buildActionQueue({ readiness: [], bridge: mk(50), orphans: [], dead_ends: [], canonical: [] });
    expect(q1.some((q) => q.code === "BRIDGE_READY")).toBe(false);
    const ready = q2.find((q) => q.code === "BRIDGE_READY")!;
    expect(ready.metric).toBe(50);
    expect(ready.severity).toBe("high");
  });

  it("groups orphans by node_role and class", () => {
    const o = buildOrphanByRole([
      { url: "/a", node_role: "spoke", inbound_total: 0, outbound_total: 3, orphan_class: "no_inbound" },
      { url: "/b", node_role: "spoke", inbound_total: 0, outbound_total: 1, orphan_class: "no_inbound" },
      { url: "/c", node_role: "blog", inbound_total: 2, outbound_total: 0, orphan_class: "no_outbound" },
    ]);
    const spoke = o.find((x) => x.node_role === "spoke")!;
    expect(spoke.no_inbound).toBe(2);
    const blog = o.find((x) => x.node_role === "blog")!;
    expect(blog.no_outbound).toBe(1);
  });

  it("aggregates dead_end_reasons", () => {
    const reasons = buildDeadEndReasons([
      { package_id: "a", package_title: null, product_slug: null, is_seo_dead_end: true,
        blocking_reason: "no_spokes", recommended_next_action: null, spokes_published: 0, blog_published: 0, links_active: 0 },
      { package_id: "b", package_title: null, product_slug: null, is_seo_dead_end: true,
        blocking_reason: "no_spokes", recommended_next_action: null, spokes_published: 0, blog_published: 0, links_active: 0 },
      { package_id: "c", package_title: null, product_slug: null, is_seo_dead_end: false,
        blocking_reason: "ignored", recommended_next_action: null, spokes_published: 0, blog_published: 0, links_active: 0 },
    ]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatchObject({ reason: "no_spokes", count: 2 });
  });

  it("scoring respects PRIORITY ordering across action codes", () => {
    const queue = buildActionQueue({
      readiness: [
        r({ package_id: "rg", seo_customer_safe: false, spoke_ready: false }),
      ],
      bridge: Array.from({ length: 60 }, (_, i) => ({
        source_url: `s${i}`, target_url: `t${i}`, source_layer: "x", target_layer: "y",
        similarity_score: 0.9, decision: "READY",
      } as BridgeRow)),
      orphans: [
        { url: "/u", node_role: "spoke", inbound_total: 0, outbound_total: 2, orphan_class: "no_inbound" },
      ],
      dead_ends: [],
      canonical: [
        { page_id: "p", slug: "/c", package_id: null, drift_severity: "CRITICAL", canonical_check_status: "fail" },
      ],
    });
    // Canonical critical must outrank bridge_ready high and orphan high
    expect(queue[0].code).toBe("CANONICAL_DRIFT");
    const bridgeIdx = queue.findIndex((q) => q.code === "BRIDGE_READY");
    const orphanIdx = queue.findIndex((q) => q.code === "ORPHAN_NO_INBOUND");
    expect(orphanIdx).toBeGreaterThanOrEqual(0);
    expect(bridgeIdx).toBeGreaterThanOrEqual(0);
    // ORPHAN_NO_INBOUND priority(75)*high(3)=225 > BRIDGE_READY(70)*high(3)=210
    expect(orphanIdx).toBeLessThan(bridgeIdx);
  });

  it("project() totals align with action_queue components", () => {
    const p = project({
      readiness: [
        r({ package_id: "a", seo_customer_safe: true, intent_pipeline_healthy: true }),
        r({ package_id: "b", seo_customer_safe: false, intent_pipeline_healthy: false,
           internal_link_suggested_count: 5 }),
      ],
      bridge: [
        { source_url: "x", target_url: "y", source_layer: "p", target_layer: "s",
          similarity_score: 0.9, decision: "READY" },
      ],
      orphans: [],
      dead_ends: [],
      canonical: [],
      now_iso: "2026-01-01T00:00:00Z",
    });
    expect(p.totals.packages_total).toBe(2);
    expect(p.totals.packages_customer_safe).toBe(1);
    expect(p.totals.packages_intent_healthy).toBe(1);
    expect(p.totals.bridge_ready_to_link).toBe(1);
    expect(p.totals.suggested_links_unaccepted).toBe(5);
    expect(p.projector_version).toBe("seo-health-os-1.0.0");
  });
});
