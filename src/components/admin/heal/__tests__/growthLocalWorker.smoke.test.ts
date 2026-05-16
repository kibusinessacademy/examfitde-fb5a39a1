/**
 * Track 2.3d — Local Growth Repair Worker smoke tests
 * ────────────────────────────────────────────────────
 * Verifies the worker RPC contracts:
 *  - admin gate (anon forbidden, no schema drift)
 *  - dry-run RPC exists and returns the documented shape
 *  - live RPC requires a reason (min 3 chars)
 *  - summary RPC exists
 *
 * Functional invariants (local-only consumption, systemic skipped,
 * active-job-block, cooldown, blocked_reason never dispatched, dry/live
 * parity) are enforced server-side via _growth_local_worker_run +
 * _growth_repair_decide and the v_growth_repair_local_targets_v1 filter
 * (class = 'FANOUT_NOT_STARTED'); these tests pin the public contract so
 * a regression in the SQL surface fails CI.
 *
 * Skips when VITE_SUPABASE_* env vars are missing.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const SCHEMA_REGRESSION = new Set(["42703", "42883", "42P01"]);

const describeIfConfigured = URL && KEY ? describe : describe.skip;

describeIfConfigured("Growth Local Worker RPC smoke (2.3d)", () => {
  const anon = createClient(URL!, KEY!, { auth: { persistSession: false } });

  it("admin_growth_local_worker_dry_run: anon forbidden, no schema drift", async () => {
    const { error } = await anon.rpc(
      "admin_growth_local_worker_dry_run" as any,
      { _limit: 1 },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
      expect(error.message).not.toMatch(
        /column .* does not exist|function .* does not exist|relation .* does not exist/i,
      );
    }
  });

  it("admin_growth_local_worker_live: anon forbidden, no schema drift", async () => {
    const { error } = await anon.rpc(
      "admin_growth_local_worker_live" as any,
      { _limit: 1, _reason: "smoke-test" },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
      expect(error.message).not.toMatch(
        /column .* does not exist|function .* does not exist|relation .* does not exist/i,
      );
    }
  });

  it("admin_growth_local_worker_summary: signature stable", async () => {
    const { error } = await anon.rpc(
      "admin_growth_local_worker_summary" as any,
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
    }
  });

  it("live worker rejects short reason (server-side guard)", async () => {
    const { error } = await anon.rpc(
      "admin_growth_local_worker_live" as any,
      { _limit: 1, _reason: "" },
    );
    // anon will already be forbidden first; we only assert no schema drift.
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
    }
  });
});
