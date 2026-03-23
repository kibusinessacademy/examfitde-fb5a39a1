import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/package-exam-rebalance`;

/**
 * Regression tests for package-exam-rebalance
 *
 * CRITICAL REGRESSION: The rebalancer must NOT bail out with "no_hard_fails"
 * when warnings like EASY_TOO_LOW exist. This was the root cause of the
 * Steuerfachangestellte difficulty imbalance (2026-03-23).
 */

// Helper: call the function (will fail auth but we test the edge cases via mock payloads)
async function callRebalance(body: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

// ── Test 1: Missing package_id returns 400 ──
Deno.test("rebalance: missing package_id returns error", async () => {
  const { status, data } = await callRebalance({});
  // Will be 401 (no auth) or 400 — either is acceptable without auth
  assertNotEquals(status, 200);
  await Promise.resolve(); // consume
});

// ── Test 2: No auth returns 401 ──
Deno.test("rebalance: no auth returns 401", async () => {
  const { status } = await callRebalance({ package_id: "00000000-0000-0000-0000-000000000000" });
  assertEquals(status, 401);
});

// ── Test 3: OPTIONS returns CORS headers ──
Deno.test("rebalance: OPTIONS returns CORS", async () => {
  const res = await fetch(FUNCTION_URL, { method: "OPTIONS" });
  await res.text(); // consume body
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});

// ── Test 4: POST-only enforcement ──
Deno.test("rebalance: GET returns 405", async () => {
  const res = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: { "apikey": SUPABASE_ANON_KEY },
  });
  const data = await res.json();
  assertEquals(res.status, 405);
  assertEquals(data.error, "POST only");
});

/**
 * ARCHITECTURAL INVARIANT TEST (documented, not executable without admin token):
 *
 * Given a package with:
 *   - integrity_passed = true
 *   - hard_fail_reasons = []
 *   - warnings = ["EASY_TOO_LOW"]
 *
 * The rebalancer MUST:
 *   1. NOT return { message: "no_hard_fails" }
 *   2. Execute repairEasyDeficit()
 *   3. Produce at least one repair action
 *   4. Log trigger_classification = "warning_only" in auto_heal_log
 *
 * This invariant was violated before the fix on 2026-03-23.
 * The guard condition is now:
 *   if (hardFails.length === 0 && allWarnings.length === 0 && pkg.integrity_passed)
 *
 * Previously it was:
 *   if (hardFails.length === 0)  // ← WRONG: ignored warnings entirely
 */
