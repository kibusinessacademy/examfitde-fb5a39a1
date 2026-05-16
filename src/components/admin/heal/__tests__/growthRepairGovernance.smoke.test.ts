/**
 * Track 2.3f — Repair Governance smoke tests
 * ───────────────────────────────────────────
 * Pins the public RPC contract for outcome-based repair governance.
 * Functional invariants — manual_override preservation, dispatch gate
 * on GOVERNANCE_BLOCKED, doubled cooldown for 'downranked' — live in
 * _growth_repair_recompute_strategy_governance + _growth_repair_decide.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const SCHEMA_REGRESSION = new Set(["42703", "42883", "42P01"]);
const describeIfConfigured = URL && KEY ? describe : describe.skip;

describeIfConfigured("Growth Repair Governance RPC smoke (2.3f)", () => {
  const anon = createClient(URL!, KEY!, { auth: { persistSession: false } });

  it("admin_growth_repair_strategy_health: signature stable", async () => {
    const { error } = await anon.rpc(
      "admin_growth_repair_strategy_health" as any,
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
      expect(error.message).not.toMatch(
        /column .* does not exist|function .* does not exist|relation .* does not exist/i,
      );
    }
  });

  it("admin_recompute_growth_repair_governance: signature stable", async () => {
    const { error } = await anon.rpc(
      "admin_recompute_growth_repair_governance" as any,
      { _reason: "smoke-test" },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
    }
  });

  it("admin_set_growth_repair_strategy_override: signature stable", async () => {
    const { error } = await anon.rpc(
      "admin_set_growth_repair_strategy_override" as any,
      {
        _signal: "blog",
        _canonical_job_type: "package_post_publish_blog",
        _state: "active",
        _reason: "smoke-test",
        _manual: true,
      },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
    }
  });
});
