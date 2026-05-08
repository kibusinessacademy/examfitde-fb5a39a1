#!/usr/bin/env node
/**
 * GTM Event Mapping Guard
 * --------------------------------------------------------------
 * Verifies every FunnelEventType in src/lib/conversionTracking.ts has an
 * explicit entry in FUNNEL_TO_GTM_EVENT (src/lib/gtm.ts).
 *
 * Rule: GTM ist Fan-out-Schicht. Jedes neue Funnel-Event muss explizit
 * gemappt werden — kein impliziter Fallback (sonst entstehen GA4-Events
 * mit Snake-Case-Drift, die niemand im Container verkabelt hat).
 *
 * Exit 1 on drift.
 */
import { readFileSync } from "node:fs";

const CT_PATH = "src/lib/conversionTracking.ts";
const GTM_PATH = "src/lib/gtm.ts";

function extractFunnelEventTypes(src) {
  const m = src.match(/export\s+type\s+FunnelEventType\s*=([\s\S]*?);/);
  if (!m) throw new Error("FunnelEventType union not found in " + CT_PATH);
  return [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]);
}

function extractMappedKeys(src) {
  const m = src.match(/FUNNEL_TO_GTM_EVENT[^=]*=\s*{([\s\S]*?)};/);
  if (!m) throw new Error("FUNNEL_TO_GTM_EVENT not found in " + GTM_PATH);
  return [...m[1].matchAll(/^\s*([a-z0-9_]+)\s*:/gm)].map((x) => x[1]);
}

const ct = readFileSync(CT_PATH, "utf8");
const gtm = readFileSync(GTM_PATH, "utf8");

const events = extractFunnelEventTypes(ct);
const mapped = new Set(extractMappedKeys(gtm));

const missing = events.filter((e) => !mapped.has(e));

if (missing.length > 0) {
  console.error("\n❌ GTM Event Mapping Guard: drift detected\n");
  console.error("The following FunnelEventType values are NOT mapped in");
  console.error("FUNNEL_TO_GTM_EVENT (src/lib/gtm.ts):\n");
  for (const e of missing) console.error("  - " + e);
  console.error(
    "\nFix: add an explicit entry to FUNNEL_TO_GTM_EVENT mapping the funnel event"
  );
  console.error(
    "to its canonical GTM event name (snake_case, present-tense past-particle"
  );
  console.error("for completed actions, e.g. `purchase_completed`).\n");
  process.exit(1);
}

console.log(
  `✅ GTM Event Mapping Guard: all ${events.length} funnel events mapped.`
);
