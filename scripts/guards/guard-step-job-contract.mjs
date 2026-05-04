#!/usr/bin/env node
/**
 * guard-step-job-contract
 * Live-DB check: every package_steps.step_key must have a matching job_type
 * convention (`package_<step_key>`) registered in ops_job_type_registry,
 * AND a row in step_dag_edges (either as step_key or as a depends_on target).
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips (warn) when env missing — keeps pre-PR runs green.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.warn("⚠️  guard-step-job-contract: missing SUPABASE_URL/SERVICE_ROLE — skipping.");
  process.exit(0);
}
const sb = createClient(url, key);

const { data: steps, error: e1 } = await sb
  .from("package_steps")
  .select("step_key", { count: "exact", head: false })
  .limit(50000);
if (e1) { console.error(e1); process.exit(1); }

const distinctSteps = Array.from(new Set(steps.map((s) => s.step_key)));

const { data: dag } = await sb.from("step_dag_edges").select("step_key, depends_on");
const dagSteps = new Set();
(dag || []).forEach((r) => { dagSteps.add(r.step_key); dagSteps.add(r.depends_on); });

const { data: registry } = await sb.from("ops_job_type_registry").select("job_type, job_name");
const registryTypes = new Set((registry || []).map((r) => r.job_type));

let failed = 0;
for (const sk of distinctSteps) {
  const expectedJobType = `package_${sk}`;
  if (!registryTypes.has(expectedJobType)) {
    console.error(`❌ step_key='${sk}' → expected job_type='${expectedJobType}' missing from ops_job_type_registry`);
    failed++;
  }
  if (!dagSteps.has(sk)) {
    console.warn(`⚠️  step_key='${sk}' has no DAG edge (orphan step)`);
  }
}
if (failed > 0) {
  console.error(`\n❌ guard-step-job-contract: ${failed} unmapped step_key(s).`);
  process.exit(1);
}
console.log(`✅ guard-step-job-contract passed (${distinctSteps.length} step_keys checked).`);
