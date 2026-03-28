/**
 * Wave 2B – Fehlerklasse 4: Phantom Invisibility
 *
 * Tests that correctly published packages with all artifacts
 * ARE actually visible in the learner view.
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

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ══════════════════════════════════════════════
// P: published + gates green + ≥40 questions → MUST be visible
// ══════════════════════════════════════════════
Deno.test("P:INVISIBILITY: published + all gates → must appear in learner view", async () => {
  // Find all published packages with both gates green
  const { data: publishedPkgs, error } = await sb
    .from("course_packages")
    .select("id, title, integrity_passed, council_approved")
    .eq("status", "published")
    .eq("integrity_passed", true)
    .eq("council_approved", true)
    .limit(50);

  assertEquals(error, null);
  if (!publishedPkgs || publishedPkgs.length === 0) {
    console.warn("⚠️ No published + gates-green packages — skipping");
    return;
  }

  // Check which have ≥ 40 approved questions
  const eligiblePkgs: string[] = [];
  for (const pkg of publishedPkgs) {
    const { count } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("package_id", pkg.id)
      .eq("status", "approved");

    if ((count ?? 0) >= 40) {
      eligiblePkgs.push(pkg.id);
    }
  }

  if (eligiblePkgs.length === 0) {
    console.warn("⚠️ No published packages with ≥40 approved questions — skipping");
    return;
  }

  // Check which have at least one simulation blueprint
  const { data: blueprints } = await sb
    .from("exam_simulation_blueprints")
    .select("package_id")
    .in("package_id", eligiblePkgs)
    .eq("is_active", true)
    .limit(100);

  const withBlueprint = new Set(blueprints?.map(b => b.package_id) ?? []);
  const fullyEligible = eligiblePkgs.filter(id => withBlueprint.has(id));

  if (fullyEligible.length === 0) {
    console.warn("⚠️ No fully eligible packages (with blueprint) — skipping");
    return;
  }

  // Now check: all fully eligible packages MUST appear in the learner view
  const { data: visible } = await sb
    .from("v_learner_visible_exam_simulations")
    .select("package_id")
    .in("package_id", fullyEligible)
    .limit(100);

  const visibleIds = new Set(visible?.map((v: any) => v.package_id) ?? []);
  const invisible = fullyEligible.filter(id => !visibleIds.has(id));

  assertEquals(
    invisible.length,
    0,
    `❌ PHANTOM INVISIBILITY: ${invisible.length} fully eligible packages are NOT visible to learners. ` +
    `Join/filter bug in v_learner_visible_exam_simulations. ` +
    `Missing: ${JSON.stringify(invisible.slice(0, 5))}`,
  );

  console.log(`✅ All ${fullyEligible.length} fully eligible packages are visible`);
});

// ══════════════════════════════════════════════
// P: published packages appear in course display SSOT
// ══════════════════════════════════════════════
Deno.test("P:INVISIBILITY: published packages appear in v_course_display_ssot", async () => {
  const { data: publishedPkgs, error } = await sb
    .from("course_packages")
    .select("id")
    .eq("status", "published")
    .limit(50);

  assertEquals(error, null);
  if (!publishedPkgs || publishedPkgs.length === 0) {
    console.warn("⚠️ No published packages — skipping");
    return;
  }

  const pkgIds = publishedPkgs.map(p => p.id);
  const { data: displayed } = await sb
    .from("v_course_display_ssot")
    .select("package_id")
    .in("package_id", pkgIds)
    .limit(100);

  const displayedIds = new Set(displayed?.map((d: any) => d.package_id) ?? []);
  const missing = pkgIds.filter(id => !displayedIds.has(id));

  assertEquals(
    missing.length,
    0,
    `❌ PHANTOM INVISIBILITY: ${missing.length} published packages missing from v_course_display_ssot. ` +
    `Learners cannot discover these courses. ` +
    `Missing: ${JSON.stringify(missing.slice(0, 5))}`,
  );

  console.log(`✅ All ${pkgIds.length} published packages appear in course display`);
});
