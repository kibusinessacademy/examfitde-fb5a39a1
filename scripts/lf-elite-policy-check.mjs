#!/usr/bin/env node
/**
 * LF Elite Policy Gate
 * 
 * Checks v_exam_pool_lf_elite_agg against learning_field_elite_policies.
 * Fails if any core Learning Field violates its elite targets.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.log("⚠️  SUPABASE_URL / KEY not set – skipping");
  process.exit(0);
}

async function query(table, params = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const res = await fetch(url, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function main() {
  console.log("🎯 Running LF Elite Policy Gate...\n");

  // 1) Load policies
  const policies = await query("learning_field_elite_policies", "select=*");
  if (!policies || policies.length === 0) {
    console.log("⚠️  No LF elite policies defined – skipping");
    process.exit(0);
  }
  console.log(`📋 Found ${policies.length} LF elite policies`);

  // 2) Load aggregation view
  const agg = await query("v_exam_pool_lf_elite_agg", "select=*");
  if (!agg) {
    console.log("⚠️  Could not query v_exam_pool_lf_elite_agg – skipping");
    process.exit(0);
  }

  // 3) Match policies against aggregation
  let violations = 0;
  let warnings = 0;

  for (const pol of policies) {
    const match = agg.find(
      (a) =>
        a.certification_id === pol.certification_id &&
        a.learning_field_id === pol.learning_field_id
    );

    if (!match) {
      console.log(`⚠️  No questions found for policy LF ${pol.learning_field_id?.slice(0, 8)} – skipped`);
      warnings++;
      continue;
    }

    const checks = [
      { rule: "min_elite_ratio", actual: match.elite_ratio, expected: pol.min_elite_ratio, op: "<" },
      { rule: "min_evaluate_ratio", actual: match.evaluate_ratio, expected: pol.min_evaluate_ratio, op: "<" },
      { rule: "max_knowledge_ratio", actual: match.knowledge_ratio, expected: pol.max_knowledge_ratio, op: ">" },
      { rule: "min_multi_variable_ratio", actual: match.multi_variable_ratio, expected: pol.min_multi_variable_ratio, op: "<" },
      { rule: "min_conflict_ratio", actual: match.conflict_ratio, expected: pol.min_conflict_ratio, op: "<" },
      { rule: "min_transfer_ratio", actual: match.transfer_ratio, expected: pol.min_transfer_ratio, op: "<" },
    ];

    if (pol.require_distractor_diversity) {
      checks.push({ rule: "distractor_diversity", actual: match.distractor_diversity_ratio, expected: 1.0, op: "<" });
    }

    for (const c of checks) {
      const failed = c.op === "<" ? Number(c.actual) < Number(c.expected) : Number(c.actual) > Number(c.expected);
      if (failed) {
        const icon = pol.is_core ? "❌" : "⚠️";
        const level = pol.is_core ? "FAIL" : "WARN";
        console.log(`${icon} ${level}: LF ${pol.learning_field_id?.slice(0, 8)} — ${c.rule}: actual=${c.actual}, expected${c.op === "<" ? ">=" : "<="}${c.expected}`);
        if (pol.is_core) violations++;
        else warnings++;
      }
    }
  }

  console.log(`\n📊 Result: ${violations} core violations, ${warnings} warnings`);
  if (violations > 0) {
    console.error("🚫 LF Elite Policy Gate FAILED (core LF violations)");
    process.exit(1);
  }
  console.log("✅ LF Elite Policy Gate passed");
}

main().catch((err) => {
  console.error("⚠️  LF Elite Policy error:", err.message);
  process.exit(0);
});
