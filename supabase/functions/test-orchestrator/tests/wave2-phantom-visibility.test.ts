/**
 * Wave 2A – Fehlerklasse 3: Phantom Visibility
 *
 * Tests that the Learner UI never shows content that is not
 * actually startable / usable.
 *
 * SSOT Owner: v_learner_visible_exam_simulations + can_start_exam_simulation RPC
 * Blast Radius: learner-facing, revenue-facing
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
// P: non-published packages MUST NOT appear in learner view
// ══════════════════════════════════════════════
Deno.test("P:VISIBILITY: learner view only shows published packages", async () => {
  const { data, error } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id, package_status")
    .limit(100);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);

  const nonPublished = data!.filter((d: any) => d.package_status !== "published");
  assertEquals(
    nonPublished.length,
    0,
    `❌ PHANTOM VISIBILITY: ${nonPublished.length} non-published packages visible to learners. ` +
    `Packages: ${JSON.stringify(nonPublished.slice(0, 5))}`,
  );

  console.log(`📊 Learner-visible simulations: ${data!.length} (all published)`);
});

// ══════════════════════════════════════════════
// P: all visible packages must have integrity_passed
// ══════════════════════════════════════════════
Deno.test("P:VISIBILITY: all visible packages have integrity_passed", async () => {
  const { data, error } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id")
    .limit(100);

  assertEquals(error, null);
  if (!data || data.length === 0) {
    console.warn("⚠️ No visible simulations — skipping");
    return;
  }

  const pkgIds = [...new Set(data!.map((d: any) => d.package_id))];
  const { data: pkgs } = await sb
    .from("course_packages")
    .select("id, integrity_passed, council_approved")
    .in("id", pkgIds);

  const failedIntegrity = pkgs?.filter((p) => !p.integrity_passed) ?? [];
  assertEquals(
    failedIntegrity.length,
    0,
    `❌ PHANTOM VISIBILITY: ${failedIntegrity.length} visible packages have integrity_passed=false. ` +
    `Learners can see but not safely use these. ` +
    `Packages: ${JSON.stringify(failedIntegrity.slice(0, 3).map(p => p.id))}`,
  );

  const failedCouncil = pkgs?.filter((p) => !p.council_approved) ?? [];
  assertEquals(
    failedCouncil.length,
    0,
    `❌ PHANTOM VISIBILITY: ${failedCouncil.length} visible packages have council_approved=false. ` +
    `Packages: ${JSON.stringify(failedCouncil.slice(0, 3).map(p => p.id))}`,
  );
});

// ══════════════════════════════════════════════
// P: all visible packages must have ≥ 40 approved questions
// ══════════════════════════════════════════════
Deno.test("P:VISIBILITY: all visible packages have ≥40 approved questions", async () => {
  const { data, error } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id")
    .limit(100);

  assertEquals(error, null);
  if (!data || data.length === 0) {
    console.warn("⚠️ No visible simulations — skipping");
    return;
  }

  const pkgIds = [...new Set(data!.map((d: any) => d.package_id))];

  for (const pkgId of pkgIds) {
    const { count } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("package_id", pkgId)
      .eq("status", "approved");

    assert(
      (count ?? 0) >= 40,
      `❌ PHANTOM VISIBILITY: Package ${pkgId} is visible but has only ${count} approved questions (min: 40).`,
    );
  }

  console.log(`✅ All ${pkgIds.length} visible packages have ≥40 approved questions`);
});

// ══════════════════════════════════════════════
// D: ops_learner_visible_readiness cross-check
// ══════════════════════════════════════════════
Deno.test("D:VISIBILITY: ops_learner_visible_readiness is queryable and monitored", async () => {
  const { data, error } = await sb
    .from("ops_learner_visible_readiness")
    .select("package_id, learner_tier, is_published, dead_ends")
    .limit(20);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);
  console.log(`📊 ops_learner_visible_readiness: ${data!.length} entries total`);

  // Hard invariant: no published package should have dead_ends
  const publishedWithDeadEnds = data!.filter(
    (d: any) => d.is_published && d.dead_ends && d.dead_ends.length > 0,
  );

  assertEquals(
    publishedWithDeadEnds.length,
    0,
    `❌ PUBLISHED WITH DEAD ENDS: ${publishedWithDeadEnds.length} published packages have dead-end features. ` +
    `Entries: ${JSON.stringify(publishedWithDeadEnds.slice(0, 3))}`,
  );

  // Info: non-published entries are early_access packages — expected
  const nonPublished = data!.filter((d: any) => !d.is_published);
  if (nonPublished.length > 0) {
    console.log(`   ℹ️  ${nonPublished.length} non-published (early_access) entries — expected`);
  }
});
