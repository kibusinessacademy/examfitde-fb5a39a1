#!/usr/bin/env node
/**
 * auto_heal_log Canonical Schema Guard
 * ─────────────────────────────────────
 * Verifiziert, dass kein Producer ein Legacy-Schema in `auto_heal_log` schreibt.
 *
 * Schichten:
 *  1) Statisch: Robuster SQL-Parser über supabase/functions + src
 *     - Kommentare entfernt (-- … und blockwise / * … * /)
 *     - Mehrzeilige INSERT INTO … ( … ) Spaltenlisten
 *     - Aliase/Schemaqualifier "public.auto_heal_log AS x"
 *     - Spaltennamen normalisiert (Quotes, Whitespace, Lowercase)
 *  2) Live (optional): bad_* Flags in v_auto_heal_log_legacy_producers = 0.
 *
 * CLI:
 *   --live                Live-Check immer fordern (sonst nur wenn Keys gesetzt)
 *   --annotate            GitHub-Workflow-Annotations (::error file=...,line=...)
 *   --json                Maschinenlesbare JSON-Ausgabe an stdout
 *
 * Exit 1 bei Verstoß.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ARGS = new Set(process.argv.slice(2));
const ANNOTATE = ARGS.has("--annotate") || process.env.GITHUB_ACTIONS === "true";
const REQUIRE_LIVE = ARGS.has("--live");
const JSON_OUT = ARGS.has("--json");

const FORBIDDEN_COLUMNS = new Set(["action", "details", "triggered_by", "package_id"]);

function rg(args) {
  try { return execSync(`rg ${args}`, { encoding: "utf8" }); }
  catch (e) { if (e.status === 1) return ""; throw e; }
}

/** Strip SQL/JS comments while preserving line numbers (replace with spaces/newlines). */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let inStr = null; // "'" | '"' | '`'
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\" && i + 1 < n) { out += c2; i += 2; continue; }
      if (c === inStr) inStr = null;
      i++; continue;
    }
    if (c === "'" || c === '"' || c === "`") { inStr = c; out += c; i++; continue; }
    if (c === "-" && c2 === "-") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && c2 === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) out += src[k] === "\n" ? "\n" : " ";
      i = stop; continue;
    }
    out += c; i++;
  }
  return out;
}

/** Find balanced parentheses end starting at index of '('. Returns end index of matching ')' or -1. */
function matchParen(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

function normalizeColumns(raw) {
  return raw
    .split(",")
    .map((s) =>
      s.trim()
        .replace(/^\s*[`"]|[`"]\s*$/g, "")  // strip surrounding quotes
        .replace(/^[a-z_][a-z0-9_]*\./i, "") // strip alias.col
        .toLowerCase()
    )
    .filter((s) => /^[a-z_][a-z0-9_]*$/.test(s));
}

function staticScan() {
  const violations = [];
  const filesOut = rg(`-l --no-messages "auto_heal_log" supabase/functions src 2>/dev/null || true`);
  const files = filesOut.split("\n").filter(Boolean);

  // Match: INSERT INTO [public.]auto_heal_log [AS x]   (   ...cols...   )
  const insertRe =
    /insert\s+into\s+(?:public\s*\.\s*)?auto_heal_log\b(?:\s+as\s+[a-z_][a-z0-9_]*)?\s*/gi;

  for (const f of files) {
    let raw;
    try { raw = readFileSync(f, "utf8"); } catch { continue; }
    const src = stripComments(raw);

    let m;
    while ((m = insertRe.exec(src)) !== null) {
      // Find next '(' after the match end
      let p = m.index + m[0].length;
      while (p < src.length && /\s/.test(src[p])) p++;
      if (src[p] !== "(") continue; // INSERT … DEFAULT VALUES or similar
      const close = matchParen(src, p);
      if (close < 0) continue;
      const colsRaw = src.slice(p + 1, close);
      const cols = normalizeColumns(colsRaw);
      const bad = cols.filter((c) => FORBIDDEN_COLUMNS.has(c));
      if (bad.length) {
        violations.push({ file: f, line: lineOf(src, m.index), columns: bad });
      }
    }
  }
  return violations;
}

async function liveCheck() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (REQUIRE_LIVE) return { skipped: false, error: "missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" };
    return { skipped: true };
  }
  const res = await fetch(
    `${url}/rest/v1/v_auto_heal_log_legacy_producers?select=func,bad_payload,bad_triggered_by,bad_action_col,bad_package_id_col,bad_details_col`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!res.ok) return { skipped: false, error: `HTTP ${res.status}` };
  const rows = await res.json();
  const offenders = rows.filter((r) =>
    r.bad_payload || r.bad_triggered_by || r.bad_action_col || r.bad_package_id_col || r.bad_details_col
  );
  return { skipped: false, total: rows.length, offenders };
}

function emitAnnotation(v) {
  // GitHub workflow command
  console.log(
    `::error file=${v.file},line=${v.line},title=auto_heal_log legacy column::Forbidden legacy column(s) in INSERT INTO auto_heal_log: ${v.columns.join(", ")}`
  );
}

(async function main() {
  const staticViolations = staticScan();
  const live = await liveCheck();

  if (JSON_OUT) {
    console.log(JSON.stringify({ staticViolations, live }, null, 2));
  } else {
    console.log("▶︎ auto_heal_log Canonical Schema Guard");
    if (staticViolations.length) {
      console.error(`\n❌ STATIC: ${staticViolations.length} INSERT(s) with forbidden legacy columns:`);
      for (const v of staticViolations) console.error(`   ${v.file}:${v.line}  columns=[${v.columns.join(", ")}]`);
    } else console.log("✅ STATIC: no forbidden columns in INSERT INTO auto_heal_log statements.");

    if (live.skipped) console.log("ℹ️  LIVE:  skipped (no SUPABASE_SERVICE_ROLE_KEY).");
    else if (live.error) console.error(`❌ LIVE:  ${live.error}`);
    else if (live.offenders?.length) {
      console.error(`\n❌ LIVE: ${live.offenders.length}/${live.total} producers with bad_* flags:`);
      for (const o of live.offenders.slice(0, 20)) {
        const flags = ["bad_payload","bad_triggered_by","bad_action_col","bad_package_id_col","bad_details_col"]
          .filter((k) => o[k]);
        console.error(`   ${o.func}  flags=[${flags.join(", ")}]`);
      }
    } else console.log(`✅ LIVE:  ${live.total} producers, all canonical (bad_* = 0).`);
  }

  if (ANNOTATE) for (const v of staticViolations) emitAnnotation(v);

  const liveFail = live.error || (live.offenders && live.offenders.length > 0);
  const fail = staticViolations.length > 0 || liveFail;
  if (fail) {
    if (!JSON_OUT) console.error("\n❌ Guard failed. Migrate offending producers to canonical schema (action_type, metadata, trigger_source, target_id/target_type).");
    process.exit(1);
  }
  if (!JSON_OUT) console.log("\n✅ auto_heal_log canonical schema guard passed.");
})();
