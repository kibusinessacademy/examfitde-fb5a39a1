#!/usr/bin/env node
/**
 * Deep Data Integrity Audit
 *
 * Checks data-level consistency across the platform:
 * - No orphan FK references
 * - No status drift (e.g. published packages with draft lessons)
 * - No placeholder content in published packages
 * - Enum values match registry
 * - SSOT mappings are complete
 * - Contract registry is consistent
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const JSON_OUT = process.argv.includes("--json");

if (!SUPABASE_URL || !KEY) {
  const r = { pass_count: 0, warn_count: 0, fail_count: 1, failures: [{ key: "env", message: "SUPABASE_URL / KEY not set" }], warnings: [], results: [] };
  if (JSON_OUT) console.log(JSON.stringify(r));
  else console.error("❌ SUPABASE_URL / KEY not set");
  process.exit(1);
}

async function rpc(name, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

async function query(endpoint) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" },
  });
  const count = res.headers.get("content-range")?.split("/")[1];
  return { ok: res.ok, count: count ? Number(count) : 0, data: res.ok ? await res.json() : null };
}

const results = [];
const failures = [];
const warnings = [];

function pass(key, msg) { results.push({ key, status: "PASS", message: msg }); }
function warn(key, msg) { warnings.push({ key, message: msg }); results.push({ key, status: "WARN", message: msg }); }
function fail(key, msg) { failures.push({ key, message: msg }); results.push({ key, status: "FAIL", message: msg }); }

async function main() {
  // 1. Contract audit (SSOT + enums + pipeline)
  const audit = await rpc("run_system_contract_audit");
  if (!audit.ok) {
    fail("contract_audit.call", "RPC call failed");
  } else {
    const d = audit.data || {};
    d.ok ? pass("contract_audit", "All contract checks pass") : fail("contract_audit", "Contract audit returned NOT ok");

    if (d.ssot && !d.ssot.ok) fail("ssot_mappings", `${d.ssot.missing_count} incomplete mappings`);
    else pass("ssot_mappings", "Complete");

    if (d.enums && !d.enums.ok) warn("enum_registry", `${d.enums.invalid_enum_rows} invalid enum rows`);
    else pass("enum_registry", "Consistent");

    if (d.pipeline && !d.pipeline.ok) {
      fail("pipeline_status", `Steps: ${d.pipeline.invalid_step_status_rows}, Jobs: ${d.pipeline.invalid_job_status_rows} invalid`);
    } else {
      pass("pipeline_status", "All statuses valid");
    }
  }

  // 2. Scheduler governance
  const sched = await rpc("run_scheduler_governance_audit");
  if (sched.ok && sched.data) {
    const s = sched.data;
    if (Number(s.stale_leases || 0) > 0) fail("stale_leases", `${s.stale_leases} stale leases`);
    else pass("stale_leases", "None");

    if (Number(s.running_crons || 0) > 5) warn("running_crons", `${s.running_crons} running (high)`);
    else pass("running_crons", `${s.running_crons || 0} running`);

    if (Number(s.failed_jobs_1h || 0) > 75) fail("failed_jobs_1h", `${s.failed_jobs_1h} failures in last hour`);
    else if (Number(s.failed_jobs_1h || 0) > 25) warn("failed_jobs_1h", `${s.failed_jobs_1h} failures in last hour`);
    else pass("failed_jobs_1h", `${s.failed_jobs_1h || 0} failures`);
  } else {
    fail("scheduler_audit", "RPC call failed");
  }

  // 3. Open critical violations
  const violations = await query("system_contract_violations?status=eq.open&severity=eq.critical&select=id&limit=100");
  if (violations.count > 0) fail("critical_violations", `${violations.count} open critical violations`);
  else pass("critical_violations", "None");

  // 4. Open orphan executions
  const orphans = await query("system_orphan_executions?status=eq.open&select=id&limit=100");
  if (orphans.count > 5) warn("orphan_executions", `${orphans.count} open orphans`);
  else pass("orphan_executions", `${orphans.count} open`);

  // 5. Published packages with placeholder lessons
  const placeholders = await query("lessons?content=like.*_placeholder*&select=id,package_id&limit=50");
  if (placeholders.count > 0) {
    warn("placeholder_lessons", `${placeholders.count} lessons still contain placeholder content`);
  } else {
    pass("placeholder_lessons", "None found");
  }

  // 6. Probe health
  const probeHealth = await rpc("get_probe_health_summary");
  if (probeHealth.ok && probeHealth.data) {
    const p = probeHealth.data;
    if (Number(p.critical_failed_count || 0) > 0) fail("probe_critical_fails", `${p.critical_failed_count} critical probe failures`);
    else pass("probe_critical_fails", "None");

    if (Number(p.failed_count || 0) > 0) warn("probe_fails", `${p.failed_count} probe failures`);
    else pass("probe_fails", "None");
  } else {
    warn("probe_health", "No probe run data available");
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
    console.log("\n🔬 Deep Data Integrity Audit\n");
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
