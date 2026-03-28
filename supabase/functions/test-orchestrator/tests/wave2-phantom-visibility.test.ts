/**
 * Wave 2A — Visibility: Phantom Visibility + Phantom Invisibility
 *
 * P/D/R structure:
 * - P: non-published MUST NOT appear; visible MUST have gates+artifacts
 * - P: published+complete MUST appear (phantom invisibility)
 * - D: ops detection views = 0
 *
 * SSOT Owner: v_learner_visible_exam_simulations, v_course_display_ssot
 * Blast Radius: learner-facing, revenue-facing
 *
 * IMPORTANT: exam_questions has curriculum_id, NOT package_id.
 * Join path: course_packages.curriculum_id → exam_questions.curriculum_id
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
//     Uses correct join: package → curriculum_id → exam_questions.curriculum_id
// ══════════════════════════════════════════════
Deno.test("P:VIS: all visible packages have ≥40 approved questions", async () => {
  // The view already exposes approved_question_count — use it directly
  const { data } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id, approved_question_count")
    .limit(200);

  if (!data || data.length === 0) {
    skipTracker.skip("approved questions", "No visible simulations");
    return;
  }

  const violations: string[] = [];
  const seen = new Set<string>();

  for (const row of data as any[]) {
    if (seen.has(row.package_id)) continue;
    seen.add(row.package_id);

    const count = row.approved_question_count ?? 0;
    if (count < 40) {
      violations.push(`${row.package_id}: ${count} approved questions`);
    }
  }

  assertEquals(violations.length, 0,
    `❌ PHANTOM VIS: ${violations.length} visible packages with <40 approved questions: ${JSON.stringify(violations)}`);
  console.log(`✅ All ${seen.size} visible packages have ≥40 approved questions`);
});

// ══════════════════════════════════════════════
// P4: All visible packages have active blueprint
//     (blueprint_id is exposed directly by the view)
// ══════════════════════════════════════════════
Deno.test("P:VIS: all visible packages have active simulation blueprint", async () => {
  const { data } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id, blueprint_id")
    .limit(200);

  if (!data || data.length === 0) {
    skipTracker.skip("blueprint check", "No visible simulations");
    return;
  }

  const noBp = (data as any[]).filter((d) => !d.blueprint_id);
  assertEquals(noBp.length, 0,
    `❌ PHANTOM VIS: ${noBp.length} visible simulations without blueprint_id: ` +
    `${JSON.stringify([...new Set(noBp.map((d: any) => d.package_id))].slice(0, 5))}`);

  console.log(`✅ All ${data.length} visible simulations have blueprint_id`);
});

// ══════════════════════════════════════════════
// P5: PHANTOM INVISIBILITY — published+complete must be visible
//     Published packages with integrity+council+questions should appear
// ══════════════════════════════════════════════
Deno.test("P:VIS: published + eligible packages are visible (no phantom invisibility)", async () => {
  // Get all published packages that pass gates
  const { data: eligible } = await sb
    .from("course_packages")
    .select("id, curriculum_id")
    .eq("status", "published")
    .eq("integrity_passed", true)
    .eq("council_approved", true)
    .limit(200);

  if (!eligible || eligible.length === 0) {
    skipTracker.skip("phantom invisibility", "No eligible published packages");
    return;
  }

  // Get visible package_ids from learner view
  const { data: visible } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id")
    .limit(500);

  const visiblePkgIds = new Set((visible ?? []).map((v: any) => v.package_id));

  // For each eligible package, check if it has enough questions via curriculum_id
  const invisibleButEligible: string[] = [];

  for (const pkg of eligible) {
    if (visiblePkgIds.has(pkg.id)) continue;

    // Check approved question count via curriculum_id join
    const { count } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id)
      .eq("status", "approved");

    if ((count ?? 0) >= 40) {
      // Has enough questions but is NOT visible — phantom invisibility
      invisibleButEligible.push(`${pkg.id} (${count} questions)`);
    }
    // If < 40 questions, legitimately invisible
  }

  assertEquals(invisibleButEligible.length, 0,
    `❌ PHANTOM INVISIBILITY: ${invisibleButEligible.length} published+eligible packages not visible to learners: ${JSON.stringify(invisibleButEligible)}`);

  console.log(`✅ No phantom invisibility detected among ${eligible.length} eligible packages`);
});

// ══════════════════════════════════════════════
// D1: Distinct visible package count ≤ published count
// ══════════════════════════════════════════════
Deno.test("D:VIS: distinct visible packages ≤ published packages", async () => {
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
    `❌ VISIBILITY OVERFLOW: ${distinctVisible} distinct visible packages > ${publishedCount} published packages`);

  console.log(`📊 Distinct visible: ${distinctVisible}, Published: ${publishedCount}`);
});

// ══════════════════════════════════════════════
// D2: ops_learner_visible_readiness — no published with dead ends
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
