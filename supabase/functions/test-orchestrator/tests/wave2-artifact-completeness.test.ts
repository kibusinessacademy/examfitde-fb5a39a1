/**
 * Wave 2C – Fehlerklasse 9: Artifact Completeness / Hollow Completion
 *
 * Tests that published/done artifacts are not hollow placeholders.
 *
 * SSOT Owner: trg_guard_step_done_thresholds, content quality gates
 * Blast Radius: learner-facing, pipeline-facing
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
// P: Published packages must have minimum question count
// ══════════════════════════════════════════════
Deno.test("P:ARTIFACT: published packages have ≥40 approved questions", async () => {
  const { data: published, error } = await sb
    .from("course_packages")
    .select("id, title")
    .eq("status", "published")
    .limit(50);

  assertEquals(error, null);
  if (!published || published.length === 0) {
    console.warn("⚠️ No published packages — skipping");
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
      violations.push(`${pkg.id} (${pkg.title}): ${count} questions`);
    }
  }

  assertEquals(
    violations.length,
    0,
    `❌ HOLLOW COMPLETION: ${violations.length} published packages have < 40 approved questions. ` +
    `Violations: ${JSON.stringify(violations.slice(0, 5))}`,
  );

  console.log(`✅ All ${published.length} published packages have ≥40 approved questions`);
});

// ══════════════════════════════════════════════
// P: Published packages must have lessons
// ══════════════════════════════════════════════
Deno.test("P:ARTIFACT: published packages have lessons", async () => {
  const { data: published, error } = await sb
    .from("course_packages")
    .select("id, title")
    .eq("status", "published")
    .limit(50);

  assertEquals(error, null);
  if (!published || published.length === 0) {
    console.warn("⚠️ No published packages — skipping");
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

  assertEquals(
    violations.length,
    0,
    `❌ HOLLOW COMPLETION: ${violations.length} published packages have zero lessons. ` +
    `Violations: ${JSON.stringify(violations.slice(0, 5))}`,
  );
});

// ══════════════════════════════════════════════
// P: Published packages must have integrity report
// ══════════════════════════════════════════════
Deno.test("P:ARTIFACT: published packages have integrity_report", async () => {
  const { data: published, error } = await sb
    .from("course_packages")
    .select("id, title, integrity_passed, integrity_report")
    .eq("status", "published")
    .limit(50);

  assertEquals(error, null);
  if (!published || published.length === 0) {
    console.warn("⚠️ No published packages — skipping");
    return;
  }

  const noReport = published.filter((p) => !p.integrity_report);
  assertEquals(
    noReport.length,
    0,
    `❌ HOLLOW COMPLETION: ${noReport.length} published packages have no integrity_report. ` +
    `Packages: ${JSON.stringify(noReport.slice(0, 3).map(p => p.id))}`,
  );

  const notPassed = published.filter((p) => !p.integrity_passed);
  assertEquals(
    notPassed.length,
    0,
    `❌ HOLLOW COMPLETION: ${notPassed.length} published packages have integrity_passed=false. ` +
    `These should have been blocked from publishing. ` +
    `Packages: ${JSON.stringify(notPassed.slice(0, 3).map(p => p.id))}`,
  );
});

// ══════════════════════════════════════════════
// D: ops_hollow_completions = 0 for active packages
// ══════════════════════════════════════════════
Deno.test("D:ARTIFACT: ops_hollow_completions = 0 for active packages", async () => {
  const { data, error } = await sb
    .from("ops_hollow_completions")
    .select("package_id, step_key, artifact_count")
    .limit(20);

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

    assertEquals(
      activeViolations.length,
      0,
      `❌ HOLLOW COMPLETION: ${activeViolations.length} active packages have hollow completions. ` +
      `Steps marked done with insufficient artifacts. ` +
      `Violations: ${JSON.stringify(activeViolations.slice(0, 5))}`,
    );
  }
});

// ══════════════════════════════════════════════
// D: ops_step_done_below_threshold = 0 for active packages
// ══════════════════════════════════════════════
Deno.test("D:ARTIFACT: ops_step_done_below_threshold = 0 for active packages", async () => {
  const { data, error } = await sb
    .from("ops_step_done_below_threshold")
    .select("package_id, step_key, actual, threshold, drift_type")
    .limit(20);

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

    assertEquals(
      activeViolations.length,
      0,
      `❌ THRESHOLD VIOLATION: ${activeViolations.length} active packages have done steps below threshold. ` +
      `Violations: ${JSON.stringify(activeViolations.slice(0, 5))}`,
    );
  }
});
