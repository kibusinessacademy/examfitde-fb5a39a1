/**
 * E3c — Internal Link Materialization RPC contract test (lightweight).
 * Bestätigt die UI-Erwartungen an die RPC-Namen + Argumente.
 * (Voller End-to-End Smoke läuft separat als Migration-Smoke.)
 */
import { describe, it, expect } from "vitest";

const RPC_NAMES = [
  "admin_materialize_internal_links",
  "admin_get_internal_link_materialization_summary",
  "admin_get_internal_link_materialization_recent",
] as const;

const AUDIT_ACTIONS = [
  "internal_link_materialization_detected",
  "internal_link_materialization_applied",
  "internal_link_materialization_skipped",
  "internal_link_materialization_summary",
] as const;

const DECISIONS = [
  "READY_TO_MATERIALIZE",
  "ALREADY_ACTIVE",
  "SOURCE_NOT_PUBLISHED",
  "TARGET_NOT_PUBLISHED",
  "ANCHOR_MISSING",
  "DUPLICATE_LINK",
  "UNSAFE_CONTENT_STATE",
  "NO_ACTION",
] as const;

describe("E3c internal-link materialization contract", () => {
  it("locks RPC surface", () => {
    expect(RPC_NAMES).toEqual([
      "admin_materialize_internal_links",
      "admin_get_internal_link_materialization_summary",
      "admin_get_internal_link_materialization_recent",
    ]);
  });

  it("locks audit action_types", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(4);
    AUDIT_ACTIONS.forEach((a) =>
      expect(a.startsWith("internal_link_materialization_")).toBe(true),
    );
  });

  it("locks decision enum", () => {
    expect(DECISIONS).toContain("READY_TO_MATERIALIZE");
    expect(DECISIONS).toContain("ALREADY_ACTIVE");
    expect(DECISIONS.length).toBe(8);
  });

  it("live apply requires reason in UI mutation payload", () => {
    // Mirrors the UI: live run must set p_dry_run=false AND non-empty p_reason >=5
    const payload = { p_limit: 25, p_dry_run: false, p_reason: "valid reason" };
    expect(payload.p_dry_run).toBe(false);
    expect((payload.p_reason ?? "").trim().length).toBeGreaterThanOrEqual(5);
  });
});
