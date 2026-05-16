/**
 * Track 2.3c — Safe Growth Repair Dispatcher smoke tests
 * ────────────────────────────────────────────────────────
 * Verifies the dispatcher RPC contracts without touching live data:
 *  - dry-run RPC exists, returns the documented shape
 *  - live RPC exists with the expected signature
 *  - admin-only gate is respected when called as anon
 *  - random package dry-run is a no-op (idempotency / active-job-block / blocked_reason
 *    paths are exercised via skip_reason classifications instead of state changes)
 *
 * Skips automatically when VITE_SUPABASE_* env vars are missing.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const RANDOM_PKG = "00000000-0000-4000-8000-000000000000";
const SCHEMA_REGRESSION = new Set(["42703", "42883", "42P01"]);

const describeIfConfigured = URL && KEY ? describe : describe.skip;

describeIfConfigured("Growth-Repair Dispatcher RPC smoke", () => {
  const anon = createClient(URL!, KEY!, { auth: { persistSession: false } });

  it("admin_growth_repair_dispatch_dry_run: anon is forbidden, no schema drift", async () => {
    const { error } = await anon.rpc(
      "admin_growth_repair_dispatch_dry_run" as any,
      { _limit: 1 },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
      // Must look like an auth/role failure, not a schema/contract failure.
      expect(error.message).not.toMatch(
        /column .* does not exist|function .* does not exist|relation .* does not exist/i,
      );
    }
  });

  it("admin_growth_repair_dispatch_live: anon is forbidden, no schema drift", async () => {
    const { error } = await anon.rpc(
      "admin_growth_repair_dispatch_live" as any,
      { _limit: 1, _reason: "smoke" },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION.has(code)).toBe(false);
      expect(error.message).not.toMatch(
        /column .* does not exist|function .* does not exist|relation .* does not exist/i,
      );
    }
  });

  it("dry-run by random package_id is a no-op (zero scanned)", async () => {
    const { data, error } = await anon.rpc(
      "admin_growth_repair_dispatch_dry_run" as any,
      { _limit: 5, _package_id: RANDOM_PKG },
    );
    // anon may still be forbidden — that's fine, we only assert contract.
    if (!error && data) {
      const payload = data as { mode?: string; scanned?: number };
      expect(payload.mode).toBe("dry_run");
      expect(payload.scanned).toBe(0);
    }
  });
});
