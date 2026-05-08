#!/usr/bin/env node
/**
 * DataLayer Event Validator (CLI)
 * --------------------------------------------------------------
 * Validates DataLayer pushes against docs/analytics/funnel-events.schema.json.
 *
 * Usage:
 *   # From a file (one JSON object per line OR a JSON array)
 *   node scripts/analytics/validate-events.mjs path/to/events.json
 *
 *   # From stdin (e.g. piped from console export)
 *   pbpaste | node scripts/analytics/validate-events.mjs
 *
 * How to capture events in the browser:
 *   1. Open DevTools → Console.
 *   2. Append `?gtm_debug=1` to the URL or run
 *      `localStorage.setItem('ef_gtm_debug','1')` and reload.
 *   3. Interact with the site. Each push is logged as `[GTM] {...}`.
 *   4. Or dump the full DataLayer:
 *        copy(JSON.stringify(window.dataLayer, null, 2))
 *      then paste into a file and run this validator on it.
 *
 * Exit 1 if any event fails validation.
 */
import { readFileSync, existsSync } from "node:fs";

const SCHEMA_PATH = "docs/analytics/funnel-events.schema.json";
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const REQUIRED = schema.requiredDataLayerFieldsForAllFunnelEvents ?? [];
const EVENTS = schema.events ?? {};
const GA4_TO_FUNNEL = new Map();
for (const [funnel, def] of Object.entries(EVENTS)) {
  if (!GA4_TO_FUNNEL.has(def.ga4)) GA4_TO_FUNNEL.set(def.ga4, []);
  GA4_TO_FUNNEL.get(def.ga4).push(funnel);
}

// ── Input ─────────────────────────────────────────────────────────────
async function readInput() {
  const arg = process.argv[2];
  if (arg) {
    if (!existsSync(arg)) {
      console.error(`❌ File not found: ${arg}`);
      process.exit(2);
    }
    return readFileSync(arg, "utf8");
  }
  // stdin
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function parsePayloads(raw) {
  raw = raw.trim();
  if (!raw) return [];
  // Try JSON array first
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {}
  // Fallback: NDJSON / line-delimited (also tolerate `[GTM] {...}` log prefix)
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const cleaned = t.replace(/^\[GTM\]\s*/, "");
    try { out.push(JSON.parse(cleaned)); } catch { /* skip non-json */ }
  }
  return out;
}

// ── Validation ────────────────────────────────────────────────────────
function validate(p, idx) {
  const errs = [];
  if (typeof p !== "object" || p === null) {
    return [`#${idx}: not an object`];
  }
  if (!p.event) {
    return [`#${idx}: missing "event"`];
  }
  // Skip non-funnel system events
  const SYSTEM = new Set([
    "spa_pageview", "consent_update", "gtm.js", "gtm.dom", "gtm.load",
    "persona_selected", "ai_tutor_used", "oral_exam_started",
    "mastery_reached", "exam_simulation_started",
    "pruefung_begonnen", "pruefung_abgeschlossen",
    "bestanden", "nicht_bestanden",
    "h5p_started", "h5p_answered", "h5p_completed", "h5p_progress",
  ]);
  if (SYSTEM.has(p.event)) return { skipped: true };

  // Resolve funnel event
  if (!GA4_TO_FUNNEL.has(p.event)) {
    errs.push(`#${idx}: unknown GA4 event "${p.event}" (not in schema)`);
    return errs;
  }
  // funnel_event sanity
  if (p.funnel_event && !EVENTS[p.funnel_event]) {
    errs.push(`#${idx}: funnel_event "${p.funnel_event}" not in schema`);
  }
  // Required fields presence (null is OK, missing key is NOT)
  for (const f of REQUIRED) {
    if (!(f in p)) {
      errs.push(`#${idx} (${p.event}): missing required field "${f}"`);
    }
  }
  // Strict enforcement: package_id MUST be non-null
  const funnels = p.funnel_event
    ? [p.funnel_event]
    : GA4_TO_FUNNEL.get(p.event);
  const isStrict = funnels.some((f) => EVENTS[f]?.strict);
  if (isStrict && (p.package_id == null || p.package_id === "")) {
    errs.push(
      `#${idx} (${p.event}): strict event requires non-null package_id`
    );
  }
  return errs;
}

// ── Main ──────────────────────────────────────────────────────────────
const raw = await readInput();
const payloads = parsePayloads(raw);

if (payloads.length === 0) {
  console.error("⚠️  No JSON payloads found in input.");
  process.exit(2);
}

let pass = 0, skip = 0, fail = 0;
const allErrors = [];
payloads.forEach((p, i) => {
  const r = validate(p, i);
  if (r && r.skipped) { skip++; return; }
  if (Array.isArray(r) && r.length === 0) { pass++; return; }
  fail++;
  allErrors.push(...r);
});

console.log(`\nValidated ${payloads.length} payload(s):`);
console.log(`  ✅ pass:    ${pass}`);
console.log(`  ⏭  skipped: ${skip}  (system / non-funnel events)`);
console.log(`  ❌ fail:    ${fail}`);

if (allErrors.length) {
  console.log("\nErrors:");
  for (const e of allErrors) console.log("  - " + e);
  process.exit(1);
}
console.log("\n✅ All funnel events conform to schema.");
