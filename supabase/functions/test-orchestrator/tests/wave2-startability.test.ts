/**
 * Wave 2B — Startability: Can learners start what they see?
 *
 * P/D/R structure:
 * - P: visible → startable via can_start_exam_simulation RPC
 * - P: not-published → start MUST fail
 * - D: cross-check start prerequisites
 *
 * SSOT Owner: can_start_exam_simulation RPC, v_learner_visible_exam_simulations
 * Blast Radius: learner-facing, revenue-facing
 *
 * IMPORTANT: exam_questions has curriculum_id, NOT package_id.
 * The view exposes approved_question_count directly — use that.
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SkipAuditTracker } from "./_skip-audit.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const skipTracker = new SkipAuditTracker(1);

// ══════════════════════════════════════════════
// P1: Every visible simulation passes can_start_exam_simulation
// ══════════════════════════════════════════════
Deno.test("P:START: all visible simulations pass can_start_exam_simulation RPC", async () => {
  const { data: visible, error } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id, blueprint_id")
    .limit(200);

  assertEquals(error, null);
  if (!visible || visible.length === 0) {
    skipTracker.skip("start-rpc-check", "No visible simulations");
    return;
  }

  // Deduplicate by blueprint_id
  const uniqueBlueprintIds = [...new Set(
    visible.filter((v: any) => v.blueprint_id).map((v: any) => v.blueprint_id)
  )];

  const failures: string[] = [];

  for (const bpId of uniqueBlueprintIds) {
    const { data: result, error: rpcErr } = await sb
      .rpc("can_start_exam_simulation", { p_blueprint_id: bpId });

    if (rpcErr) {
      failures.push(`${bpId}: RPC error — ${rpcErr.message}`);
      continue;
    }

    const row = result?.[0] ?? result;
    if (row && row.allowed === false) {
      failures.push(`${bpId}: blocked — ${row.reason_code}: ${row.message}`);
    }
  }

  assertEquals(failures.length, 0,
    `❌ STARTABILITY: ${failures.length} visible simulations fail start-RPC:\n` +
    failures.slice(0, 5).join("\n"));

  console.log(`✅ All ${uniqueBlueprintIds.length} visible blueprints pass can_start_exam_simulation`);
});

// ══════════════════════════════════════════════
// P2: Non-published packages must fail start-RPC
// ══════════════════════════════════════════════
Deno.test("P:START: non-published package blocked by start-RPC", async () => {
  // Use a random UUID that won't exist in the visibility view
  const fakeBlueprintId = "00000000-0000-0000-0000-000000000000";

  const { data: result, error } = await sb
    .rpc("can_start_exam_simulation", { p_blueprint_id: fakeBlueprintId });

  // RPC should return allowed=false
  const row = result?.[0] ?? result;
  assert(
    row && row.allowed === false,
    `❌ STARTABILITY: non-existent blueprint was allowed to start! Result: ${JSON.stringify(row)}`);

  assertEquals(row.reason_code, "SIMULATION_NOT_AVAILABLE",
    `❌ STARTABILITY: unexpected reason_code: ${row.reason_code}`);

  console.log(`✅ Non-existent blueprint correctly blocked: ${row.reason_code}`);
});

// ══════════════════════════════════════════════
// P3: All visible simulations have sufficient question pool
//     Uses approved_question_count from the view (already joined correctly)
// ══════════════════════════════════════════════
Deno.test("P:START: visible simulations have sufficient approved question count", async () => {
  const { data: visible } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id, blueprint_id, approved_question_count, total_questions")
    .limit(200);

  if (!visible || visible.length === 0) {
    skipTracker.skip("exam pool check", "No visible simulations");
    return;
  }

  const violations: string[] = [];
  const seen = new Set<string>();

  for (const row of visible as any[]) {
    const key = `${row.package_id}:${row.blueprint_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const needed = row.total_questions ?? 0;
    const available = row.approved_question_count ?? 0;

    if (needed > 0 && available < needed) {
      violations.push(`blueprint ${row.blueprint_id}: needs ${needed}, has ${available}`);
    }
  }

  assertEquals(violations.length, 0,
    `❌ STARTABILITY: ${violations.length} blueprints with insufficient question pool:\n` +
    violations.join("\n"));

  console.log(`✅ All ${seen.size} blueprint/package combos have sufficient questions`);
});

// ══════════════════════════════════════════════
// P4: Non-published package not in startable view
// ══════════════════════════════════════════════
Deno.test("P:START: non-published package not in learner view", async () => {
  const { data: nonPub } = await sb
    .from("course_packages")
    .select("id, status")
    .neq("status", "published")
    .neq("status", "archived")
    .limit(1);

  if (!nonPub || nonPub.length === 0) {
    skipTracker.skip("non-published start check", "No non-published packages");
    return;
  }

  const pkgId = nonPub[0].id;

  const { data: inView } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id")
    .eq("package_id", pkgId)
    .limit(1);

  assertEquals(inView?.length ?? 0, 0,
    `❌ STARTABILITY: non-published package ${pkgId} (${nonPub[0].status}) appears in learner view`);

  console.log(`✅ Non-published ${pkgId} correctly excluded from learner view`);
});

// ══════════════════════════════════════════════
// D1: Cross-check distinct visible packages ≤ published
// ══════════════════════════════════════════════
Deno.test("D:START: learner visible distinct packages ≤ published count", async () => {
  const { data: visible } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id")
    .limit(500);

  const distinctVisible = new Set((visible ?? []).map((v: any) => v.package_id)).size;

  const { count: publishedCount } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .eq("status", "published");

  assert(
    distinctVisible <= (publishedCount ?? 0),
    `❌ More distinct visible packages (${distinctVisible}) than published (${publishedCount})`);

  console.log(`📊 Distinct visible: ${distinctVisible}, Published: ${publishedCount}`);
});

// ══════════════════════════════════════════════
Deno.test("SKIP_AUDIT: startability skip budget", () => {
  skipTracker.assertSkipBudget();
});
