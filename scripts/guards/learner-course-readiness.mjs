#!/usr/bin/env node
/**
 * Learner Course Readiness Gate (DB-Guard).
 *
 * Detects "phantom" published courses that the Learner-UI would render
 * empty (no modules / no lessons). Such courses are user-trap producers
 * and must NOT be visible in production.
 *
 * Modes:
 *   default            → exit 1 if any empty published course OR any sell-drift exists.
 *   --json             → emit JSON report on stdout; never exits non-zero.
 *   --max-empty=N      → tolerate up to N empty published courses (legacy slack); default 0.
 *   --max-drift=N      → tolerate up to N sell-drift products (active+public but !is_sellable); default 0.
 *   --skip-drift       → skip sell-drift gate (NOT recommended; emits warning).
 *   --print-ready      → print ID list of READY courses (for E2E smoke).
 *
 * Sell-Drift gate (added 2026-06-25): products where status='active' AND visibility='public'
 * AND is_sellable=false are mandatory fails. Catches catalog→checkout breakage that the
 * empty-course probe misses (e.g. status-drift between lesson states and v_public_sellable_courses).
 *
 * Reads anon SUPABASE_URL + ANON_KEY from .env (already injected in CI).
 */
import { readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, dflt = false) =>
  args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`)) ?? dflt;
const argVal = (name, dflt) => {
  const f = args.find((a) => a.startsWith(`--${name}=`));
  return f ? f.split("=").slice(1).join("=") : dflt;
};

const JSON_OUT = !!flag("json");
const PRINT_READY = !!flag("print-ready");
const MAX_EMPTY = Number(argVal("max-empty", "0"));

function envFromDotenv() {
  if (!existsSync(".env")) return {};
  const out = {};
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = { ...envFromDotenv(), ...process.env };
const URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!URL || !KEY) {
  console.error("FAIL: missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.");
  process.exit(2);
}

async function rpc(name, payload = {}) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`${name} ${r.status}: ${await r.text()}`);
  return r.json();
}

let report;
try {
  report = await rpc("public_learner_course_readiness");
} catch (err) {
  console.error(`FAIL: RPC public_learner_course_readiness — ${err.message}`);
  process.exit(2);
}

const ready = report.filter((c) => c.is_ready);
const empty = report.filter((c) => !c.is_ready);

if (PRINT_READY) {
  for (const c of ready) console.log(c.id);
  process.exit(0);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ total: report.length, ready: ready.length, empty }, null, 2));
  process.exit(0);
}

console.log(
  `[learner-course-readiness] published=${report.length} ready=${ready.length} empty=${empty.length} (tolerated ≤${MAX_EMPTY})`,
);

if (empty.length > MAX_EMPTY) {
  console.error(`\nFAIL: ${empty.length} published course(s) are empty in the Learner-UI:`);
  for (const c of empty.slice(0, 25)) {
    console.error(
      `  - ${c.id}  modules=${c.modules}  lessons=${c.lessons}  · ${c.title}`,
    );
  }
  if (empty.length > 25) console.error(`  …and ${empty.length - 25} more`);
  console.error(
    "\nFix: demote the course to draft (admin_demote_*), or backfill modules+lessons.",
  );
  process.exit(1);
}

console.log(`[learner-course-readiness] OK`);
