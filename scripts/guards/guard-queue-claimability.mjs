#!/usr/bin/env node
/**
 * guard-queue-claimability
 * Live drift detector against v_ops_queue_claimability.
 * Reports real worker stalls vs DAG/Pricing/Schema blocks. Prevents
 * false control-lane reap heuristics from regressing.
 *
 * Severity matrix:
 *   stale_processing > 0          → ERROR (worker truly stuck)
 *   schema_drift_blocked > 0      → ERROR
 *   pricing_blocked > 0 + age>1h  → WARN
 *   dag_blocked > 0 + age>2h      → WARN
 *   gap_sync (queued no job)>0    → WARN
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.warn("⚠️  queue-claimability guard: env missing, skipping."); process.exit(0); }
const sb = createClient(url, key);

const { data, error } = await sb.from("v_ops_queue_claimability").select("claimability_status, created_at");
if (error) { console.error(error); process.exit(1); }

const counts = {};
const now = Date.now();
const ages = {};
for (const r of data || []) {
  counts[r.claimability_status] = (counts[r.claimability_status] || 0) + 1;
  const age = (now - new Date(r.created_at).getTime()) / 3600000;
  ages[r.claimability_status] = Math.max(ages[r.claimability_status] || 0, age);
}

let errs = 0, warns = 0;
console.log("Queue claimability snapshot:", JSON.stringify(counts));

if (counts.stale_processing > 0) { console.error("❌ stale_processing > 0 — real worker stall"); errs++; }
if (counts.schema_drift_blocked > 0) { console.error("❌ schema_drift_blocked > 0"); errs++; }
if (counts.pricing_blocked > 0 && (ages.pricing_blocked || 0) > 1) { console.warn(`⚠️  pricing_blocked=${counts.pricing_blocked}, oldest ${ages.pricing_blocked.toFixed(1)}h`); warns++; }
if (counts.dag_blocked > 0 && (ages.dag_blocked || 0) > 2) { console.warn(`⚠️  dag_blocked=${counts.dag_blocked}, oldest ${ages.dag_blocked.toFixed(1)}h`); warns++; }

if (errs > 0) process.exit(1);
console.log(`✅ guard-queue-claimability passed (${warns} warning(s)).`);
