#!/usr/bin/env node
/**
 * Audit-Enqueue Silent-Drop Repro & Contract Test
 * 
 * Reproduziert den Pfad: bronze_no_report_reconcile (dry-run + live)
 * und prüft, dass jede "enqueued=success"-Audit-Zeile einen
 * tatsächlichen job_queue-Eintrag hinterlässt.
 * 
 * Exit codes:
 *   0  alle audit→job parities ok
 *   1  silent drop detected
 *   2  precondition / RPC error
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("⚠️  SUPABASE_URL / SERVICE_ROLE_KEY required");
  process.exit(2);
}

const HDR = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rpc(name, body = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: HDR, body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name} ${r.status}: ${text}`);
  return JSON.parse(text || "[]");
}

async function rest(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  console.log("🔬 Bronze-No-Report Reconcile Audit-vs-Queue Parity Test\n");

  // 1) Dry-run sweep — kein Insert
  console.log("Phase 1: dry_run=true on 3 candidates");
  const dry = await rpc("admin_reconcile_bronze_no_report", { p_limit: 3, p_dry_run: true });
  console.log(`  → returned ${dry.length} rows`);

  // 2) Find audit-vs-queue silent drops in last 2h via forensik RPC
  console.log("\nPhase 2: silent-drop forensik (window=120min)");
  const drops = await rpc("admin_get_audit_enqueue_silent_drops",
    { p_window_minutes: 120, p_action_type: "bronze_no_report_reconcile_enqueued" });

  const byVerdict = drops.reduce((acc, d) => {
    acc[d.verdict] = (acc[d.verdict] || 0) + 1;
    return acc;
  }, {});
  console.log("  → verdicts:", byVerdict);

  const silent = drops.filter(d => d.verdict === "SILENT_DROP");
  if (silent.length > 0) {
    console.error(`\n❌ ${silent.length} SILENT_DROP audit row(s) detected:`);
    for (const d of silent.slice(0, 10)) {
      console.error(`   • audit_id=${d.audit_id} pkg=${d.package_id} type=${d.enqueued_job_type} at=${d.audit_at}`);
    }
    process.exit(1);
  }

  // 3) Pull recent reconciler summaries and cross-check counts
  console.log("\nPhase 3: cross-check summary.enqueued vs job_queue actuals (24h)");
  const summaries = await rest(
    "auto_heal_log?select=metadata,created_at&action_type=eq.bronze_no_report_reconcile_summary&order=created_at.desc&limit=5"
  );
  let mismatches = 0;
  for (const s of summaries) {
    const claimed = s.metadata?.enqueued ?? 0;
    if (claimed === 0) continue;
    const runId = s.metadata?.run_id;
    if (!runId) continue;
    const jobs = await rest(
      `job_queue?select=id&correlation_id=eq.${runId}&job_type=eq.package_run_integrity_check`
    );
    const present = jobs.length;
    const drift = claimed - present;
    const tag = drift === 0 ? "✓" : "⚠";
    console.log(`  ${tag} run=${runId.slice(0, 8)}  claimed=${claimed}  present=${present}  drift=${drift}`);
    if (drift > 0) mismatches += drift;
  }
  if (mismatches > 0) {
    console.error(`\n❌ ${mismatches} silent drop(s) across summaries`);
    process.exit(1);
  }

  console.log("\n✅ Audit↔Queue parity holds");
  process.exit(0);
}

main().catch(e => { console.error("⚠️ ", e.message); process.exit(2); });
