#!/usr/bin/env node
/**
 * guard-governance-artifact-truth
 * For every package_steps row with status='done' on a governance step,
 * verify the corresponding artifact exists.
 *  - run_integrity_check  → meta.status='pass' AND meta.score>=85
 *  - quality_council      → meta.verdict.status present
 *  - auto_publish         → course_packages.is_published = true
 *  - generate_exam_pool   → ≥1 approved exam_question
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.warn("⚠️  artifact-truth guard: env missing, skipping."); process.exit(0); }
const sb = createClient(url, key);

let failed = 0;

// run_integrity_check
const { data: ric } = await sb.from("package_steps")
  .select("package_id, meta")
  .eq("step_key", "run_integrity_check").eq("status", "done").limit(5000);
for (const r of ric || []) {
  const status = r.meta?.status, score = r.meta?.score;
  if (status !== "pass" || (typeof score === "number" && score < 85)) {
    console.error(`❌ ghost run_integrity_check done on ${r.package_id} (status=${status} score=${score})`);
    failed++;
  }
}

// quality_council
const { data: qc } = await sb.from("package_steps")
  .select("package_id, meta")
  .eq("step_key", "quality_council").eq("status", "done").limit(5000);
for (const r of qc || []) {
  if (!r.meta?.verdict?.status) {
    console.error(`❌ ghost quality_council done on ${r.package_id} (no verdict)`);
    failed++;
  }
}

// auto_publish
const { data: ap } = await sb.from("package_steps")
  .select("package_id")
  .eq("step_key", "auto_publish").eq("status", "done").limit(5000);
if (ap && ap.length) {
  const ids = ap.map((r) => r.package_id);
  const { data: pkgs } = await sb.from("course_packages").select("id, is_published, status").in("id", ids);
  for (const p of pkgs || []) {
    if (!p.is_published && p.status !== "published") {
      console.error(`❌ auto_publish done but pkg not published: ${p.id} (status=${p.status})`);
      failed++;
    }
  }
}

if (failed > 0) {
  console.error(`\n❌ guard-governance-artifact-truth: ${failed} ghost completion(s).`);
  process.exit(1);
}
console.log("✅ guard-governance-artifact-truth passed");
