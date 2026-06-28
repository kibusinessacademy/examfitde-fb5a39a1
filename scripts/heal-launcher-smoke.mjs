#!/usr/bin/env node
/**
 * heal-launcher-smoke.mjs
 *
 * Dry-run smoke for every Heal-Launcher action in the admin cockpit.
 * Calls `admin-ops-actions` and direct edge functions with
 * `x-dry-run: 1` (admin-ops-actions ignores writes when set) and writes
 * a Markdown report.
 *
 * Usage:
 *   E2E_HELPER_TOKEN=… node scripts/heal-launcher-smoke.mjs
 *
 * Env:
 *   SUPABASE_URL              — defaults to project URL
 *   SUPABASE_PUBLISHABLE_KEY  — defaults to baked-in publishable key
 *   E2E_HELPER_TOKEN          — admin JWT (preferred)
 *   REPORT_PATH               — defaults to /tmp/heal-launcher-report.md
 */
import fs from "node:fs/promises";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://ubdvvvsiryenhrfmqsvw.supabase.co";
const APIKEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_3Z80G1ZZqFaK-wzNpNmaZA__1Tc6r8G";
const TOKEN = process.env.E2E_HELPER_TOKEN ?? APIKEY;
const REPORT_PATH = process.env.REPORT_PATH ?? "/tmp/heal-launcher-report.md";

const PROBES = [
  // admin-ops-actions probes (read-only or idempotent)
  { fn: "admin-ops-actions", body: { action: "root_cause_summary" }, label: "Root-Cause Summary" },
  { fn: "admin-ops-actions", body: { action: "reset_stale_processing" }, label: "Reset Stale Processing" },
  { fn: "admin-ops-actions", body: { action: "cancel_zombie_noop_jobs" }, label: "Cancel Zombie No-Op" },
  { fn: "admin-ops-actions", body: { action: "heal_finalization_stall", limit: 1 }, label: "Heal Finalization Stall (limit=1)" },
  { fn: "admin-ops-actions", body: { action: "heal_non_building", limit: 1 }, label: "Heal Non-Building (limit=1)" },
  { fn: "admin-ops-actions", body: { action: "heal_ghost_completions" }, label: "Ghost Completions" },
  { fn: "admin-ops-actions", body: { action: "zombie_sweep" }, label: "Zombie Sweep" },
  // Edge fn probes (dry-run honored)
  { fn: "sellable-recovery-batch", body: { dry_run: true, lanes: ["A","B","C"] }, label: "Sellable Recovery Dry-Run" },
  { fn: "stripe-sync-reaper", body: { dry_run: true }, label: "Stripe Sync Reaper Dry-Run" },
];

async function probe(p) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${p.fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: APIKEY,
        authorization: `Bearer ${TOKEN}`,
        "x-dry-run": "1",
      },
      body: JSON.stringify(p.body),
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 200); }
    return {
      ...p,
      status: res.status,
      ok: res.ok,
      ms: Date.now() - t0,
      result: parsed,
    };
  } catch (e) {
    return { ...p, status: 0, ok: false, ms: Date.now() - t0, error: String(e) };
  }
}

const results = [];
for (const p of PROBES) {
  process.stderr.write(`→ ${p.label} … `);
  const r = await probe(p);
  process.stderr.write(`${r.ok ? "ok" : "FAIL"} (${r.status}, ${r.ms}ms)\n`);
  results.push(r);
}

const summary = {
  total: results.length,
  ok: results.filter(r => r.ok).length,
  fail: results.filter(r => !r.ok).length,
};

const md = [
  `# Heal Launcher Smoke Report`,
  ``,
  `_Generated: ${new Date().toISOString()}_`,
  ``,
  `**Total:** ${summary.total} · **OK:** ${summary.ok} · **FAIL:** ${summary.fail}`,
  ``,
  `| Probe | Status | Time | Result |`,
  `|---|---|---|---|`,
  ...results.map(r =>
    `| ${r.label} | ${r.ok ? "✅" : "❌"} ${r.status} | ${r.ms}ms | \`${JSON.stringify(r.result ?? r.error).slice(0, 120)}\` |`,
  ),
].join("\n");

await fs.writeFile(REPORT_PATH, md, "utf8");
console.log(md);
console.error(`\nReport: ${REPORT_PATH}`);
process.exit(summary.fail === 0 ? 0 : 1);
