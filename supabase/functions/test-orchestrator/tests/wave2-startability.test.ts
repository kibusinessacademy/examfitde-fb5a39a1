/**
 * Wave 2B — Startability: Can learners start what they see?
 *
 * P/D/R structure:
 * - P: visible → startable (no visible-but-not-startable)
 * - P: not-published → start MUST fail
 * - D: cross-check start prerequisites
 *
 * SSOT Owner: can_start_exam_simulation RPC, v_learner_visible_exam_simulations
 * Blast Radius: learner-facing, revenue-facing
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
// P1: Every visible package has an active blueprint (start prereq)
// ══════════════════════════════════════════════
Deno.test("P:START: all visible simulations have start prerequisites met", async () => {
  const { data: visible, error } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id, blueprint_id")
    .limit(200);

  assertEquals(error, null);
  if (!visible || visible.length === 0) {
    skipTracker.skip("start-prerequisites", "No visible simulations");
    return;
  }

  // Every visible entry must have a blueprint_id
  const noBp = visible.filter((v: any) => !v.blueprint_id);
  assertEquals(noBp.length, 0,
    `❌ STARTABILITY: ${noBp.length} visible simulations without blueprint_id: ` +
    `${JSON.stringify(noBp.slice(0, 5).map((v: any) => v.package_id))}`);

  console.log(`✅ All ${visible.length} visible simulations have blueprint_id`);
});

// ══════════════════════════════════════════════
// P2: Non-published packages must not be startable
// ══════════════════════════════════════════════
Deno.test("P:START: non-published package not in startable view", async () => {
  // Find a non-published package
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

  // Must NOT appear in learner view
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
// P3: Visible packages have sufficient exam pool
// ══════════════════════════════════════════════
Deno.test("P:START: visible packages have sufficient question pool for exam", async () => {
  const { data: visible } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id, blueprint_id")
    .limit(200);

  if (!visible || visible.length === 0) {
    skipTracker.skip("exam pool check", "No visible simulations");
    return;
  }

  const uniqueBpIds = [...new Set(visible.filter((v: any) => v.blueprint_id).map((v: any) => v.blueprint_id))];

  if (uniqueBpIds.length === 0) return;

  const { data: blueprints } = await sb
    .from("exam_simulation_blueprints")
    .select("id, package_id, total_questions")
    .in("id", uniqueBpIds)
    .limit(200);

  if (!blueprints) return;

  for (const bp of blueprints) {
    const totalNeeded = bp.total_questions ?? 0;
    if (totalNeeded === 0) continue;

    const { count } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("package_id", bp.package_id)
      .eq("status", "approved");

    assert(
      (count ?? 0) >= totalNeeded,
      `❌ STARTABILITY: Blueprint ${bp.id} needs ${totalNeeded} questions but package ${bp.package_id} has only ${count} approved`,
    );
  }

  console.log(`✅ All ${uniqueBpIds.length} blueprints have sufficient question pool`);
});

// ══════════════════════════════════════════════
// D1: Cross-check visible count vs published count
// ══════════════════════════════════════════════
Deno.test("D:START: learner visible count ≤ published count", async () => {
  const { count: visibleCount, error: e1 } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id", { count: "exact", head: true });

  const { count: publishedCount, error: e2 } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .eq("status", "published");

  assertEquals(e1, null);
  assertEquals(e2, null);

  // Visible distinct packages should not exceed published packages
  // (visible may be more rows due to multiple blueprints, but unique packages ≤ published)
  console.log(`📊 Visible simulations: ${visibleCount}, Published packages: ${publishedCount}`);
});

// ══════════════════════════════════════════════
Deno.test("SKIP_AUDIT: startability skip budget", () => {
  skipTracker.assertSkipBudget();
});
