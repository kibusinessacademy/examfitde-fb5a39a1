/**
 * Wave 2A — Visibility: Phantom Visibility
 *
 * "Can the UI show something that is not actually usable?"
 *
 * P/D/R structure:
 * - P: non-published MUST NOT appear; visible MUST have gates+artifacts
 * - D: ops detection views = 0
 * - R: (covered by auto-quarantine triggers)
 *
 * SSOT Owner: v_learner_visible_exam_simulations, v_course_display_ssot
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
// P1: Only published packages in learner view
// ══════════════════════════════════════════════
Deno.test("P:VIS: learner view contains only published packages", async () => {
  const { data, error } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id, package_status")
    .limit(200);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);

  const nonPublished = data!.filter((d: any) => d.package_status !== "published");
  assertEquals(nonPublished.length, 0,
    `❌ PHANTOM VISIBILITY: ${nonPublished.length} non-published in learner view: ` +
    `${JSON.stringify(nonPublished.slice(0, 5))}`);

  console.log(`📊 Learner-visible simulations: ${data!.length} (all published)`);
});

// ══════════════════════════════════════════════
// P2: All visible packages have integrity + council gates
// ══════════════════════════════════════════════
Deno.test("P:VIS: all visible packages have integrity_passed + council_approved", async () => {
  const { data } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id")
    .limit(200);

  if (!data || data.length === 0) {
    skipTracker.skip("integrity+council gates", "No visible simulations");
    return;
  }

  const pkgIds = [...new Set(data.map((d: any) => d.package_id))];
  const { data: pkgs } = await sb
    .from("course_packages")
    .select("id, integrity_passed, council_approved")
    .in("id", pkgIds);

  const failedIntegrity = pkgs?.filter((p) => !p.integrity_passed) ?? [];
  assertEquals(failedIntegrity.length, 0,
    `❌ PHANTOM VIS: ${failedIntegrity.length} visible with integrity_passed=false: ${JSON.stringify(failedIntegrity.map(p => p.id))}`);

  const failedCouncil = pkgs?.filter((p) => !p.council_approved) ?? [];
  assertEquals(failedCouncil.length, 0,
    `❌ PHANTOM VIS: ${failedCouncil.length} visible with council_approved=false: ${JSON.stringify(failedCouncil.map(p => p.id))}`);
});

// ══════════════════════════════════════════════
// P3: All visible packages have ≥40 approved questions
// ══════════════════════════════════════════════
Deno.test("P:VIS: all visible packages have ≥40 approved questions", async () => {
  const { data } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id")
    .limit(200);

  if (!data || data.length === 0) {
    skipTracker.skip("approved questions", "No visible simulations");
    return;
  }

  const pkgIds = [...new Set(data.map((d: any) => d.package_id))];
  const violations: string[] = [];

  for (const pkgId of pkgIds) {
    const { count } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("package_id", pkgId)
      .eq("status", "approved");

    if ((count ?? 0) < 40) {
      violations.push(`${pkgId}: ${count} questions`);
    }
  }

  assertEquals(violations.length, 0,
    `❌ PHANTOM VIS: ${violations.length} visible packages with <40 approved questions: ${JSON.stringify(violations)}`);
  console.log(`✅ All ${pkgIds.length} visible packages have ≥40 approved questions`);
});

// ══════════════════════════════════════════════
// P4: All visible packages have active blueprint
// ══════════════════════════════════════════════
Deno.test("P:VIS: all visible packages have active simulation blueprint", async () => {
  const { data } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id")
    .limit(200);

  if (!data || data.length === 0) {
    skipTracker.skip("blueprint check", "No visible simulations");
    return;
  }

  const pkgIds = [...new Set(data.map((d: any) => d.package_id))];
  const { data: blueprints } = await sb
    .from("exam_simulation_blueprints")
    .select("package_id")
    .in("package_id", pkgIds)
    .eq("is_active", true)
    .limit(500);

  const withBlueprint = new Set(blueprints?.map(b => b.package_id) ?? []);
  const missing = pkgIds.filter(id => !withBlueprint.has(id));

  assertEquals(missing.length, 0,
    `❌ PHANTOM VIS: ${missing.length} visible packages without active blueprint: ${JSON.stringify(missing)}`);
});

// ══════════════════════════════════════════════
// D1: ops_learner_visible_readiness — no published with dead ends
// ══════════════════════════════════════════════
Deno.test("D:VIS: no published packages with dead_ends in readiness view", async () => {
  const { data, error } = await sb
    .from("ops_learner_visible_readiness")
    .select("package_id, learner_tier, is_published, dead_ends")
    .limit(100);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);

  const publishedDeadEnds = data!.filter(
    (d: any) => d.is_published && d.dead_ends && d.dead_ends.length > 0);

  assertEquals(publishedDeadEnds.length, 0,
    `❌ PUBLISHED WITH DEAD ENDS: ${publishedDeadEnds.length} published packages have dead-end features: ` +
    `${JSON.stringify(publishedDeadEnds.slice(0, 3))}`);

  console.log(`📊 ops_learner_visible_readiness: ${data!.length} entries`);
});

// ══════════════════════════════════════════════
// SKIP AUDIT
// ══════════════════════════════════════════════
Deno.test("SKIP_AUDIT: visibility skip budget", () => {
  skipTracker.assertSkipBudget();
});
