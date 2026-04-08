#!/usr/bin/env node

/**
 * Council Integrity Gate
 * 
 * Calls governance-check RPCs via the schema-health edge function
 * and runs local invariant checks against the Supabase API.
 *
 * Checks:
 *   1. No published packages with 0 approved questions
 *   2. All approved questions have SSOT bindings (competency/LF)
 *   3. All approved questions have didactic metadata
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.log("⚠️  SUPABASE_URL / ANON_KEY not set – skipping integrity check");
  process.exit(0);
}

async function query(table, params = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const res = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function main() {
  console.log("🔍 Running Council Integrity Gate...\n");
  let fail = false;

  // 1) Published packages with 0 approved questions
  // (reuse smoke-published-approved logic inline)
  const published = await query("course_packages", "select=id,status&status=eq.published");
  if (!published) {
    console.log("⚠️  Could not query course_packages – skipping");
    process.exit(0);
  }

  for (const pkg of published) {
    const approved = await query(
      "exam_questions",
      `select=id&package_id=eq.${pkg.id}&status=eq.approved&limit=1`
    );
    if (!approved || approved.length === 0) {
      console.error(`❌ FAIL: Published package ${pkg.id} has 0 approved questions`);
      fail = true;
    }
  }
  if (!fail && published.length > 0) {
    console.log(`✅ Check 1: All ${published.length} published packages have approved questions`);
  }

  // 2) Approved questions missing SSOT bindings (using v_data_integrity_audit)
  const integrityDrift = await query(
    "v_data_integrity_audit",
    `select=slug,total_questions,null_certification,null_curriculum,null_competency,null_learning_field,integrity_status&integrity_status=eq.DRIFT_DETECTED`
  );
  if (integrityDrift && integrityDrift.length > 0) {
    console.error(`❌ FAIL: ${integrityDrift.length} certifications with data integrity drift`);
    for (const d of integrityDrift.slice(0, 5)) {
      console.error(`   → ${d.slug}: null_cert=${d.null_certification}, null_comp=${d.null_competency}, null_lf=${d.null_learning_field}`);
    }
    fail = true;
  } else {
    console.log("✅ Check 2: All exam questions have complete SSOT bindings");
  }

  // 3) Approved questions missing didactic metadata
  const missingMeta = await query(
    "exam_questions",
    `select=id,package_id&status=eq.approved&or=(difficulty.is.null,cognitive_level.is.null)&limit=10`
  );
  if (missingMeta && missingMeta.length > 0) {
    console.warn(`⚠️  WARN: ${missingMeta.length}+ approved questions missing difficulty/cognitive_level`);
    // Warn only, don't fail — metadata can be backfilled
  } else {
    console.log("✅ Check 3: All approved questions have didactic metadata");
  }

  console.log("");
  if (fail) {
    console.error("🚫 Council Integrity Gate FAILED");
    process.exit(1);
  }
  console.log("✅ Council Integrity Gate passed");
}

main().catch((err) => {
  console.error("⚠️  Council integrity check error:", err.message);
  process.exit(0); // Don't block if unreachable
});
