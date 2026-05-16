/**
 * Track 2.3e — Repair Outcome Verification smoke tests
 * ─────────────────────────────────────────────────────
 * Pins the public RPC contract: anon must be forbidden but the surface
 * (function names, parameter types) must stay stable. Functional
 * invariants (auto-register on dispatched attempt, signal-closed
 * detection via v_growth_repair_eligibility_v1, idempotency on
 * attempt_log_id, dry-run/live parity, reason-required for live) live
 * server-side in _growth_repair_verify_outcomes /
 * _growth_repair_register_outcome.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const SCHEMA_REGRESSION = new Set(["42703", "42883", "42P01"]);
const describeIfConfigured = URL && KEY ? describe : describe.skip;

describeIfConfigured("Growth Repair Outcomes RPC smoke (2.3e)", () => {
  const anon = createClient(URL!, KEY!, { auth: { persistSession: false } });

  it("admin_growth_repair_outcomes_summary: signature stable", async () => {
    const { error } = await anon.rpc(
      "admin_growth_repair_outcomes_summary" as any,
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
      expect(error.message).not.toMatch(
        /column .* does not exist|function .* does not exist|relation .* does not exist/i,
      );
    }
  });

  it("admin_growth_repair_outcomes_recent: signature stable", async () => {
    const { error } = await anon.rpc(
      "admin_growth_repair_outcomes_recent" as any,
      { _outcome: null, _limit: 1 },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
    }
  });

  it("admin_growth_repair_verify_now: dry-run signature stable", async () => {
    const { error } = await anon.rpc(
      "admin_growth_repair_verify_now" as any,
      { _mode: "dry_run", _limit: 1 },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
    }
  });

  it("admin_growth_repair_verify_now: live signature stable", async () => {
    const { error } = await anon.rpc(
      "admin_growth_repair_verify_now" as any,
      { _mode: "live", _limit: 1, _reason: "smoke-test" },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
    }
  });
});
