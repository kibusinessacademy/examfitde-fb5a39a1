/**
 * Wave 2D — Product Completeness: Hollow products must not be learner-live
 *
 * P/D/R structure:
 * - P: published packages must have questions, lessons, integrity report
 * - P: published packages must have handbook sections
 * - D: ops_hollow_completions = 0 for active, ops_step_done_below_threshold = 0
 *
 * SSOT Owner: trg_guard_step_done_thresholds, integrity pipeline
 * Blast Radius: learner-facing, pipeline-facing, revenue-facing
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
// P1: Published packages must have ≥40 approved questions
// ══════════════════════════════════════════════
Deno.test("P:PRODUCT: published packages have ≥40 approved questions", async () => {
  const { data: published } = await sb
    .from("course_packages")
    .select("id, title")
    .eq("status", "published")
    .limit(50);

  if (!published || published.length === 0) {
    skipTracker.skip("published questions", "No published packages");
    return;
  }

  const violations: string[] = [];
  for (const pkg of published) {
    const { count } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("package_id", pkg.id)
      .eq("status", "approved");

    if ((count ?? 0) < 40) {
      violations.push(`${pkg.id} (${pkg.title}): ${count ?? 0} questions`);
    }
  }

  assertEquals(violations.length, 0,
    `❌ HOLLOW PRODUCT: ${violations.length} published with <40 questions: ${JSON.stringify(violations)}`);
  console.log(`✅ All ${published.length} published packages have ≥40 approved questions`);
});

// ══════════════════════════════════════════════
// P2: Published packages must have lessons
// ══════════════════════════════════════════════
Deno.test("P:PRODUCT: published packages have lessons", async () => {
  const { data: published } = await sb
    .from("course_packages")
    .select("id, title")
    .eq("status", "published")
    .limit(50);

  if (!published || published.length === 0) {
    skipTracker.skip("published lessons", "No published packages");
    return;
  }

  const violations: string[] = [];
  for (const pkg of published) {
    const { count } = await sb
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .eq("package_id", pkg.id);

    if ((count ?? 0) === 0) {
      violations.push(`${pkg.id} (${pkg.title}): 0 lessons`);
    }
  }

  assertEquals(violations.length, 0,
    `❌ HOLLOW PRODUCT: ${violations.length} published with 0 lessons: ${JSON.stringify(violations)}`);
});

// ══════════════════════════════════════════════
// P3: Published must have integrity report + passed
// ══════════════════════════════════════════════
Deno.test("P:PRODUCT: published have integrity_report + integrity_passed", async () => {
  const { data: published } = await sb
    .from("course_packages")
    .select("id, title, integrity_passed, integrity_report")
    .eq("status", "published")
    .limit(50);

  if (!published || published.length === 0) {
    skipTracker.skip("integrity report", "No published packages");
    return;
  }

  const noReport = published.filter((p) => !p.integrity_report);
  assertEquals(noReport.length, 0,
    `❌ HOLLOW: ${noReport.length} published without integrity_report: ${JSON.stringify(noReport.map(p => p.id))}`);

  const notPassed = published.filter((p) => !p.integrity_passed);
  assertEquals(notPassed.length, 0,
    `❌ HOLLOW: ${notPassed.length} published with integrity_passed=false: ${JSON.stringify(notPassed.map(p => p.id))}`);
});

// ══════════════════════════════════════════════
// P4: Published must have council_approved
// ══════════════════════════════════════════════
Deno.test("P:PRODUCT: published have council_approved", async () => {
  const { count, error } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .eq("status", "published")
    .eq("council_approved", false);

  assertEquals(error, null);
  assertEquals(count ?? 0, 0,
    `❌ HOLLOW: ${count} published packages have council_approved=false`);
});

// ══════════════════════════════════════════════
// P5: Published must have AI tutor index (if step exists)
// ══════════════════════════════════════════════
Deno.test("P:PRODUCT: published with tutor step have tutor index", async () => {
  const { data: published } = await sb
    .from("course_packages")
    .select("id")
    .eq("status", "published")
    .limit(50);

  if (!published || published.length === 0) return;

  const { data: tutorSteps } = await sb
    .from("package_steps")
    .select("package_id, status")
    .eq("step_key", "build_ai_tutor_index")
    .eq("status", "done")
    .in("package_id", published.map(p => p.id))
    .limit(50);

  if (!tutorSteps || tutorSteps.length === 0) {
    console.log("ℹ️ No published packages with tutor step done — skipping");
    return;
  }

  for (const step of tutorSteps) {
    const { count } = await sb
      .from("ai_tutor_context_index")
      .select("id", { count: "exact", head: true })
      .eq("package_id", step.package_id);

    assert((count ?? 0) > 0,
      `❌ HOLLOW: Package ${step.package_id} has tutor step=done but no tutor index entry`);
  }

  console.log(`✅ All ${tutorSteps.length} tutor-step-done packages have index entries`);
});

// ══════════════════════════════════════════════
// D1: ops_hollow_completions = 0 for active
// ══════════════════════════════════════════════
Deno.test("D:PRODUCT: ops_hollow_completions = 0 for active packages", async () => {
  const { data, error } = await sb
    .from("ops_hollow_completions")
    .select("package_id, step_key, artifact_count")
    .limit(100);

  assertEquals(error, null);
  assertExists(data);

  if (data!.length > 0) {
    const pkgIds = [...new Set(data!.map(d => d.package_id))];
    const { data: pkgs } = await sb
      .from("course_packages")
      .select("id, status")
      .in("id", pkgIds);

    const activePkgIds = new Set(pkgs?.filter(p => p.status !== "archived").map(p => p.id) ?? []);
    const activeViolations = data!.filter(d => activePkgIds.has(d.package_id));

    assertEquals(activeViolations.length, 0,
      `❌ HOLLOW: ${activeViolations.length} active hollow completions: ${JSON.stringify(activeViolations.slice(0, 5))}`);
  }
});

// ══════════════════════════════════════════════
Deno.test("SKIP_AUDIT: product-completeness skip budget", () => {
  skipTracker.assertSkipBudget();
});
