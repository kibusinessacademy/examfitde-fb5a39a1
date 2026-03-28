/**
 * Wave 1B – Fehlerklasse 2: False Block / Stale Block
 *
 * HARDENED: Zero-tolerance invariant assertions.
 * - Detection views must return 0 active anomalies
 * - Published packages must NEVER have blocked_reason
 * - Blocked packages must ALWAYS have blocked_reason
 * - quality_gate_failed + all gates green = 0 (reconciliation must catch)
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ══════════════════════════════════════════════
// DETECTION: ops_publish_eligible_but_stuck = 0
// ══════════════════════════════════════════════
Deno.test("D:STALE_BLOCK: ops_publish_eligible_but_stuck = 0", async () => {
  const { data, error } = await sb
    .from("ops_publish_eligible_but_stuck")
    .select("*")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data, "View must return data array");

  assertEquals(
    data!.length,
    0,
    `❌ INVARIANT VIOLATED: ${data!.length} packages are publish-eligible but stuck. ` +
    `Reconciliation trigger trg_reconcile_stale_quality_gate_failed is not working. ` +
    `Packages: ${JSON.stringify(data!.map((r: any) => r.package_id))}`,
  );
});

// ══════════════════════════════════════════════
// DETECTION: ops_blocked_but_ready = 0
// ══════════════════════════════════════════════
Deno.test("D:STALE_BLOCK: ops_blocked_but_ready = 0", async () => {
  const { data, error } = await sb
    .from("ops_blocked_but_ready")
    .select("package_id, title, status, blocked_reason, integrity_passed, council_approved, non_done_steps")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data, "View must return data array");

  assertEquals(
    data!.length,
    0,
    `❌ INVARIANT VIOLATED: ${data!.length} packages are blocked but all prerequisites are done. ` +
    `Packages: ${JSON.stringify(data!.slice(0, 3))}`,
  );
});

// ══════════════════════════════════════════════
// INVARIANT: published packages MUST NOT have blocked_reason
// ══════════════════════════════════════════════
Deno.test("P:STALE_BLOCK: no published package has blocked_reason", async () => {
  const { data, error } = await sb
    .from("course_packages")
    .select("id, title, status, blocked_reason")
    .eq("status", "published")
    .not("blocked_reason", "is", null)
    .limit(5);

  assertEquals(error, null);
  assertEquals(
    data?.length ?? 0,
    0,
    `❌ INVARIANT VIOLATED: ${data?.length} published packages have blocked_reason set. ` +
    `Trigger trg_enforce_package_status_blocked failed. ` +
    `Packages: ${JSON.stringify(data?.slice(0, 3))}`,
  );
});

// ══════════════════════════════════════════════
// INVARIANT: blocked packages MUST have blocked_reason
// ══════════════════════════════════════════════
Deno.test("P:STALE_BLOCK: blocked packages MUST have blocked_reason", async () => {
  const { data, error } = await sb
    .from("course_packages")
    .select("id, title, blocked_reason")
    .eq("status", "blocked")
    .is("blocked_reason", null)
    .limit(5);

  assertEquals(error, null);
  assertEquals(
    data?.length ?? 0,
    0,
    `❌ INVARIANT VIOLATED: ${data?.length} blocked packages WITHOUT blocked_reason. ` +
    `Trigger trg_enforce_package_status_blocked failed. ` +
    `Packages: ${JSON.stringify(data?.slice(0, 3))}`,
  );
});

// ══════════════════════════════════════════════
// RECOVERY: quality_gate_failed + all gates green = 0
// ══════════════════════════════════════════════
Deno.test("R:STALE_BLOCK: no quality_gate_failed with all gates green", async () => {
  const { data, error } = await sb
    .from("course_packages")
    .select("id, title, integrity_passed, council_approved")
    .eq("status", "quality_gate_failed")
    .eq("integrity_passed", true)
    .eq("council_approved", true)
    .limit(5);

  assertEquals(error, null);

  // HARD ASSERTION: reconciliation trigger MUST have caught these
  assertEquals(
    data?.length ?? 0,
    0,
    `❌ RECONCILIATION FAILURE: ${data?.length} quality_gate_failed packages have ALL gates green. ` +
    `Trigger trg_reconcile_stale_quality_gate_failed is not firing. ` +
    `Packages: ${JSON.stringify(data?.slice(0, 3))}`,
  );
});
