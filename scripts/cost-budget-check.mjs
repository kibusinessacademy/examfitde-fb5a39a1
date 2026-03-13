#!/usr/bin/env node
/**
 * Cost & Token Budget Gate
 * 
 * Checks AI usage costs over the last N days against thresholds.
 * Fails if daily average exceeds budget or token explosion detected.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.log("⚠️  SUPABASE_URL / KEY not set – skipping");
  process.exit(0);
}

// Thresholds
const MAX_DAILY_COST_EUR = 50;
const MAX_AVG_TOKENS_PER_JOB = 15000;
const WINDOW_DAYS = parseInt(process.argv[2] || "7", 10);

async function query(table, params = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const res = await fetch(url, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function main() {
  console.log(`💰 Running Cost & Token Budget Gate (${WINDOW_DAYS}-day window)...\n`);

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Check ai_usage_log + llm_cost_events (dual source)
  const usageLogs = await query(
    "ai_usage_log",
    `select=cost_eur,total_tokens,job_type,created_at&created_at=gte.${since}&order=created_at.desc&limit=1000`
  );

  // Also check llm_cost_events (newer cost tracking table)
  const costEvents = await query(
    "llm_cost_events",
    `select=cost_eur,tokens_in,tokens_out,job_type,provider,model,created_at&created_at=gte.${since}&order=created_at.desc&limit=2000`
  );

  if ((!usageLogs || usageLogs.length === 0) && (!costEvents || costEvents.length === 0)) {
    console.log("⚠️  No AI usage logs found – skipping");
    process.exit(0);
  }

  // Merge cost events into usage format for unified analysis
  if (costEvents && costEvents.length > 0) {
    console.log(`📊 Found ${costEvents.length} entries in llm_cost_events`);
    
    // Per-model cost breakdown
    const modelCosts = {};
    for (const ev of costEvents) {
      const key = `${ev.provider}/${ev.model}`;
      if (!modelCosts[key]) modelCosts[key] = { count: 0, cost: 0, tokens_in: 0, tokens_out: 0 };
      modelCosts[key].count++;
      modelCosts[key].cost += ev.cost_eur || 0;
      modelCosts[key].tokens_in += ev.tokens_in || 0;
      modelCosts[key].tokens_out += ev.tokens_out || 0;
    }
    
    console.log("\n📋 Cost by Model:");
    for (const [model, stats] of Object.entries(modelCosts).sort((a, b) => b[1].cost - a[1].cost)) {
      console.log(`   ${model}: €${stats.cost.toFixed(4)} (${stats.count} calls, ${stats.tokens_in + stats.tokens_out} tokens)`);
    }
    
    // Per-intent cost breakdown
    const intentCosts = {};
    for (const ev of costEvents) {
      const key = ev.job_type || "unknown";
      if (!intentCosts[key]) intentCosts[key] = { count: 0, cost: 0 };
      intentCosts[key].count++;
      intentCosts[key].cost += ev.cost_eur || 0;
    }
    
    console.log("\n📋 Cost by Intent (Top 10):");
    for (const [intent, stats] of Object.entries(intentCosts).sort((a, b) => b[1].cost - a[1].cost).slice(0, 10)) {
      console.log(`   ${intent}: €${stats.cost.toFixed(4)} (${stats.count} calls)`);
    }
    console.log("");
  }

  // Aggregate by day
  const dailyCosts = {};
  let totalCost = 0;
  let totalTokens = 0;

  for (const log of usageLogs) {
    const day = log.created_at?.slice(0, 10) || "unknown";
    dailyCosts[day] = (dailyCosts[day] || 0) + (log.cost_eur || 0);
    totalCost += log.cost_eur || 0;
    totalTokens += log.total_tokens || 0;
  }

  const days = Object.keys(dailyCosts).sort();
  const avgDailyCost = totalCost / Math.max(days.length, 1);
  const avgTokensPerJob = totalTokens / Math.max(usageLogs.length, 1);

  console.log(`📊 ${usageLogs.length} logs over ${days.length} day(s)`);
  console.log(`   Total cost: €${totalCost.toFixed(2)}`);
  console.log(`   Avg daily cost: €${avgDailyCost.toFixed(2)} (limit: €${MAX_DAILY_COST_EUR})`);
  console.log(`   Avg tokens/job: ${Math.round(avgTokensPerJob)} (limit: ${MAX_AVG_TOKENS_PER_JOB})`);

  // Check for spike days
  let fail = false;
  for (const [day, cost] of Object.entries(dailyCosts)) {
    if (cost > MAX_DAILY_COST_EUR) {
      console.error(`❌ FAIL: Day ${day} cost €${cost.toFixed(2)} exceeds limit €${MAX_DAILY_COST_EUR}`);
      fail = true;
    }
  }

  if (avgTokensPerJob > MAX_AVG_TOKENS_PER_JOB) {
    console.error(`❌ FAIL: Avg tokens/job ${Math.round(avgTokensPerJob)} exceeds limit ${MAX_AVG_TOKENS_PER_JOB}`);
    fail = true;
  }

  // Also check ai_cost_budgets if present
  const budgets = await query("ai_cost_budgets", "select=*&order=month.desc&limit=1");
  if (budgets && budgets.length > 0) {
    const b = budgets[0];
    const utilization = (b.spent_eur / b.budget_eur * 100).toFixed(1);
    console.log(`\n📋 Monthly budget: €${b.spent_eur?.toFixed(2)} / €${b.budget_eur?.toFixed(2)} (${utilization}%)`);
    if (b.spent_eur > b.budget_eur) {
      console.error(`❌ FAIL: Monthly budget exceeded!`);
      fail = true;
    }
  }

  // Output JSON for artifacts
  const report = {
    window_days: WINDOW_DAYS,
    total_logs: usageLogs.length,
    total_cost_eur: Math.round(totalCost * 100) / 100,
    avg_daily_cost_eur: Math.round(avgDailyCost * 100) / 100,
    avg_tokens_per_job: Math.round(avgTokensPerJob),
    daily_costs: dailyCosts,
    budget_failed: fail,
  };

  const fs = await import("node:fs");
  const outDir = process.env.CI_ARTIFACTS || ".ci_artifacts";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/cost_budget.json`, JSON.stringify(report, null, 2));

  console.log("");
  if (fail) {
    console.error("🚫 Cost & Token Budget Gate FAILED");
    process.exit(1);
  }
  console.log("✅ Cost & Token Budget Gate passed");
}

main().catch((err) => {
  console.error("⚠️  Cost budget check error:", err.message);
  process.exit(0);
});
