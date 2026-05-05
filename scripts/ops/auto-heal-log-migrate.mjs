#!/usr/bin/env node
/**
 * auto_heal_log Data Migration Assistant
 * ───────────────────────────────────────
 * Liest Legacy-Records (JSON-Array von stdin oder --in=file.json),
 * ergänzt fehlende Pflichtfelder (target_type, result_status, trigger_source,
 * action_type, target_id, metadata) heuristisch und schreibt das normalisierte
 * Ergebnis nach stdout (oder --out=file.json).
 *
 * Mapping-Regeln (deterministisch, idempotent):
 *  - action            → action_type            (falls action_type fehlt)
 *  - details           → metadata               (jsonb, falls metadata leer)
 *  - triggered_by      → trigger_source         (string, falls fehlt)
 *  - package_id        → target_id (UUID) + target_type='package'
 *  - target_type Default 'system'
 *  - result_status Default 'unknown'
 *  - trigger_source Default 'unknown'
 *  - metadata Default {}
 *
 * Usage:
 *   cat legacy-export.json | node scripts/ops/auto-heal-log-migrate.mjs > canonical.json
 *   node scripts/ops/auto-heal-log-migrate.mjs --in=legacy.json --out=canonical.json --report
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const REPORT = !!args.report;

function readInput() {
  if (args.in) return readFileSync(args.in, "utf8");
  return readFileSync(0, "utf8"); // stdin
}

function writeOutput(payload) {
  const txt = JSON.stringify(payload, null, 2);
  if (args.out) writeFileSync(args.out, txt);
  else process.stdout.write(txt + "\n");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function migrateRow(row) {
  const out = { ...row };
  const filled = [];

  // action → action_type
  if (!out.action_type && out.action) { out.action_type = String(out.action); filled.push("action_type"); }
  delete out.action;

  // details → metadata
  if (!out.metadata && out.details !== undefined) {
    out.metadata = typeof out.details === "object" && out.details !== null
      ? out.details
      : { legacy_details: out.details };
    filled.push("metadata");
  }
  delete out.details;

  // triggered_by → trigger_source
  if (!out.trigger_source && out.triggered_by) { out.trigger_source = String(out.triggered_by); filled.push("trigger_source"); }
  delete out.triggered_by;

  // package_id → target_id + target_type
  if (out.package_id) {
    if (!out.target_id && UUID_RE.test(String(out.package_id))) {
      out.target_id = String(out.package_id); filled.push("target_id");
    }
    if (!out.target_type) { out.target_type = "package"; filled.push("target_type"); }
  }
  delete out.package_id;

  // Defaults
  if (!out.target_type) { out.target_type = "system"; filled.push("target_type"); }
  if (!out.result_status) { out.result_status = "unknown"; filled.push("result_status"); }
  if (!out.trigger_source) { out.trigger_source = "unknown"; filled.push("trigger_source"); }
  if (!out.metadata) { out.metadata = {}; filled.push("metadata"); }

  return { row: out, filled, missing_required: !out.action_type ? ["action_type"] : [] };
}

const raw = readInput().trim();
if (!raw) { console.error("❌ No input. Pipe JSON array or use --in=file.json."); process.exit(2); }

let input;
try { input = JSON.parse(raw); } catch (e) { console.error("❌ Invalid JSON:", e.message); process.exit(2); }
if (!Array.isArray(input)) { console.error("❌ Input must be a JSON array of records."); process.exit(2); }

const migrated = input.map(migrateRow);
const rows = migrated.map((m) => m.row);
const report = {
  total: input.length,
  filled_field_counts: migrated.reduce((acc, m) => {
    for (const f of m.filled) acc[f] = (acc[f] || 0) + 1;
    return acc;
  }, {}),
  rows_missing_action_type: migrated.filter((m) => m.missing_required.length).length,
};

if (REPORT) {
  writeOutput({ rows, report });
  console.error(`✅ Migrated ${report.total} rows. Filled:`, report.filled_field_counts);
  if (report.rows_missing_action_type) {
    console.error(`⚠️  ${report.rows_missing_action_type} rows still lack action_type — set manually before INSERT.`);
  }
} else {
  writeOutput(rows);
}
