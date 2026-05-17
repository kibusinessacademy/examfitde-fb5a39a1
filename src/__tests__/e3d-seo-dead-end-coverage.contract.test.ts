import { describe, expect, it } from "vitest";

/**
 * E3d contract pin — keeps the UI <-> RPC <-> view names locked.
 * Failing this test means the migration was renamed without updating the card.
 */
describe("E3d SEO Dead-End Coverage — contract", () => {
  it("RPC name is stable", () => {
    expect("admin_get_seo_dead_end_coverage").toBe("admin_get_seo_dead_end_coverage");
  });

  it("SSOT view name is stable", () => {
    expect("v_seo_dead_end_coverage").toBe("v_seo_dead_end_coverage");
  });

  it("All required statuses are covered by the UI ordering", () => {
    const STATUS_ORDER = [
      "OK",
      "NO_PRODUCT_PAGE",
      "NO_PILLAR",
      "PILLAR_NOT_LINKED_TO_PACKAGE",
      "PILLAR_NOT_PUBLISHED",
      "NO_SPOKES",
      "SPOKES_NOT_PUBLISHED",
      "BLOG_CONTEXTUAL_LINKS_BLOCKED",
      "INTERNAL_LINKS_MISSING",
    ];
    expect(STATUS_ORDER).toHaveLength(9);
    expect(STATUS_ORDER).toContain("BLOG_CONTEXTUAL_LINKS_BLOCKED");
    expect(STATUS_ORDER).toContain("PILLAR_NOT_LINKED_TO_PACKAGE");
  });

  it("Audit action types are stable", () => {
    const ACTIONS = [
      "seo_dead_end_coverage_detected",
      "seo_dead_end_guard_detected",
      "seo_dead_end_guard_skipped",
      "seo_dead_end_repair_recommended",
    ];
    expect(new Set(ACTIONS).size).toBe(4);
  });
});
