#!/usr/bin/env node
/**
 * GTM Event Mapping Guard (v2)
 * --------------------------------------------------------------
 * Verifies:
 *  1. Every FunnelEventType in src/lib/conversionTracking.ts is mapped
 *     in FUNNEL_TO_GTM_EVENT (src/lib/gtm.ts).
 *  2. Every FunnelEventType is documented in
 *     docs/analytics/funnel-events.schema.json (and vice-versa).
 *  3. The schema's GA4 event name matches FUNNEL_TO_GTM_EVENT for each event.
 *  4. gtmEmitFunnel(...) pushes ALL required Top-Level fields
 *     (event, funnel_event, package_id, persona, curriculum_id,
 *      source_page, page_path).
 *
 * Rule: GTM ist Fan-out-Schicht. Drift in Mapping ODER Pflichtfeldern
 * bricht GA4-Auswertung — daher hartes CI-Gate.
 *
 * Exit 1 on drift.
 */
import { readFileSync } from "node:fs";

const CT_PATH     = "src/lib/conversionTracking.ts";
const GTM_PATH    = "src/lib/gtm.ts";
const SCHEMA_PATH = "docs/analytics/funnel-events.schema.json";

const REQUIRED_FIELDS = [
  "event",
  "funnel_event",
  "package_id",
  "persona",
  "curriculum_id",
  "source_page",
  "page_path",
];

function extractFunnelEventTypes(src) {
  const m = src.match(/export\s+type\s+FunnelEventType\s*=([\s\S]*?);/);
  if (!m) throw new Error("FunnelEventType union not found in " + CT_PATH);
  return [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]);
}

function extractMapping(src) {
  const m = src.match(/FUNNEL_TO_GTM_EVENT[^=]*=\s*{([\s\S]*?)};/);
  if (!m) throw new Error("FUNNEL_TO_GTM_EVENT not found in " + GTM_PATH);
  const out = {};
  for (const x of m[1].matchAll(/^\s*([a-z0-9_]+)\s*:\s*"([a-z0-9_]+)"/gm)) {
    out[x[1]] = x[2];
  }
  return out;
}

function extractEmitFunnelBody(src) {
  const m = src.match(
    /export\s+function\s+gtmEmitFunnel[\s\S]*?gtmPush\(\s*{([\s\S]*?)}\s*\)/
  );
  if (!m) throw new Error("gtmEmitFunnel(...) gtmPush body not found in " + GTM_PATH);
  return m[1];
}

const ct      = readFileSync(CT_PATH,     "utf8");
const gtm     = readFileSync(GTM_PATH,    "utf8");
const schema  = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

const events       = extractFunnelEventTypes(ct);
const mapping      = extractMapping(gtm);
const mappedKeys   = new Set(Object.keys(mapping));
const schemaEvents = schema.events ?? {};
const schemaKeys   = new Set(Object.keys(schemaEvents));
const emitBody     = extractEmitFunnelBody(gtm);

const errors = [];

// 1. Mapping coverage
for (const e of events) {
  if (!mappedKeys.has(e))
    errors.push(`FunnelEventType "${e}" missing in FUNNEL_TO_GTM_EVENT (src/lib/gtm.ts)`);
}

// 2. Schema coverage (both directions)
for (const e of events) {
  if (!schemaKeys.has(e))
    errors.push(`FunnelEventType "${e}" missing in docs/analytics/funnel-events.schema.json`);
}
for (const e of schemaKeys) {
  if (!events.includes(e))
    errors.push(`Schema documents "${e}" but it is NOT in FunnelEventType union (stale schema entry)`);
}

// 3. GA4 name parity (schema.ga4 === FUNNEL_TO_GTM_EVENT[e])
for (const e of events) {
  const codeGa4   = mapping[e];
  const schemaGa4 = schemaEvents[e]?.ga4;
  if (codeGa4 && schemaGa4 && codeGa4 !== schemaGa4) {
    errors.push(
      `GA4 name drift for "${e}": code="${codeGa4}" vs schema="${schemaGa4}"`
    );
  }
}

// 4. Required Top-Level fields in gtmEmitFunnel push body
for (const f of REQUIRED_FIELDS) {
  // accept `event:`, `event :`, or `...event,` (rare)
  const re = new RegExp(`(^|[\\s,{])${f}\\s*:`, "m");
  if (!re.test(emitBody)) {
    errors.push(`gtmEmitFunnel push body missing required Top-Level field "${f}"`);
  }
}

if (errors.length > 0) {
  console.error("\n❌ GTM Event Mapping Guard v2: drift detected\n");
  for (const e of errors) console.error("  - " + e);
  console.error(
    "\nFix: synchronize src/lib/conversionTracking.ts (FunnelEventType) ↔"
  );
  console.error(
    "src/lib/gtm.ts (FUNNEL_TO_GTM_EVENT + gtmEmitFunnel push body) ↔"
  );
  console.error(
    "docs/analytics/funnel-events.schema.json. See docs/analytics/README.md.\n"
  );
  process.exit(1);
}

console.log(
  `✅ GTM Event Mapping Guard v2: ${events.length} funnel events, ` +
  `${REQUIRED_FIELDS.length} required fields, schema in sync.`
);
