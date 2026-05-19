#!/usr/bin/env node
/**
 * E2E Platform Audit
 *
 * Validates that all platform layers are functional:
 * - DB tables exist and are queryable
 * - RPCs return expected shapes
 * - Edge functions respond to POST
 * - Views return data
 */

import { resolveSupabaseEnv } from "./_lib/supabase-skip.mjs";

const JSON_OUT = process.argv.includes("--json");
const FULL = process.argv.includes("--full");

const env = resolveSupabaseEnv({ requireServiceKey: false, scriptName: "e2e-platform-audit" });
if (env.skip) {
  if (JSON_OUT) console.log(JSON.stringify({ pass_count: 0, warn_count: 1, fail_count: 0, failures: [], warnings: [{ key: "env", message: env.reason }], results: [] }));
  process.exit(0);
}
const SUPABASE_URL = env.url;
const KEY = env.key;

async function query(endpoint) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
}

async function rpc(name, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function edgePost(fn, body = {}) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

const results = [];
const failures = [];
const warnings = [];

function pass(key, msg) { results.push({ key, status: "PASS", message: msg }); }
function warn(key, msg) { warnings.push({ key, message: msg }); results.push({ key, status: "WARN", message: msg }); }
function fail(key, msg) { failures.push({ key, message: msg }); results.push({ key, status: "FAIL", message: msg }); }

async function main() {
  // 1. Core tables exist
  const coreTables = [
    "control_plane_snapshots", "control_plane_alerts", "business_kpi_snapshots",
    "system_contract_registry", "system_ssot_mappings", "system_enum_registry",
    "system_contract_violations", "system_probe_definitions", "system_probe_runs",
    "system_probe_results", "system_probe_alerts", "system_cron_registry",
    "system_cron_executions", "system_runner_registry", "system_retry_policies",
    "system_scheduler_guardrails", "system_execution_leases", "system_orphan_executions",
  ];

  for (const t of coreTables) {
    const r = await query(`${t}?select=id&limit=1`);
    r.ok ? pass(`table.${t}`, "exists") : fail(`table.${t}`, `status ${r.status}`);
  }

  // 2. Core RPCs
  const rpcs = [
    "run_system_contract_audit",
    "assert_pipeline_status_integrity",
    "get_probe_health_summary",
    "run_scheduler_governance_audit",
    "get_unified_leitstelle_snapshot",
  ];

  for (const name of rpcs) {
    const r = await rpc(name);
    r.ok ? pass(`rpc.${name}`, "callable") : fail(`rpc.${name}`, `status ${r.status}`);
  }

  // 3. Views
  const views = [
    "v_latest_control_plane_snapshot", "v_latest_business_kpi",
    "v_unified_open_alerts", "v_latest_probe_run",
    "v_wave_ops_summary", "v_scheduler_summary",
    "v_contract_integrity_summary", "v_executive_decision_summary",
  ];

  for (const v of views) {
    const r = await query(`${v}?select=*&limit=1`);
    r.ok ? pass(`view.${v}`, "queryable") : fail(`view.${v}`, `status ${r.status}`);
  }

  // 4. Edge functions (only in full mode to avoid side effects)
  if (FULL) {
    const edges = [
      "system-contract-audit",
      "system-assertion-cron",
      "system-synthetic-probe-runner",
      "system-scheduler-guardrail-cron",
    ];
    for (const fn of edges) {
      const r = await edgePost(fn);
      r.ok ? pass(`edge.${fn}`, `status ${r.status}`) : warn(`edge.${fn}`, `status ${r.status}`);
    }
  }

  // 5. Unified snapshot sanity
  const snap = await rpc("get_unified_leitstelle_snapshot");
  if (snap.ok && snap.data) {
    const d = snap.data;
    if (!d.control && !d.scheduler && !d.contracts) {
      warn("snapshot.completeness", "Snapshot returned but all sections empty");
    } else {
      pass("snapshot.completeness", "Snapshot has data");
    }
  }

  const summary = {
    pass_count: results.filter(r => r.status === "PASS").length,
    warn_count: warnings.length,
    fail_count: failures.length,
    failures,
    warnings,
    results,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("\n🔍 E2E Platform Audit\n");
    for (const r of results) {
      const icon = r.status === "PASS" ? "✅" : r.status === "WARN" ? "⚠️" : "❌";
      console.log(`${icon} ${r.key}: ${r.message}`);
    }
    console.log(`\nPass: ${summary.pass_count} | Warn: ${summary.warn_count} | Fail: ${summary.fail_count}`);
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
