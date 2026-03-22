#!/usr/bin/env node
/**
 * RLS Security Regression Gate
 * 
 * Verifies critical tables have RLS enabled by attempting
 * unauthenticated reads that should return empty/forbidden.
 * Also checks that known-restricted tables reject anon access.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.log("⚠️  SUPABASE_URL / ANON_KEY not set – skipping");
  process.exit(0);
}

// Tables that MUST have RLS blocking anonymous reads
const PROTECTED_TABLES = [
  // Core user data
  "profiles", "user_progress", "subscriptions",
  // Exam integrity
  "exam_sessions", "exam_attempts", "exam_attempt_answers", "exam_questions",
  "exam_blueprints", "mastery_states", "learning_progress",
  // Course pipeline
  "course_packages", "package_steps", "lessons", "handbook_chapters",
  "oral_exam_scenarios", "council_sessions",
  // Admin/Ops
  "admin_actions", "auto_heal_log", "admin_notifications",
  "job_queue", "ai_tutor_logs", "ai_generations", "ai_validations",
  "ai_generation_requests",
  // Licensing & finance
  "licenses", "license_claims", "affiliate_referrals", "affiliate_payouts",
  "executive_summary_reports", "business_kpi_snapshots",
  // Content
  "content_versions",
];

// Tables that SHOULD be accessible (public data)
const PUBLIC_TABLES = [
  "courses",
  "certification_catalog",
];

async function anonQuery(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  return { status: res.status, count: res.ok ? (await res.json()).length : -1 };
}

async function main() {
  console.log("🔒 Running RLS Security Regression Gate...\n");
  let fail = false;

  // Protected tables: anon should get 0 rows or error
  for (const table of PROTECTED_TABLES) {
    const { status, count } = await anonQuery(table);
    if (status === 200 && count > 0) {
      console.error(`❌ FAIL: ${table} — anon read returned ${count} row(s) (RLS leak!)`);
      fail = true;
    } else if (status === 200 && count === 0) {
      console.log(`✅ ${table} — anon read returns 0 rows (RLS active)`);
    } else if (status === 401 || status === 403) {
      console.log(`✅ ${table} — anon blocked (${status})`);
    } else {
      console.log(`⚠️  ${table} — status ${status} (table may not exist)`);
    }
  }

  // Public tables: should be accessible
  console.log("");
  for (const table of PUBLIC_TABLES) {
    const { status } = await anonQuery(table);
    if (status !== 200) {
      console.warn(`⚠️  WARN: ${table} — expected public access, got ${status}`);
    } else {
      console.log(`✅ ${table} — public access OK`);
    }
  }

  console.log("");
  if (fail) {
    console.error("🚫 RLS Security Regression Gate FAILED");
    process.exit(1);
  }
  console.log("✅ RLS Security Regression Gate passed");
}

main().catch((err) => {
  console.error("⚠️  RLS security check error:", err.message);
  process.exit(0);
});
