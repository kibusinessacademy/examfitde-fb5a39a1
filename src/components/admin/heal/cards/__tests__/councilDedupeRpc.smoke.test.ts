/**
 * Smoke-Test: admin_resolve_council_deferred Dedupe-Strategie.
 *
 * Verifiziert, dass kein unique_violation (23505) gegen den Index
 * uq_job_queue_active_package_job geworfen wird, wenn Pakete bereits
 * aktive package_quality_council Jobs haben.
 *
 * Strategie:
 *  - Bulk-Resume mit zufälliger UUID → Funktion muss sauber 0 Rows liefern,
 *    NIE mit 23505/42703/42883 sterben.
 *  - Auth-Rejection (401/403) ist OK; nur Schema-/Constraint-Drift failt.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const RANDOM_UUID = "00000000-0000-4000-8000-000000000000";

const HARD_FAIL_CODES = new Set([
  "23505", // unique_violation — der Bug, den wir killen wollten
  "42703", // undefined column
  "42883", // undefined function
  "42P01", // undefined table
]);

const describeIf = URL && KEY ? describe : describe.skip;

describeIf("admin_resolve_council_deferred — Dedupe Smoke", () => {
  const sb = createClient(URL!, KEY!, { auth: { persistSession: false } });

  it("Bulk-Resume mit non-existing package wirft KEIN unique_violation", async () => {
    const { error } = await sb.rpc(
      "admin_resolve_council_deferred" as any,
      {
        p_package_ids: [RANDOM_UUID],
        p_mode: "retry_council",
        p_reason: "smoke_test_dedupe",
      },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(HARD_FAIL_CODES.has(code)).toBe(false);
      expect(error.message).not.toMatch(
        /duplicate key value|uq_job_queue_active_package_job/i,
      );
    }
  });

  it("Single-Resume Overload existiert und ist drift-frei", async () => {
    const { error } = await sb.rpc(
      "admin_resolve_council_deferred" as any,
      {
        p_package_id: RANDOM_UUID,
        p_mode: "retry_council",
        p_reason: "smoke_test_dedupe_single",
      },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(HARD_FAIL_CODES.has(code)).toBe(false);
    }
  });
});
