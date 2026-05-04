#!/usr/bin/env node
/**
 * guard-lane-contract (v2)
 * Tests code SSOT (runner-lanes.ts) against live derive_job_lane()
 * via admin_test_lane_classification RPC.
 *
 * No env → skipped (warn).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.warn("⚠️  guard-lane-contract: env missing, skipping.");
  process.exit(0);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// SSOT subset — must match runner-lanes.ts canonical buckets
const TEST_CASES = {
  // CONTROL
  package_quality_council: "control",
  package_run_integrity_check: "control",
  package_validate_exam_pool: "control",
  package_validate_oral_exam: "control",
  package_validate_tutor_index: "control",
  package_build_ai_tutor_index: "control",
  package_finalize_learning_content: "control",
  package_auto_publish: "control",
  package_promote_blueprint_variants: "control",
  // RECOVERY
  package_repair_exam_pool_quality: "recovery",
  package_elite_harden: "recovery",
  // GENERATION
  package_generate_exam_pool: "generation",
  package_generate_oral_exam: "generation",
  package_generate_blueprint_variants: "generation",
  package_generate_lesson_minichecks: "generation",
};

const { data, error } = await sb.rpc("admin_test_lane_classification", { p_cases: TEST_CASES });
if (error) { console.error("❌ RPC error:", error.message); process.exit(1); }

const cases = data?.cases ?? [];
const failed = cases.filter((c) => !c.ok);
for (const f of failed) {
  console.error(`❌ Lane mismatch: ${f.job_type} → expected='${f.expected}' actual='${f.actual}'`);
}
if (failed.length > 0) {
  console.error(`\n❌ guard-lane-contract: ${failed.length}/${cases.length} mismatch(es).`);
  process.exit(1);
}
console.log(`✅ guard-lane-contract passed (${cases.length}/${cases.length}).`);
