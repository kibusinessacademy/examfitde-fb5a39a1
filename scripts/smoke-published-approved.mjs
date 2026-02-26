#!/usr/bin/env node

/**
 * Smoke Test: Every published package must have approved questions.
 * Run: SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/smoke-published-approved.mjs
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log("⚠️  SUPABASE_URL / SUPABASE_ANON_KEY not set — skipping smoke test");
  process.exit(0);
}

async function query(table, params = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return res.json();
}

async function main() {
  // Get published packages
  const packages = await query("course_packages", "select=id,status,course_id&status=eq.published");
  if (!Array.isArray(packages) || packages.length === 0) {
    console.log("✅ No published packages — nothing to check");
    return;
  }

  let failures = 0;

  for (const pkg of packages) {
    // Get curriculum_id from course
    const courses = await query("courses", `select=id,curriculum_id,title&id=eq.${pkg.course_id}`);
    const course = courses?.[0];
    if (!course?.curriculum_id) {
      console.warn(`⚠️  Package ${pkg.id} — course ${pkg.course_id} has no curriculum_id`);
      continue;
    }

    // Count approved questions
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/exam_questions?curriculum_id=eq.${course.curriculum_id}&status=eq.approved&select=id&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "count=exact",
        },
      }
    );
    const count = parseInt(res.headers.get("content-range")?.split("/")[1] || "0", 10);

    if (count === 0) {
      console.error(`❌ FAIL: "${course.title}" (${pkg.id}) — published but 0 approved questions!`);
      failures++;
    } else {
      console.log(`✅ "${course.title}" — ${count} approved questions`);
    }
  }

  if (failures > 0) {
    console.error(`\n🚫 ${failures} published package(s) with 0 approved questions!`);
    process.exit(1);
  }

  console.log(`\n✅ All ${packages.length} published packages have approved questions`);
}

main().catch((e) => {
  console.error("Smoke test error:", e);
  process.exit(1);
});
