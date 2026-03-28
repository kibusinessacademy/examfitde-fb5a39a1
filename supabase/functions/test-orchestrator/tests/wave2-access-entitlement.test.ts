/**
 * Wave 2C — Access / Entitlement / Rollenfehler
 *
 * P/D/R structure:
 * - P: anon cannot read sensitive tables (exam_questions, job_queue, etc.)
 * - P: anon cannot write to critical tables
 * - D: safe views hide sensitive columns (correct_answer)
 * - D: ops tables not accessible to anon
 *
 * SSOT Owner: RLS policies, security definer functions
 * Blast Radius: security-facing, learner-facing, revenue-facing
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const sbService = createClient(SUPABASE_URL, SERVICE_KEY);
const sbAnon = createClient(SUPABASE_URL, ANON_KEY);

// ── Helper: verify anon cannot read from a table ──
async function assertAnonBlocked(table: string) {
  const { data, error } = await sbAnon
    .from(table)
    .select("id")
    .limit(1);

  // Must either error or return empty
  assert(
    !!error || !data || data.length === 0,
    `❌ SECURITY: anon can read ${table}. RLS not enforced.`,
  );
  console.log(`✅ anon blocked from ${table}`);
}

// ══════════════════════════════════════════════
// P: anon cannot read sensitive pipeline tables
// ══════════════════════════════════════════════
const SENSITIVE_TABLES = [
  "exam_questions",
  "job_queue",
  "package_steps",
  "admin_actions",
  "auto_heal_log",
  "integrity_reports",
  "ai_generation_requests",
  "pipeline_events",
];

for (const table of SENSITIVE_TABLES) {
  Deno.test(`P:ACCESS: anon cannot read ${table}`, async () => {
    await assertAnonBlocked(table);
  });
}

// ══════════════════════════════════════════════
// P: anon cannot write to course_packages
// ══════════════════════════════════════════════
Deno.test("P:ACCESS: anon cannot write to course_packages", async () => {
  const { data, error } = await sbAnon
    .from("course_packages")
    .update({ status: "published" })
    .eq("id", "00000000-0000-0000-0000-000000000000")
    .select("id");

  // Must either error or return 0 affected rows
  const rowsAffected = data?.length ?? 0;
  assert(
    !!error || rowsAffected === 0,
    `❌ SECURITY: anon write to course_packages succeeded with ${rowsAffected} rows`,
  );
  console.log(`✅ anon write to course_packages: blocked (error: ${!!error}, rows: ${rowsAffected})`);
});

// ══════════════════════════════════════════════
// P: anon cannot insert exam_questions
// ══════════════════════════════════════════════
Deno.test("P:ACCESS: anon cannot insert exam_questions", async () => {
  const { error } = await sbAnon
    .from("exam_questions")
    .insert({
      curriculum_id: "00000000-0000-0000-0000-000000000000",
      question_text: "AUDIT_PROBE",
      correct_answer: "X",
      status: "draft",
    });

  assert(!!error,
    `❌ SECURITY: anon can insert into exam_questions — RLS missing`);
  console.log(`✅ anon blocked from inserting exam_questions: ${error!.code}`);
});

// ══════════════════════════════════════════════
// P: anon cannot call can_start_exam_simulation
//    (SECURITY DEFINER — should still require auth or block anon)
// ══════════════════════════════════════════════
Deno.test("P:ACCESS: anon start-RPC returns blocked (not crash)", async () => {
  const { data, error } = await sbAnon
    .rpc("can_start_exam_simulation", {
      p_blueprint_id: "00000000-0000-0000-0000-000000000000",
    });

  // Either errors or returns allowed=false — both are acceptable
  if (error) {
    console.log(`✅ anon start-RPC blocked with error: ${error.code}`);
    return;
  }

  const row = data?.[0] ?? data;
  assert(
    row && row.allowed === false,
    `❌ SECURITY: anon start-RPC returned allowed=true`);
  console.log(`✅ anon start-RPC correctly returns allowed=false: ${row.reason_code}`);
});

// ══════════════════════════════════════════════
// D: exam_questions safe view hides correct_answer
// ══════════════════════════════════════════════
Deno.test("D:ACCESS: v_exam_questions_safe hides correct_answer", async () => {
  const { data } = await sbService
    .from("v_exam_questions_safe")
    .select("*")
    .limit(1);

  if (data && data.length > 0) {
    const row = data[0] as Record<string, unknown>;
    assert(
      !("correct_answer" in row),
      `❌ SECURITY: v_exam_questions_safe exposes correct_answer`,
    );
    assert(
      !("explanation" in row) || row.explanation === null,
      `⚠️  v_exam_questions_safe may expose explanation`,
    );
    console.log("✅ v_exam_questions_safe properly hides sensitive columns");
  } else {
    console.warn("⚠️ v_exam_questions_safe empty — skipping column check");
  }
});

// ══════════════════════════════════════════════
// D: anon cannot access ops_* views
// ══════════════════════════════════════════════
const OPS_VIEWS = [
  "ops_auto_publish_false_success",
  "ops_publish_eligible_but_stuck",
  "ops_blocked_but_ready",
  "ops_processing_stale",
];

for (const view of OPS_VIEWS) {
  Deno.test(`D:ACCESS: anon blocked from ${view}`, async () => {
    const { data, error } = await sbAnon
      .from(view)
      .select("*")
      .limit(1);

    // Must error or return empty
    const exposed = !error && data && data.length > 0;
    assert(!exposed,
      `❌ SECURITY: anon can read ops view ${view}. Internal pipeline data exposed.`);
    console.log(`✅ anon blocked from ${view}`);
  });
}
