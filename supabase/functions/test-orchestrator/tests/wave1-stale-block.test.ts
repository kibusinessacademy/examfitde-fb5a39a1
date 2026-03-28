/**
 * Wave 1B – Fehlerklasse 2: False Block / Stale Block
 *
 * HARDENED v2: Exact count queries, no limit() for zero-invariant tests.
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
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
  const { count, error } = await sb
    .from("ops_publish_eligible_but_stuck")
    .select("package_id", { count: "exact", head: true });

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertEquals(
    count ?? 0,
    0,
    `❌ INVARIANT VIOLATED: ${count} packages are publish-eligible but stuck. ` +
    `Reconciliation trigger is not working.`,
  );
});

// ══════════════════════════════════════════════
// DETECTION: ops_blocked_but_ready = 0
// ══════════════════════════════════════════════
Deno.test("D:STALE_BLOCK: ops_blocked_but_ready = 0", async () => {
  const { count, error } = await sb
    .from("ops_blocked_but_ready")
    .select("package_id", { count: "exact", head: true });

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertEquals(
    count ?? 0,
    0,
    `❌ INVARIANT VIOLATED: ${count} packages are blocked but all prerequisites are done.`,
  );
});

// ══════════════════════════════════════════════
// INVARIANT: published MUST NOT have blocked_reason
// ══════════════════════════════════════════════
Deno.test("P:STALE_BLOCK: no published package has blocked_reason", async () => {
  const { count, error } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .eq("status", "published")
    .not("blocked_reason", "is", null);

  assertEquals(error, null);
  assertEquals(
    count ?? 0,
    0,
    `❌ INVARIANT: ${count} published packages have blocked_reason set.`,
  );
});

// ══════════════════════════════════════════════
// INVARIANT: blocked MUST have blocked_reason
// ══════════════════════════════════════════════
Deno.test("P:STALE_BLOCK: blocked packages MUST have blocked_reason", async () => {
  const { count, error } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .eq("status", "blocked")
    .is("blocked_reason", null);

  assertEquals(error, null);
  assertEquals(
    count ?? 0,
    0,
    `❌ INVARIANT: ${count} blocked packages WITHOUT blocked_reason.`,
  );
});

// ══════════════════════════════════════════════
// RECOVERY: quality_gate_failed + all gates green = 0
// ══════════════════════════════════════════════
Deno.test("R:STALE_BLOCK: no quality_gate_failed with all gates green", async () => {
  const { count, error } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .eq("status", "quality_gate_failed")
    .eq("integrity_passed", true)
    .eq("council_approved", true);

  assertEquals(error, null);
  assertEquals(
    count ?? 0,
    0,
    `❌ RECONCILIATION FAILURE: ${count} quality_gate_failed packages have ALL gates green. ` +
    `Reconciliation trigger is not firing.`,
  );
});
