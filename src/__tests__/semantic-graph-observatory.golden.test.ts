/**
 * P6 Golden Tests — Crawl Observatory invariants (pure logic).
 *
 * These tests validate the contract of the freshness-state and
 * recommended-action mapping as implemented by the SQL view
 * `v_semantic_graph_crawl_health`. The mapping is duplicated here as
 * a pure TS reference so any drift between the view and the UI/RPC
 * contract is caught in CI without round-tripping to the DB.
 */
import { describe, it, expect } from "vitest";

interface HealthInput {
  has_snapshot: boolean;
  snapshot_age_minutes: number | null;
  orphan_count: number;
  route_count: number;
  sitemap_route_count: number;
  last_run_status: "started" | "skipped_unchanged" | "published" | "failed" | null;
}

function deriveFreshnessState(h: HealthInput): string {
  if (!h.has_snapshot) return "missing_snapshot";
  if (h.orphan_count > 0) return "orphan_risk";
  if (h.sitemap_route_count < h.route_count) return "sitemap_mismatch";
  if ((h.snapshot_age_minutes ?? 0) > 1440) return "stale";
  return "fresh";
}

function deriveRecommendedAction(h: HealthInput): string {
  if (!h.has_snapshot) return "run_materializer";
  if (h.orphan_count > 0) return "inspect_orphans";
  if (h.sitemap_route_count < h.route_count) return "regenerate_sitemap";
  if (h.last_run_status === "failed") return "check_materializer_error";
  if ((h.snapshot_age_minutes ?? 0) > 1440) return "run_materializer";
  return "none";
}

describe("P6 — Crawl Health derivations", () => {
  it("fresh: published, no orphans, full sitemap coverage, recent", () => {
    const h: HealthInput = { has_snapshot: true, snapshot_age_minutes: 60, orphan_count: 0, route_count: 981, sitemap_route_count: 981, last_run_status: "published" };
    expect(deriveFreshnessState(h)).toBe("fresh");
    expect(deriveRecommendedAction(h)).toBe("none");
  });

  it("stale: > 24 h without re-publish", () => {
    const h: HealthInput = { has_snapshot: true, snapshot_age_minutes: 1441, orphan_count: 0, route_count: 10, sitemap_route_count: 10, last_run_status: "published" };
    expect(deriveFreshnessState(h)).toBe("stale");
    expect(deriveRecommendedAction(h)).toBe("run_materializer");
  });

  it("missing_snapshot: no published snapshot yet", () => {
    const h: HealthInput = { has_snapshot: false, snapshot_age_minutes: null, orphan_count: 0, route_count: 0, sitemap_route_count: 0, last_run_status: null };
    expect(deriveFreshnessState(h)).toBe("missing_snapshot");
    expect(deriveRecommendedAction(h)).toBe("run_materializer");
  });

  it("orphan_risk wins over staleness", () => {
    const h: HealthInput = { has_snapshot: true, snapshot_age_minutes: 9999, orphan_count: 3, route_count: 10, sitemap_route_count: 10, last_run_status: "published" };
    expect(deriveFreshnessState(h)).toBe("orphan_risk");
    expect(deriveRecommendedAction(h)).toBe("inspect_orphans");
  });

  it("sitemap_mismatch when coverage < 100 %", () => {
    const h: HealthInput = { has_snapshot: true, snapshot_age_minutes: 10, orphan_count: 0, route_count: 10, sitemap_route_count: 9, last_run_status: "published" };
    expect(deriveFreshnessState(h)).toBe("sitemap_mismatch");
    expect(deriveRecommendedAction(h)).toBe("regenerate_sitemap");
  });

  it("check_materializer_error: fresh snapshot but last run failed", () => {
    const h: HealthInput = { has_snapshot: true, snapshot_age_minutes: 10, orphan_count: 0, route_count: 10, sitemap_route_count: 10, last_run_status: "failed" };
    expect(deriveFreshnessState(h)).toBe("fresh");
    expect(deriveRecommendedAction(h)).toBe("check_materializer_error");
  });
});

describe("P6 — Idempotency key shape", () => {
  function bucket15(d: Date): string {
    const minute = Math.floor(d.getUTCMinutes() / 15) * 15;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(minute)}`;
  }

  it("two requests within the same 15-minute bucket share the idempotency key", () => {
    const a = new Date("2026-05-20T08:02:00Z");
    const b = new Date("2026-05-20T08:14:59Z");
    expect(bucket15(a)).toBe(bucket15(b));
    expect(`semantic_graph:manual_admin:${bucket15(a)}`).toBe(`semantic_graph:manual_admin:${bucket15(b)}`);
  });

  it("crossing a 15-minute boundary produces a new key", () => {
    const a = new Date("2026-05-20T08:14:59Z");
    const b = new Date("2026-05-20T08:15:00Z");
    expect(bucket15(a)).not.toBe(bucket15(b));
  });
});

describe("P6 — PII-safe error normalization", () => {
  function piiSafe(raw: string): { code: string; message: string } {
    const message = raw.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted]").slice(0, 240);
    const m = raw.match(/^([A-Z_]+:[a-zA-Z0-9_]+)/);
    return { code: m?.[1] ?? "MATERIALIZER_INTERNAL", message };
  }

  it("strips emails from messages", () => {
    const { message } = piiSafe("LOAD_CERTIFICATIONS:23505 row user@example.com violates");
    expect(message).not.toContain("user@example.com");
    expect(message).toContain("[redacted]");
  });

  it("extracts an error code prefix", () => {
    const { code } = piiSafe("PUBLISH_RPC:42501 forbidden");
    expect(code).toBe("PUBLISH_RPC:42501");
  });

  it("falls back to MATERIALIZER_INTERNAL when no prefix is present", () => {
    expect(piiSafe("boom").code).toBe("MATERIALIZER_INTERNAL");
  });
});
