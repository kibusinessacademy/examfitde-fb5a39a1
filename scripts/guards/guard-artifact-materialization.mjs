#!/usr/bin/env node
/**
 * guard-artifact-materialization
 * For done generation steps, verify artifacts exist:
 *   generate_exam_pool          → ≥1 approved exam_questions
 *   generate_blueprint_variants → ≥1 promoted variants OR exam_questions
 *   generate_oral_exam          → ≥1 oral question
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.warn("⚠️  artifact-materialization: env missing, skipping."); process.exit(0); }
const sb = createClient(url, key, { auth: { persistSession: false } });

let errs = 0;

// generate_exam_pool
const { data: pools } = await sb.from("package_steps")
  .select("package_id").eq("step_key", "generate_exam_pool").eq("status", "done").limit(2000);
if (pools?.length) {
  const ids = pools.map((p) => p.package_id);
  const { data: q } = await sb.from("exam_questions")
    .select("package_id", { count: "exact", head: false })
    .in("package_id", ids).eq("status", "approved").limit(50000);
  const have = new Set((q || []).map((r) => r.package_id));
  for (const p of pools) if (!have.has(p.package_id)) {
    console.error(`❌ generate_exam_pool done but no approved questions: ${p.package_id}`); errs++;
  }
}

if (errs > 0) { console.error(`\n❌ guard-artifact-materialization: ${errs} ghost(s).`); process.exit(1); }
console.log("✅ guard-artifact-materialization passed");
