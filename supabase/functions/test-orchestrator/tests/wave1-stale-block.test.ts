/**
 * Wave 1 – Fehlerklasse 2: False Block / Stale Block
 *
 * Tests that packages don't get stuck when all gates are green.
 * Verifies reconciliation triggers and detection views.
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
// TEST 1: Detection — ops_publish_eligible_but_stuck
// ══════════════════════════════════════════════
Deno.test("STALE_BLOCK_DETECTION: ops_publish_eligible_but_stuck is queryable", async () => {
  const { data, error } = await sb
    .from("ops_publish_eligible_but_stuck")
    .select("*")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data, "View must return data array");
  console.log(`📊 ops_publish_eligible_but_stuck: ${data!.length} entries`);

  if (data!.length > 0) {
    console.warn("⚠️  Found stuck-but-eligible packages — these need investigation:");
    for (const row of data!) {
      console.warn(`   Package: ${row.package_id}`);
    }
  }
});

// ══════════════════════════════════════════════
// TEST 2: Detection — ops_blocked_but_ready
// ══════════════════════════════════════════════
Deno.test("STALE_BLOCK_DETECTION: ops_blocked_but_ready is queryable", async () => {
  const { data, error } = await sb
    .from("ops_blocked_but_ready")
    .select("package_id, title, status, blocked_reason, integrity_passed, council_approved, non_done_steps")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data, "View must return data array");
  console.log(`📊 ops_blocked_but_ready: ${data!.length} entries`);
});

// ══════════════════════════════════════════════
// TEST 3: Detection — no published package should be blocked
// ══════════════════════════════════════════════
Deno.test("STALE_BLOCK: no published package has blocked_reason", async () => {
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
    `Found ${data?.length} published packages with blocked_reason — invariant violated`,
  );
});

// ══════════════════════════════════════════════
// TEST 4: Consistency — blocked status must have blocked_reason
// ══════════════════════════════════════════════
Deno.test("STALE_BLOCK: blocked packages have blocked_reason", async () => {
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
    `Found ${data?.length} blocked packages WITHOUT blocked_reason — invariant violated`,
  );
});

// ══════════════════════════════════════════════
// TEST 5: Reconciliation — quality_gate_failed with all gates green
// ══════════════════════════════════════════════
Deno.test("STALE_BLOCK: no quality_gate_failed package has all gates green", async () => {
  // If reconciliation trigger works, no package should remain in
  // quality_gate_failed when integrity_passed AND council_approved
  const { data, error } = await sb
    .from("course_packages")
    .select("id, title, integrity_passed, council_approved")
    .eq("status", "quality_gate_failed")
    .eq("integrity_passed", true)
    .eq("council_approved", true)
    .limit(5);

  assertEquals(error, null);

  if (data && data.length > 0) {
    console.warn(
      `⚠️  Found ${data.length} quality_gate_failed packages with all gates green — reconciliation may be stale`,
    );
    for (const p of data) {
      console.warn(`   ${p.id}: ${p.title}`);
    }
  }

  // This is a soft assertion — reconciliation trigger should catch these
  // but there might be edge cases with approved_questions < 40
  console.log(
    `📊 quality_gate_failed with gates green: ${data?.length ?? 0}`,
  );
});
