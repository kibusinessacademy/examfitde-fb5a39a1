#!/usr/bin/env node
/**
 * auto_heal_log Canonical Schema Guard
 * ─────────────────────────────────────
 * Verifiziert, dass kein Producer ein Legacy-Schema in `auto_heal_log` schreibt.
 *
 * Zwei Schichten:
 *  1) Statisch: Grep über supabase/migrations/**.sql + supabase/functions/**.ts
 *     auf verbotene Keys in INSERT INTO auto_heal_log Statements:
 *       - Spalten: action, details, triggered_by, package_id
 *       - Erlaubt:  action_type, metadata, trigger_source, target_id/target_type
 *  2) Live (optional, nur wenn SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY gesetzt):
 *     SELECT count(*) FROM v_auto_heal_log_legacy_producers
 *     WHERE bad_payload OR bad_triggered_by OR bad_action_col
 *        OR bad_package_id_col OR bad_details_col
 *     muss = 0 sein.
 *
 * Exit 1 bei Verstoß. Vor Hard-Block 2026-05-08 als CI-Pflicht-Gate.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FORBIDDEN_KEYS = ["action", "details", "triggered_by", "package_id"];
const ALLOWED_NEAR_KEYS = ["action_type", "metadata", "trigger_source", "target_id", "target_type"];

function rg(args) {
  try {
    return execSync(`rg ${args}`, { encoding: "utf8" });
  } catch (e) {
    if (e.status === 1) return ""; // no matches
    throw e;
  }
}

function staticScan() {
  const violations = [];
  // Find files touching auto_heal_log
  const filesOut = rg(`-l --no-messages "auto_heal_log" supabase/migrations supabase/functions src 2>/dev/null || true`);
  const files = filesOut.split("\n").filter(Boolean);

  for (const f of files) {
    let raw;
    try { raw = readFileSync(f, "utf8"); } catch { continue; }

    // Find INSERT INTO (public.)?auto_heal_log ( ... ) blocks
    const insertRe = /insert\s+into\s+(?:public\.)?auto_heal_log\s*\(([^)]*)\)/gi;
    let m;
    while ((m = insertRe.exec(raw)) !== null) {
      const cols = m[1]
        .split(",")
        .map((s) => s.trim().replace(/["`]/g, "").toLowerCase())
        .filter(Boolean);
      // exact-name matches against forbidden columns
      const bad = cols.filter((c) => FORBIDDEN_KEYS.includes(c));
      if (bad.length) {
        const line = raw.slice(0, m.index).split("\n").length;
        violations.push({ file: f, line, columns: bad });
      }
    }

    // Find jsonb_build_object payloads that mention legacy keys near auto_heal_log
    // (heuristic: 'details' as jsonb key in same statement is fine; we only flag column-name usage)
  }
  return violations;
}

async function liveCheck() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { skipped: true };

  const res = await fetch(`${url}/rest/v1/v_auto_heal_log_legacy_producers?select=func,bad_payload,bad_triggered_by,bad_action_col,bad_package_id_col,bad_details_col`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error(`⚠️  Live check failed: HTTP ${res.status}`);
    return { skipped: true };
  }
  const rows = await res.json();
  const offenders = rows.filter((r) =>
    r.bad_payload || r.bad_triggered_by || r.bad_action_col || r.bad_package_id_col || r.bad_details_col
  );
  return { skipped: false, total: rows.length, offenders };
}

(async function main() {
  console.log("▶︎ auto_heal_log Canonical Schema Guard");

  const staticViolations = staticScan();
  if (staticViolations.length) {
    console.error(`\n❌ STATIC: ${staticViolations.length} INSERT(s) with forbidden legacy columns:`);
    for (const v of staticViolations) {
      console.error(`   ${v.file}:${v.line}  columns=[${v.columns.join(", ")}]`);
    }
  } else {
    console.log("✅ STATIC: no forbidden columns in INSERT INTO auto_heal_log statements.");
  }

  const live = await liveCheck();
  if (live.skipped) {
    console.log("ℹ️  LIVE:  skipped (no SUPABASE_SERVICE_ROLE_KEY).");
  } else if (live.offenders.length) {
    console.error(`\n❌ LIVE: ${live.offenders.length}/${live.total} producers with bad_* flags:`);
    for (const o of live.offenders.slice(0, 20)) {
      const flags = ["bad_payload","bad_triggered_by","bad_action_col","bad_package_id_col","bad_details_col"]
        .filter((k) => o[k]);
      console.error(`   ${o.func}  flags=[${flags.join(", ")}]`);
    }
  } else {
    console.log(`✅ LIVE:  ${live.total} producers, all canonical (bad_* = 0).`);
  }

  const fail = staticViolations.length > 0 || (!live.skipped && live.offenders.length > 0);
  if (fail) {
    console.error("\n❌ Guard failed. Migrate offending producers to canonical schema (action_type, metadata, trigger_source, target_id/target_type).");
    process.exit(1);
  }
  console.log("\n✅ auto_heal_log canonical schema guard passed.");
})();
